<?php

namespace App\Console\Commands;

use App\Console\Commands\Concerns\RecoveryStages;
use App\Console\Commands\Concerns\RetentionStages;
use App\Models\Link;
use App\Support\AccountDeletionAudit;
use App\Support\AccountDeletionLifecycleAudit;
use App\Support\Audit;
use App\Support\Auth\SecurityIncidentAudit;
use App\Support\DomainClaims;
use App\Support\DomainEvents;
use App\Support\InvitationMailBudget;
use App\Support\OperationalMetrics;
use App\Support\OperationalNotices;
use App\Support\QrAssetCleanup;
use App\Support\WebhookService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class UvhHousekeeping extends Command
{
    use RecoveryStages;
    use RetentionStages;

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

        $run('protective_deletion_audits', fn () => AccountDeletionAudit::reconcile());
        $run('deletion_lifecycle_audits', fn () => AccountDeletionLifecycleAudit::reconcile());
        $run('protective_incident_audits', fn () => SecurityIncidentAudit::reconcile());

        $run('audit_outbox', function (): void {
            if (! Audit::drain()) {
                throw new \RuntimeException('Audit materialization unavailable');
            }
        });

        $run('operational_notices', fn () => OperationalNotices::sweep());

        $run('link_lifecycle', fn () => $this->transitionDueLinks());

        $run('stale_dns_claims', function (): void {
            // A queue outage after admission must not strand a domain with a
            // check that never finishes — the marker would suppress every
            // future retry. Jobs have a 15-second timeout; ten minutes leaves
            // ample queue latency while providing recovery. First checks and
            // revalidations are one condition now: an unfinished check is an
            // unfinished check, whatever the domain's health is.
            $stale = DB::table('custom_domains')
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
            if ($stale > 0) {
                OperationalMetrics::increment('dns.job_stale', $stale);
            }
        });

        $run('stale_tls_provisioning', function (): void {
            DB::table('custom_domains')
                ->where('tls_status', 'provisioning')
                ->where('updated_at', '<=', now()->subHour())
                ->update([
                    'tls_status' => 'error',
                    'edge_eligible' => false,
                    'tls_ready_at' => null,
                    'tls_error' => 'provisioning_timeout',
                    'tls_version' => DB::raw('tls_version + 1'),
                    'tls_next_retry_at' => now()->addHours(max(1, (int) config('uvh.custom_domains.tls_auto_retry_hours', 6))),
                    'updated_at' => now(),
                ]);
        });

        $run('domain_revalidation', fn () => $this->queueDomainRevalidations());
        $run('domain_tls_probe', fn () => $this->queueTlsProbeChecks());

        // Domain event delivery and claim hygiene live with the rest of the
        // recovery work: an outbox row a crash left behind, or a claim whose
        // holder deleted its request, heals here without anyone acting.
        $run('domain_events', fn () => DomainEvents::sweep());
        $run('domain_claims', fn () => DomainClaims::purgeOrphans());

        $run('destination_reputation', fn () => $this->queueDestinationRechecks());

        // The mirror of the sweep above: withdrawing a self-applied block whose
        // ground disappeared. It has no event to hang from when the entry simply
        // expires, and it runs whether or not a provider is configured, because
        // the question it answers — "is this destination still listed?" — is
        // local and needs no network call.
        $run('destination_release', fn () => $this->releaseUnlistedBlocks());

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
        $run('qr_asset_cleanup', fn () => QrAssetCleanup::run());
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
                // Query-builder DateTime bindings use second precision. Keep
                // the same microsecond instant for SQL and the locked decision.
                $nowSql = $now->format('Y-m-d H:i:s.uP');
                $links = Link::query()
                    ->whereNull('deleted_at')
                    ->where(function ($query) use ($nowSql) {
                        $query->where(function ($scheduled) use ($nowSql) {
                            $scheduled->where('state', 'scheduled')
                                ->whereNotNull('scheduled_at')
                                ->where('scheduled_at', '<=', $nowSql);
                        })->orWhere(function ($expired) use ($nowSql) {
                            $expired->where('state', 'active')
                                ->whereNotNull('expires_at')
                                ->where('expires_at', '<=', $nowSql);
                        });
                    })
                    ->orderBy('id')
                    ->limit($batch)
                    ->lock('for update skip locked')
                    ->get();

                foreach ($links as $link) {
                    $next = $link->expires_at !== null && $link->expires_at->lte($now)
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

    /**
     * Admit a bounded batch of periodic DNS checks. The worker owns the cache
     * lock and a database generation makes any delayed result harmless.
     */
}
