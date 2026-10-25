<?php

namespace App\Console\Commands\Concerns;

use App\Jobs\GenerateDataExportJob;
use App\Models\Link;
use App\Models\PendingRegistration;
use App\Models\User;
use App\Support\AccountDeletionLifecycleAudit;
use App\Support\Audit;
use App\Support\Auth\RegistrationAttemptContext;
use App\Support\Ids;
use App\Support\LinkIntentRegistry;
use App\Support\OperationalMetrics;
use App\Support\PrivateArtifactCleanup;
use App\Support\UvhCrypto;
use App\Support\WorkspaceLimits;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

trait RetentionStages
{
    private function runPurges(): bool
    {
        $batch = 1000;
        $nowIso = now()->toIso8601String();
        $cutoff = fn (int $days) => now()->subDays($days)->toIso8601String();
        $ok = true;
        $run = function (string $stage, callable $callback) use (&$ok): void {
            $ok = $this->runStage('retention.'.$stage, $callback) && $ok;
        };

        $run('account_deletions', fn () => $this->executeAccountDeletions());

        $run('identity', function () use ($batch, $nowIso, $cutoff): void {
            $sessionCutoff = $cutoff($this->days('session_purge_days', 30));
            $this->purgeInBatches(
                'sessions', 'id',
                '(revoked_at IS NOT NULL AND revoked_at < ?) OR (revoked_at IS NULL AND expires_at < ?)',
                [$sessionCutoff, $sessionCutoff],
                $batch,
            );

            $tokenCutoff = $cutoff($this->days('token_purge_days', 7));
            $this->purgeInBatches(
                'email_tokens', 'id',
                'created_at < ? AND (used_at IS NOT NULL OR expires_at < ?)',
                [$tokenCutoff, $nowIso],
                $batch,
            );

            // Un registro pendiente cuya última actividad supera los 30 días no
            // es una cuenta: nadie reclamó el buzón y la reinscripción es el
            // camino de vuelta. Plazo fijo, no surface de operador; sus bearers
            // caen en cascada y los avisos que quedaran en el outbox pasan a
            // obsoletos por la misma regla de siempre.
            RegistrationAttemptContext::purgeExpired($nowIso, $batch);
            // Parent deletion must lock its context first: the FK SET NULL
            // would otherwise invert correction's context -> pending order.
            $lastPendingId = 0;
            for ($pass = 0; $pass < 10; $pass++) {
                $ids = PendingRegistration::where('updated_at', '<', $cutoff(30))
                    ->where('id', '>', $lastPendingId)->orderBy('id')->limit($batch)->pluck('id');
                foreach ($ids as $id) {
                    DB::transaction(function () use ($id): void {
                        RegistrationAttemptContext::lockForPending((int) $id);
                        $pending = PendingRegistration::whereKey($id)->lockForUpdate()->first();
                        if ($pending && $pending->updated_at->lt(now()->subDays(30))) {
                            $pending->delete();
                        }
                    });
                    $lastPendingId = (int) $id;
                }
                if ($ids->count() < $batch) {
                    break;
                }
            }

            // API credentials remain visible for a short audit window after they
            // can no longer authenticate, then their hashes and metadata are removed.
            $apiTokenCutoff = $cutoff($this->days('api_token_purge_days', 30));
            $this->purgeInBatches(
                'api_tokens', 'id',
                '(revoked_at IS NOT NULL AND revoked_at < ?) OR (expires_at IS NOT NULL AND expires_at < ?)',
                [$apiTokenCutoff, $apiTokenCutoff],
                $batch,
            );

            DB::table('email_change_requests')->where('expires_at', '<', $nowIso)->delete();
            LinkIntentRegistry::purgeExpired();

            // Recovery bearers have phase-specific lifetimes. Move cases to a
            // terminal state before retention purging so no expired confirmation
            // or completion link remains resolvable between cleanup passes.
            $expiredRecoveryIds = DB::table('account_recovery_requests')
                ->whereIn('status', ['requested', 'email_confirmed', 'in_review', 'approved'])
                ->where(function ($query) use ($nowIso) {
                    $query->where('expires_at', '<', $nowIso)
                        ->orWhere(function ($requested) use ($nowIso) {
                            $requested->where('status', 'requested')
                                ->whereNotNull('confirmation_expires_at')
                                ->where('confirmation_expires_at', '<', $nowIso);
                        })
                        ->orWhere(function ($approved) use ($nowIso) {
                            $approved->where('status', 'approved')
                                ->whereNotNull('completion_expires_at')
                                ->where('completion_expires_at', '<', $nowIso);
                        });
                })
                ->orderBy('id')
                ->limit(1000)
                ->pluck('id');
            if ($expiredRecoveryIds->isNotEmpty()) {
                DB::transaction(function () use ($expiredRecoveryIds, $nowIso): void {
                    // Lock/update the parent cases before their approvals. Admin
                    // decisions use user -> case -> approvals, so deleting child
                    // rows first would create an avoidable deadlock cycle.
                    DB::table('account_recovery_requests')
                        ->whereIn('id', $expiredRecoveryIds)
                        ->whereIn('status', ['requested', 'email_confirmed', 'in_review', 'approved'])
                        ->where(function ($query) use ($nowIso) {
                            $query->where('expires_at', '<', $nowIso)
                                ->orWhere(function ($requested) use ($nowIso) {
                                    $requested->where('status', 'requested')
                                        ->whereNotNull('confirmation_expires_at')
                                        ->where('confirmation_expires_at', '<', $nowIso);
                                })
                                ->orWhere(function ($approved) use ($nowIso) {
                                    $approved->where('status', 'approved')
                                        ->whereNotNull('completion_expires_at')
                                        ->where('completion_expires_at', '<', $nowIso);
                                });
                        })
                        ->update([
                            'status' => 'expired',
                            'confirmation_token_hash' => null,
                            'confirmation_expires_at' => null,
                            'completion_token_hash' => null,
                            'completion_expires_at' => null,
                            'updated_at' => now(),
                        ]);
                    DB::table('account_recovery_approvals')
                        ->whereIn('request_id', $expiredRecoveryIds)
                        ->whereExists(function ($query) {
                            $query->selectRaw('1')
                                ->from('account_recovery_requests as recovery')
                                ->whereColumn('recovery.id', 'account_recovery_approvals.request_id')
                                ->where('recovery.status', 'expired');
                        })
                        ->delete();
                });
            }
        });

        $run('exports', function () use ($batch, $nowIso, $cutoff): void {
            // A queue publication can fail after the database confirmation has
            // committed. The processing row itself is a durable recovery marker;
            // re-admit jobs which never managed to claim an artifact path.
            $unclaimedExports = DB::table('data_export_requests')
                ->where('status', 'processing')
                ->whereNull('artifact_path')
                ->where('updated_at', '<', now()->subMinutes(10))
                ->orderBy('id')
                ->limit(100)
                ->pluck('id');
            foreach ($unclaimedExports as $exportId) {
                try {
                    GenerateDataExportJob::dispatch((int) $exportId);
                    DB::table('data_export_requests')
                        ->where('id', $exportId)
                        ->where('status', 'processing')
                        ->whereNull('artifact_path')
                        ->update(['updated_at' => now()]);
                    OperationalMetrics::increment('export.queue_recovered');
                } catch (\Throwable $error) {
                    OperationalMetrics::increment('export.queue_unavailable');
                    report($error);
                }
            }

            $staleExports = DB::table('data_export_requests')
                ->where('status', 'processing')
                ->whereNotNull('artifact_path')
                ->where('updated_at', '<', now()->subMinutes(30))
                ->orderBy('id')
                ->limit(100)
                ->get(['id', 'artifact_path']);
            foreach ($staleExports as $export) {
                $updated = DB::table('data_export_requests')->where('id', $export->id)
                    ->where('status', 'processing')->where('updated_at', '<', now()->subMinutes(30))
                    ->update(['status' => 'failed', 'failure_reason' => 'stalled', 'updated_at' => now()]);
                if ($updated === 1 && is_string($export->artifact_path) && $export->artifact_path !== '') {
                    PrivateArtifactCleanup::afterCommit((int) $export->id, $export->artifact_path);
                }
            }

            // Export files are private, encrypted and deliberately short-lived.
            // Claim each expiry transition before deleting its concrete path so a
            // concurrent download cannot race a blind filesystem sweep.
            $expiredExports = DB::table('data_export_requests')
                ->where('status', 'ready')
                ->where('download_expires_at', '<', $nowIso)
                ->orderBy('id')->limit(100)->get(['id', 'status', 'artifact_path']);
            foreach ($expiredExports as $export) {
                $updated = DB::table('data_export_requests')
                    ->where('id', $export->id)->where('status', $export->status)
                    ->update([
                        'status' => 'expired',
                        'mail_generation_hash' => null,
                        'updated_at' => now(),
                    ]);
                if ($updated === 1 && is_string($export->artifact_path) && $export->artifact_path !== '') {
                    PrivateArtifactCleanup::afterCommit((int) $export->id, $export->artifact_path);
                }
            }

            // Storage outages must not orphan encrypted exports. Terminal rows
            // retain the concrete path until this retry confirms deletion.
            PrivateArtifactCleanup::retryTerminal();

            $exportCutoff = $cutoff($this->days('export_purge_days', 7));
            $this->purgeInBatches(
                'data_export_requests', 'id',
                "status IN ('downloaded','failed','cancelled','expired') AND artifact_path IS NULL AND updated_at < ?",
                [$exportCutoff],
                $batch,
            );
        });

        $run('delivery_records', function () use ($batch, $cutoff): void {
            $deliveryCutoff = $cutoff($this->days('delivery_purge_days', 90));
            $this->purgeInBatches(
                'webhook_deliveries', 'id',
                "status = 'success' AND delivered_at < ?",
                [$deliveryCutoff],
                $batch,
            );
            $this->purgeInBatches(
                'webhook_deliveries', 'id',
                "status = 'failed' AND created_at < ?",
                [$deliveryCutoff],
                $batch,
            );

            $failedJobCutoff = $cutoff($this->days('failed_job_purge_days', 30));
            $this->purgeInBatches('failed_jobs', 'id', 'failed_at < ?', [$failedJobCutoff], $batch);

            $mailOutboxCutoff = $cutoff($this->days('mail_outbox_purge_days', 30));
            $this->purgeInBatches(
                'mail_outbox', 'id',
                "status IN ('sent','failed','obsolete','compensated') AND updated_at < ?",
                [$mailOutboxCutoff],
                $batch,
            );

            $recoveryCutoff = $cutoff($this->days('account_recovery_purge_days', 90));
            $this->purgeInBatches(
                'account_recovery_requests', 'id',
                "status IN ('rejected','completed','expired','cancelled') AND updated_at < ?",
                [$recoveryCutoff],
                $batch,
            );
        });

        $run('link_trash', function () use ($batch, $cutoff): void {
            // Only rows already hidden from redirect and normal workspace
            // queries are eligible. Foreign-key cascades remove child rules,
            // tags and analytics in the same database statement.
            $trashCutoff = $cutoff($this->days('link_trash_days', 30));
            $this->purgeInBatches('links', 'id', 'deleted_at IS NOT NULL AND deleted_at < ?', [$trashCutoff], $batch);
        });

        $run('governance_records', function () use ($batch, $cutoff): void {
            DB::table('operational_notice_events')->where('created_at', '<', now()->subDays(31))->delete();
            $auditCutoff = $cutoff($this->days('audit_purge_days', 365));
            $this->purgeInBatches('audit_events', 'id', 'created_at < ?', [$auditCutoff], $batch);

            $metricsCutoff = $cutoff($this->days('operational_metrics_purge_days', 30));
            $this->purgeInBatches('operational_metrics', 'id', 'bucket_at < ?', [$metricsCutoff], $batch);

            // Rights requests are retained for a bounded accountability window;
            // message ciphertext disappears by cascade with its terminal case.
            $privacyCutoff = $cutoff($this->days('privacy_request_purge_days', 1095));
            $this->purgeInBatches(
                'privacy_rights_requests', 'id',
                "status IN ('completed','rejected','cancelled') AND updated_at < ?",
                [$privacyCutoff],
                $batch,
            );
        });

        $run('analytics', function () use ($batch, $cutoff): void {
            $retentionCutoff = $cutoff(WorkspaceLimits::analyticsRetentionDays());
            $this->purgeInBatches('click_events', 'id', 'occurred_at < ?', [$retentionCutoff], $batch);
            $this->purgeInBatches('metric_rollups', 'id', 'day < ?', [$retentionCutoff], $batch);
            $this->purgeInBatches('qr_daily_counts', 'id', 'day < ?', [$retentionCutoff], $batch);
            DB::delete('DELETE FROM metric_unique_visitors WHERE day < ?', [substr($retentionCutoff, 0, 10)]);
            if (Cache::put('uvh:retention:analytics', [
                'completed_at' => time(),
                'retention_days' => WorkspaceLimits::analyticsRetentionDays(),
                'cutoff' => $retentionCutoff,
            ], now()->addMinutes(max(10, (int) config('uvh.housekeeping.interval_minutes', 60) * 2))) !== true) {
                throw new \RuntimeException('No se pudo guardar la verificación de purga analítica');
            }
        });

        return $ok;
    }

    /** Execute a bounded batch of grace-period account anonymisations. */
    private function executeAccountDeletions(): void
    {
        $candidates = DB::table('account_deletion_requests')
            ->where('status', 'scheduled')->where('execute_after', '<=', now())
            ->orderBy('execute_after')->orderBy('id')->limit(50)->get(['id', 'user_id']);

        foreach ($candidates as $candidate) {
            $id = (int) $candidate->id;
            $userId = (int) $candidate->user_id;
            // Compute bcrypt outside row locks. The random credential is never
            // disclosed and only makes the retained tombstone non-authenticable.
            $passwordHash = Hash::make(Ids::randomToken(48));
            $anonymizedEmail = 'deleted-'.(int) $id.'-'.strtolower(Ids::randomToken(8)).'@deleted.invalid';
            $result = DB::transaction(function () use ($id, $userId, $passwordHash, $anonymizedEmail): ?array {
                $user = User::where('id', $userId)->lockForUpdate()->first();
                $request = DB::table('account_deletion_requests')->where('id', $id)
                    ->where('user_id', $userId)
                    ->where('status', 'scheduled')->where('execute_after', '<=', now())->lockForUpdate()->first();
                if (! $request) {
                    return null;
                }
                if (! $user || ! $user->deleted_at) {
                    DB::table('account_deletion_requests')->where('id', $id)->update([
                        'status' => 'blocked', 'cancel_token_hash' => null, 'updated_at' => now(),
                    ]);

                    return ['audit_only' => true, 'audit_pending' => ! AccountDeletionLifecycleAudit::record($user, $request, 'account.deletion_blocked')];
                }
                $mailConfirmed = is_string($request->cancel_token_hash)
                    && DB::table('mail_outbox')
                        ->where('kind', 'account_deletion_scheduled')
                        ->where('resource_type', 'account_deletion')
                        ->where('resource_id', (string) $id)
                        ->where('resource_generation', $request->cancel_token_hash)
                        ->where('status', 'sent')
                        ->exists();
                if (! $mailConfirmed) {
                    $now = now();
                    $user->update([
                        'deleted_at' => null,
                        'security_version' => (int) $user->security_version + 1,
                        'updated_at' => $now,
                    ]);
                    DB::table('account_deletion_requests')->where('id', $id)->update([
                        'status' => 'cancelled',
                        'cancel_token_hash' => null,
                        'cancelled_at' => $now,
                        'updated_at' => $now,
                    ]);

                    return ['blocked' => true, 'mail_unconfirmed' => true, 'user_id' => (int) $user->id, 'artifacts' => [],
                        'audit_pending' => ! AccountDeletionLifecycleAudit::record($user, $request, 'account.deletion_cancelled_mail_unconfirmed')];
                }
                if (DB::table('workspaces')->where('owner_user_id', $user->id)->exists()) {
                    $now = now();
                    $user->update([
                        'deleted_at' => null,
                        'security_version' => (int) $user->security_version + 1,
                        'updated_at' => $now,
                    ]);
                    DB::table('account_deletion_requests')->where('id', $id)->update([
                        'status' => 'cancelled',
                        'cancel_token_hash' => null,
                        'cancelled_at' => $now,
                        'updated_at' => $now,
                    ]);

                    return ['blocked' => true, 'mail_unconfirmed' => false, 'user_id' => (int) $user->id, 'artifacts' => [],
                        'audit_pending' => ! AccountDeletionLifecycleAudit::record($user, $request, 'account.deletion_blocked')];
                }

                $artifacts = DB::table('data_export_requests')->where('user_id', $user->id)
                    ->whereNotNull('artifact_path')->get(['id', 'artifact_path'])
                    ->filter(fn ($row) => is_string($row->artifact_path) && $row->artifact_path !== '')
                    ->map(fn ($row) => ['id' => (int) $row->id, 'path' => $row->artifact_path])
                    ->values()->all();
                DB::table('data_export_requests')->where('user_id', $user->id)->update([
                    'status' => DB::raw("CASE WHEN status = 'downloaded' THEN status ELSE 'cancelled' END"),
                    'mail_generation_hash' => null,
                    'updated_at' => now(),
                ]);
                DB::table('sessions')->where('user_id', $user->id)->delete();
                DB::table('email_tokens')->where('user_id', $user->id)->delete();
                DB::table('email_change_requests')->where('user_id', $user->id)->delete();
                DB::table('memberships')->where('user_id', $user->id)->delete();
                DB::table('link_favorites')->where('user_id', $user->id)->delete();
                DB::table('saved_link_filters')->where('user_id', $user->id)->delete();
                DB::table('link_duplicate_receipts')->where('user_id', $user->id)->delete();
                DB::table('destination_inspections')->where('user_id', $user->id)->delete();
                DB::table('api_tokens')->where('created_by', $user->id)->whereNull('revoked_at')->update(['revoked_at' => now()]);
                DB::table('invitations')->where('invited_by', $user->id)->where('status', 'pending')->update(['status' => 'cancelled']);

                $erasureRequests = DB::table('privacy_rights_requests')->where('user_id', $user->id)
                    ->where('type', 'erasure')->whereIn('status', ['submitted', 'in_progress', 'waiting_user'])
                    ->orderBy('id')->lockForUpdate()->pluck('id');
                foreach ($erasureRequests as $privacyId) {
                    DB::table('privacy_rights_messages')->insert([
                        'request_id' => $privacyId,
                        'author_role' => 'system',
                        'author_user_id' => null,
                        'encrypted_body' => UvhCrypto::encryptAtRest('La anonimización de la cuenta se ha ejecutado mediante el flujo confirmado de eliminación.'),
                        'created_at' => now(),
                    ]);
                    DB::table('privacy_rights_requests')->where('id', $privacyId)->update([
                        'status' => 'completed',
                        'generation_hash' => Ids::sha256Hex(Ids::randomToken(32)),
                        'completed_at' => now(),
                        'updated_at' => now(),
                    ]);
                }

                $now = now();
                $user->update([
                    'email' => $anonymizedEmail,
                    'name' => 'Cuenta eliminada',
                    'password_hash' => $passwordHash,
                    'email_verified_at' => null,
                    'is_admin' => false,
                    'mfa_enabled' => false,
                    'mfa_secret' => null,
                    'mfa_pending_secret' => null,
                    'mfa_pending_expires_at' => null,
                    'recovery_codes' => null,
                    'security_version' => (int) $user->security_version + 1,
                    'updated_at' => $now,
                ]);
                DB::table('account_deletion_requests')->where('id', $id)->update([
                    'status' => 'executed',
                    'confirmation_token_hash' => null,
                    'cancel_token_hash' => null,
                    'executed_at' => $now,
                    'updated_at' => $now,
                ]);
                // Destructive execution requires durable evidence in the same
                // business commit. History delivery still happens after commit.
                Audit::write($user->id, 'account.deletion_executed', 'account_deletion', $id);

                return ['blocked' => false, 'mail_unconfirmed' => false, 'user_id' => (int) $user->id, 'artifacts' => $artifacts];
            });

            if (! $result) {
                continue;
            }
            if (! ($result['audit_only'] ?? false)) {
                foreach ($result['artifacts'] ?? [] as $artifact) {
                    PrivateArtifactCleanup::afterCommit($artifact['id'], $artifact['path']);
                }
                LinkIntentRegistry::afterCommit($result['user_id']);
            }
            if ($result['audit_pending'] ?? false) {
                // Protection has committed with a retryable receipt. Report
                // this incomplete pass without undoing the protective change.
                throw new \RuntimeException('Deletion lifecycle audit remains pending');
            }
        }
    }

    private function purgeInBatches(string $table, string $idColumn, string $where, array $params, int $batch): int
    {
        $total = 0;
        do {
            $deleted = DB::delete(
                "DELETE FROM {$table} WHERE {$idColumn} IN (SELECT {$idColumn} FROM {$table} WHERE {$where} LIMIT {$batch})",
                $params,
            );
            $total += $deleted;
        } while ($deleted === $batch);

        return $total;
    }

    private function days(string $key, int $default): int
    {
        $value = (int) config('uvh.housekeeping.'.$key, $default);

        return max(1, $value);
    }
}
