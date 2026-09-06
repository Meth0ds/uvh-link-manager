<?php

namespace App\Console\Commands;

use App\Jobs\GenerateDataExportJob;
use App\Jobs\VerifyDomainDnsJob;
use App\Models\CustomDomain;
use App\Models\Link;
use App\Models\User;
use App\Support\Audit;
use App\Support\DomainRevalidationSchedule;
use App\Support\Ids;
use App\Support\InvitationMailBudget;
use App\Support\LinkIntentRegistry;
use App\Support\MailOutboxCompensation;
use App\Support\MailOutboxDispatcher;
use App\Support\OperationalMetrics;
use App\Support\PrivateArtifactCleanup;
use App\Support\UvhCrypto;
use App\Support\WebhookService;
use App\Support\WorkspaceLimits;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;

class UvhHousekeeping extends Command
{
    protected $signature = 'uvh:housekeeping';

    protected $description = 'Scheduled link transitions, webhook retries and retention purges';

    public function handle(): int
    {
        $failed = false;
        $run = function (string $stage, callable $callback) use (&$failed): bool {
            $ok = $this->runStage($stage, $callback);
            $failed = ! $ok || $failed;

            return $ok;
        };

        $run('link_lifecycle', fn () => $this->transitionDueLinks());

        $run('stale_dns_claims', function (): void {
            // A queue outage after admission must not strand a domain in an
            // endless verifying state. Jobs have a 15-second timeout; ten
            // minutes leaves ample queue latency while providing recovery.
            DB::table('custom_domains')
                ->where('state', 'verifying')
                ->where('updated_at', '<=', now()->subMinutes(10))
                ->update([
                    'state' => 'error',
                    'verified_at' => null,
                    'edge_eligible' => false,
                    'dns_check_completed_at' => now(),
                    'dns_error' => 'queue_timeout',
                    'updated_at' => now(),
                ]);

            // Revalidations keep their visible state (active/verified/disabled)
            // while a worker runs. Recover their in-progress marker too; the
            // older verifier only handled the initial `verifying` state and a
            // lost queue job could otherwise suppress all future checks.
            $staleRevalidations = DB::table('custom_domains')
                ->whereIn('state', ['active', 'verified', 'disabled'])
                ->whereNotNull('dns_check_started_at')
                ->where(function ($query) {
                    $query->whereNull('dns_check_completed_at')
                        ->orWhereColumn('dns_check_started_at', '>', 'dns_check_completed_at');
                })
                ->where('updated_at', '<=', now()->subMinutes(10))
                ->update([
                    'dns_check_completed_at' => now(),
                    'dns_error' => 'queue_timeout',
                    'updated_at' => now(),
                ]);
            if ($staleRevalidations > 0) {
                OperationalMetrics::increment('dns.job_stale', $staleRevalidations);
            }
        });

        $run('stale_tls_provisioning', function (): void {
            DB::table('custom_domains')
                ->where('state', 'provisioning')
                ->where('updated_at', '<=', now()->subHour())
                ->update([
                    'state' => 'verified',
                    'edge_eligible' => false,
                    'tls_ready_at' => null,
                    'tls_error' => 'provisioning_timeout',
                    'tls_version' => DB::raw('tls_version + 1'),
                    'updated_at' => now(),
                ]);
        });

        $run('domain_revalidation', fn () => $this->queueDomainRevalidations());

        $run('webhook_recovery', function (): void {
            // A worker may die after claiming a delivery. Release only stale
            // claims; live jobs retain exclusive ownership of their attempt.
            DB::table('webhook_deliveries')
                ->where('status', 'processing')
                ->where('locked_at', '<=', now()->subMinutes(10))
                ->update(['status' => 'pending', 'locked_at' => null, 'next_attempt_at' => now()]);
        });

        $run('webhook_enqueue', function (): void {
            $now = now()->toIso8601String();
            // Retry pending webhook deliveries.
            $pending = DB::table('webhook_deliveries')
                ->where('status', 'pending')
                ->whereNotNull('next_attempt_at')
                ->where('next_attempt_at', '<=', $now)
                ->orderBy('next_attempt_at')
                ->orderBy('id')
                ->limit(20)
                ->pluck('id');
            foreach ($pending as $id) {
                WebhookService::enqueueExisting((int) $id);
            }
        });

        $run('mail_outbox', fn () => $this->recoverAndQueueMailOutbox());
        $run('invitation_budget_retention', fn () => InvitationMailBudget::purgeExpired());

        $heavyDue = false;
        $run('heavy_schedule', function () use (&$heavyDue): void {
            $intervalMs = max(1, (int) config('uvh.housekeeping.interval_minutes', 60)) * 60_000;
            $last = (int) Cache::get('uvh:housekeeping:last_heavy', 0);
            $heavyDue = (int) floor(microtime(true) * 1000) - $last >= $intervalMs;
        });
        if ($heavyDue) {
            $retentionOk = $this->runPurges();
            $failed = ! $retentionOk || $failed;
            if ($retentionOk) {
                $run('retention_checkpoint', function (): void {
                    if (Cache::put('uvh:housekeeping:last_heavy', (int) floor(microtime(true) * 1000)) !== true) {
                        throw new \RuntimeException('No se pudo guardar el checkpoint de housekeeping');
                    }
                });
            }
        }

        // A partial pass is not healthy: monitoring must continue to report the
        // last completely successful cycle while isolated stages keep running.
        if (! $failed) {
            $run('heartbeat', function (): void {
                if (Cache::put('uvh:health:scheduler', time(), now()->addMinutes(10)) !== true) {
                    throw new \RuntimeException('No se pudo guardar el heartbeat del scheduler');
                }
            });
        }

        return $failed ? self::FAILURE : self::SUCCESS;
    }

    private function runStage(string $stage, callable $callback): bool
    {
        try {
            $callback();

            return true;
        } catch (\Throwable $e) {
            // Console output is commonly shipped to central logging. Keep SQL
            // bindings, hostnames and bearer material out of this channel.
            $this->error('[housekeeping] '.$stage.' failed: '.$e::class);
            OperationalMetrics::increment('housekeeping.stage_failed');

            return false;
        }
    }

    /**
     * Apply scheduled/expired transitions in bounded, locked batches and admit
     * the corresponding webhook in the same transaction. A bulk SQL update
     * would leave external consumers permanently unaware of automatic state
     * changes.
     */
    private function transitionDueLinks(): void
    {
        $batch = 100;
        for ($pass = 0; $pass < 10; $pass++) {
            $changed = DB::transaction(function () use ($batch): int {
                $now = now();
                $links = Link::query()
                    ->whereNull('deleted_at')
                    ->where(function ($query) use ($now) {
                        $query->where(function ($scheduled) use ($now) {
                            $scheduled->where('state', 'scheduled')
                                ->whereNotNull('scheduled_at')
                                ->where('scheduled_at', '<=', $now);
                        })->orWhere(function ($expired) use ($now) {
                            $expired->where('state', 'active')
                                ->whereNotNull('expires_at')
                                ->where('expires_at', '<', $now);
                        });
                    })
                    ->orderBy('id')
                    ->limit($batch)
                    ->lock('for update skip locked')
                    ->get();

                foreach ($links as $link) {
                    $next = $link->expires_at !== null && $link->expires_at->lt($now)
                        ? 'expired'
                        : 'active';
                    $link->update([
                        'state' => $next,
                        'version' => (int) $link->version + 1,
                        'updated_at' => $now,
                    ]);
                    WebhookService::dispatch((int) $link->workspace_id, 'link.updated', [
                        'linkId' => (int) $link->id,
                        'alias' => (string) $link->alias,
                        'state' => $next,
                    ]);
                }

                return $links->count();
            });

            if ($changed < $batch) {
                return;
            }
        }
    }

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
                    ->update(['status' => 'failed', 'updated_at' => now()]);
                if ($updated === 1 && is_string($export->artifact_path) && $export->artifact_path !== '') {
                    PrivateArtifactCleanup::attempt((int) $export->id, $export->artifact_path);
                }
            }

            // Export files are private, encrypted and deliberately short-lived.
            // Claim each expiry transition before deleting its concrete path so a
            // concurrent download cannot race a blind filesystem sweep.
            $expiredExports = DB::table('data_export_requests')
                ->where(function ($query) use ($nowIso) {
                    $query->where(function ($requested) use ($nowIso) {
                        $requested->where('status', 'requested')->where('confirmation_expires_at', '<', $nowIso);
                    })->orWhere(function ($ready) use ($nowIso) {
                        $ready->where('status', 'ready')->where('download_expires_at', '<', $nowIso);
                    });
                })
                ->orderBy('id')->limit(100)->get(['id', 'status', 'artifact_path']);
            foreach ($expiredExports as $export) {
                $updated = DB::table('data_export_requests')
                    ->where('id', $export->id)->where('status', $export->status)
                    ->update([
                        'status' => 'expired',
                        'confirmation_token_hash' => null,
                        'download_token_hash' => null,
                        'updated_at' => now(),
                    ]);
                if ($updated === 1 && is_string($export->artifact_path) && $export->artifact_path !== '') {
                    PrivateArtifactCleanup::attempt((int) $export->id, $export->artifact_path);
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
            DB::delete('DELETE FROM metric_unique_visitors WHERE day < ?', [substr($retentionCutoff, 0, 10)]);
        });

        return $ok;
    }

    /** Recover queue publication/worker crashes and admit a bounded mail batch. */
    private function recoverAndQueueMailOutbox(): void
    {
        $stale = now()->subMinutes(10);
        DB::table('mail_outbox')
            ->where('status', 'queued')
            ->where('queued_at', '<=', $stale)
            ->update([
                'status' => 'pending',
                'queued_at' => null,
                'available_at' => now(),
                'last_error' => 'queue_timeout',
                'updated_at' => now(),
            ]);
        DB::table('mail_outbox')
            ->where('status', 'processing')
            ->where('locked_at', '<=', $stale)
            ->update([
                'status' => 'pending',
                'locked_at' => null,
                'lock_token' => null,
                'available_at' => now(),
                'last_error' => 'worker_timeout',
                'updated_at' => now(),
            ]);
        DB::table('mail_outbox')
            ->where('status', 'compensating')
            ->where('locked_at', '<=', $stale)
            ->update([
                'status' => 'comp_pending',
                'locked_at' => null,
                'lock_token' => null,
                'available_at' => now(),
                'last_error' => 'compensation_timeout',
                'updated_at' => now(),
            ]);

        $compensations = DB::table('mail_outbox')
            ->where('status', 'comp_pending')->where('available_at', '<=', now())
            ->orderBy('available_at')->orderBy('id')->limit(25)->pluck('id');
        foreach ($compensations as $id) {
            MailOutboxCompensation::attempt((int) $id);
        }

        $ids = DB::table('mail_outbox')
            ->where('status', 'pending')
            ->where('available_at', '<=', now())
            ->orderBy('available_at')
            ->orderBy('id')
            ->limit(50)
            ->pluck('id');
        foreach ($ids as $id) {
            MailOutboxDispatcher::enqueue((int) $id);
        }
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

                    return null;
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

                    return ['blocked' => true, 'mail_unconfirmed' => true, 'user_id' => (int) $user->id, 'artifacts' => []];
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

                    return ['blocked' => true, 'mail_unconfirmed' => false, 'user_id' => (int) $user->id, 'artifacts' => []];
                }

                $artifacts = DB::table('data_export_requests')->where('user_id', $user->id)
                    ->whereNotNull('artifact_path')->get(['id', 'artifact_path'])
                    ->filter(fn ($row) => is_string($row->artifact_path) && $row->artifact_path !== '')
                    ->map(fn ($row) => ['id' => (int) $row->id, 'path' => $row->artifact_path])
                    ->values()->all();
                DB::table('data_export_requests')->where('user_id', $user->id)->update([
                    'status' => DB::raw("CASE WHEN status = 'downloaded' THEN status ELSE 'cancelled' END"),
                    'confirmation_token_hash' => null,
                    'download_token_hash' => null,
                    'updated_at' => now(),
                ]);
                DB::table('sessions')->where('user_id', $user->id)->delete();
                DB::table('email_tokens')->where('user_id', $user->id)->delete();
                DB::table('email_change_requests')->where('user_id', $user->id)->delete();
                DB::table('memberships')->where('user_id', $user->id)->delete();
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

                return ['blocked' => false, 'mail_unconfirmed' => false, 'user_id' => (int) $user->id, 'artifacts' => $artifacts];
            });

            if (! $result) {
                continue;
            }
            foreach ($result['artifacts'] ?? [] as $artifact) {
                PrivateArtifactCleanup::attempt($artifact['id'], $artifact['path']);
            }
            try {
                LinkIntentRegistry::revokeForUser($result['user_id']);
            } catch (\Throwable) {
                // The inverse index remains available for the next scheduled
                // housekeeping pass; the deleted account cannot authenticate.
            }
            $action = $result['mail_unconfirmed']
                ? 'account.deletion_cancelled_mail_unconfirmed'
                : ($result['blocked'] ? 'account.deletion_blocked' : 'account.deletion_executed');
            Audit::write($result['user_id'], $action, 'account_deletion', $id);
        }
    }

    /**
     * Admit a bounded batch of periodic DNS checks. The worker owns the cache
     * lock and a database generation makes any delayed result harmless.
     */
    private function queueDomainRevalidations(): void
    {
        $healthyCutoff = now()->subHours(max(1, (int) config('uvh.custom_domains.revalidation_hours', 24)));
        $failureCutoff = now()->subHours(max(1, (int) config('uvh.custom_domains.failure_retry_hours', 1)));

        $ids = CustomDomain::where('state', 'active')
            ->where(function ($query) {
                $query->whereNull('dns_check_started_at')
                    ->orWhereColumn('dns_check_completed_at', '>=', 'dns_check_started_at');
            })
            ->where(function ($query) use ($healthyCutoff, $failureCutoff) {
                $query->where(function ($healthy) use ($healthyCutoff) {
                    $healthy->whereNull('dns_error')
                        ->where(function ($due) use ($healthyCutoff) {
                            $due->whereNull('dns_check_completed_at')
                                ->orWhere('dns_check_completed_at', '<=', $healthyCutoff);
                        });
                })->orWhere(function ($failed) use ($failureCutoff) {
                    $failed->whereNotNull('dns_error')
                        ->where(function ($due) use ($failureCutoff) {
                            $due->whereNull('dns_check_completed_at')
                                ->orWhere('dns_check_completed_at', '<=', $failureCutoff);
                        });
                });
            })
            ->orderByRaw('dns_check_completed_at NULLS FIRST')
            ->orderBy('id')
            ->limit(20)
            ->pluck('id');

        foreach ($ids as $id) {
            $snapshot = CustomDomain::where('id', $id)->first(['workspace_id']);
            if (! $snapshot) {
                continue;
            }
            $workspaceId = (int) $snapshot->workspace_id;
            $dedupeKey = 'uvh:domain-verification:'.$workspaceId.':'.(int) $id;
            $lock = Cache::lock($dedupeKey, 600);
            if (! $lock->get()) {
                continue;
            }

            $dispatched = false;
            try {
                $prepared = DB::transaction(function () use ($id, $workspaceId): ?array {
                    $domain = CustomDomain::where('id', $id)
                        ->where('workspace_id', $workspaceId)
                        ->where('state', 'active')
                        ->lockForUpdate()
                        ->first();
                    if (! $domain || $this->dnsCheckInProgress($domain) || ! $this->dnsCheckDue($domain)) {
                        return null;
                    }

                    $version = (int) $domain->verification_version + 1;
                    $domain->update([
                        'verification_version' => $version,
                        'dns_check_started_at' => now(),
                        'dns_error' => null,
                        'updated_at' => now(),
                    ]);

                    return [
                        'domain' => $domain->domain,
                        'token' => $domain->verification_token,
                        'version' => $version,
                    ];
                });
                if (! $prepared) {
                    continue;
                }

                try {
                    VerifyDomainDnsJob::dispatch(
                        (int) $id,
                        $workspaceId,
                        null,
                        $prepared['domain'],
                        $prepared['token'],
                        'active',
                        $prepared['version'],
                        $dedupeKey,
                        $lock->owner(),
                    )->afterCommit();
                    $dispatched = true;
                } catch (\Throwable $e) {
                    CustomDomain::where('id', $id)
                        ->where('workspace_id', $workspaceId)
                        ->where('verification_version', $prepared['version'])
                        ->where('state', 'active')
                        ->update([
                            'dns_check_completed_at' => now(),
                            'dns_error' => 'queue_unavailable',
                            'updated_at' => now(),
                        ]);
                    report($e);
                }
            } finally {
                if (! $dispatched) {
                    try {
                        $lock->release();
                    } catch (\Throwable $e) {
                        // A bounded orphaned lease is less harmful than
                        // aborting all remaining retention and recovery work.
                        OperationalMetrics::increment('lock.unavailable');
                        report($e);
                    }
                }
            }
        }
    }

    private function dnsCheckInProgress(CustomDomain $domain): bool
    {
        return DomainRevalidationSchedule::isInProgress($domain);
    }

    private function dnsCheckDue(CustomDomain $domain): bool
    {
        return DomainRevalidationSchedule::isDue($domain);
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
