<?php

namespace App\Http\Controllers\Concerns;

use App\Support\MailTransportPolicy;
use App\Support\OperationalMetrics;
use App\Support\ProductionSecurity;
use App\Support\QueueBacklog;
use App\Support\RegistrationGate;
use Carbon\Carbon;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

trait AdminOperationsQueries
{
    /** Return operator-facing health without exposing secrets or topology. */
    public function operations()
    {
        $environment = app()->environment();
        $production = $environment === 'production';
        $queueHeartbeatAge = $this->heartbeatAge('queue');
        $schedulerHeartbeatAge = $this->heartbeatAge('scheduler');
        $checks = [
            $this->operationCheck('environment', __('display.display_e69fc723f1e93f'), $production, __('display.display_e60e4bff8a2306'), $production),
            $this->operationCheck('debug', __('display.display_aa65b01053c1dc'), ! (bool) config('app.debug'), __('display.display_2f14084a4ec55c'), $production),
            $this->operationCheck('https', __('display.display_4664659b8c725d'), str_starts_with((string) config('app.url'), 'https://'), __('display.display_9ae74a466dbd6d'), $production),
            $this->operationCheck(
                'cookies',
                __('display.display_50bd7ec5072609'),
                (bool) config('uvh.cookie_secure')
                    && (string) config('uvh.cookie_domain') === ''
                    && str_starts_with((string) config('uvh.session_cookie'), '__Host-')
                    && str_starts_with((string) config('uvh.csrf_cookie'), '__Host-'),
                __('display.display_b40ea0ee5ad056'),
                $production,
            ),
            $this->operationCheck('hsts', 'HSTS', (bool) config('uvh.hsts_enabled'), __('display.display_be320ee8346146'), $production),
            $this->operationCheck(
                'trusted_proxies',
                __('display.display_fe28421328a080'),
                ProductionSecurity::validTrustedProxies((string) config('uvh.trusted_proxies')),
                __('display.display_036bc456b88448'),
                $production,
            ),
            $this->operationCheck(
                'database',
                __('display.display_793a63885906e8'),
                config('database.default') === 'pgsql' && config('database.connections.pgsql.sslmode') === 'verify-full',
                __('display.display_e440f268387e17'),
                $production,
            ),
            $this->operationCheck(
                'cache',
                __('display.display_0fbaa995e6091f'),
                in_array((string) config('cache.default'), ['database', 'redis', 'memcached', 'dynamodb'], true),
                __('display.display_83a443cf0547b6'),
                $production,
            ),
            $this->operationCheck(
                'queue',
                __('display.display_1ab5c91a1ea075'),
                ! in_array((string) config('queue.default'), ['', 'sync', 'null', 'background', 'deferred'], true),
                __('display.display_013a905c2a77b9'),
                $production,
            ),
            $this->operationCheck(
                'queue_worker',
                __('display.display_a7507524cc1dfa'),
                $queueHeartbeatAge !== null && $queueHeartbeatAge <= 180,
                __('display.display_56adc872bc6fe9'),
                $production,
            ),
            $this->operationCheck(
                'scheduler',
                __('display.display_6dc295258d080f'),
                $schedulerHeartbeatAge !== null && $schedulerHeartbeatAge <= 210,
                __('display.display_8fd180383c09c1'),
                $production,
            ),
            $this->operationCheck(
                'mail',
                __('display.display_2305447b38bbf6'),
                MailTransportPolicy::deliveryLeaves(config('mail')) !== null,
                __('display.display_70c1bd0c805250'),
                $production,
            ),
            $this->operationCheck(
                'hcaptcha',
                'hCaptcha',
                trim((string) config('uvh.hcaptcha.site_key')) !== '' && trim((string) config('uvh.hcaptcha.secret')) !== '',
                __('display.display_7d02c26e1fd56c'),
                $production,
            ),
            $this->operationCheck(
                'custom_domain_edge',
                __('display.display_3cba1505d3fb43'),
                ProductionSecurity::validHostname(strtolower(trim((string) config('uvh.custom_domains.cname_target'), '.')))
                    && strlen((string) config('uvh.custom_domains.edge_ask_secret')) >= 43,
                __('display.display_edc0d11afa1f18'),
                $production,
            ),
        ];

        // Depth and age are asked of the configured broker, not of the `jobs`
        // table: that table is only populated by the database driver, so with
        // Redis as the broker the panel would have reported an empty queue
        // forever. The oldest job overall is the maximum of the per-pool ages.
        $jobCount = 0;
        $oldestJobAge = null;
        foreach (QueueBacklog::pools() as $queueName) {
            $jobCount += QueueBacklog::pending($queueName) ?? 0;
            $poolAge = QueueBacklog::oldestAgeSeconds($queueName);
            if ($poolAge !== null) {
                $oldestJobAge = max($oldestJobAge ?? 0, $poolAge);
            }
        }
        $failedJobs = DB::table('failed_jobs')->count();
        // The same bounded-cardinality counters exported to Prometheus are
        // surfaced here so an operator can diagnose the last hour even before
        // an external monitoring stack is connected. No route or actor labels
        // are persisted in operational_metrics.
        $events60m = OperationalMetrics::totals(60);
        $deliveryCounts = $this->countsByState('webhook_deliveries', 'status');
        // created_at intentionally survives retries: an old delivery must not
        // look young simply because housekeeping re-enqueued it recently.
        $oldestPendingWebhook = DB::table('webhook_deliveries')
            ->whereIn('status', ['pending', 'processing'])
            ->min('created_at');
        $oldestPendingWebhookAge = $oldestPendingWebhook !== null
            ? max(0, time() - Carbon::parse($oldestPendingWebhook)->getTimestamp())
            : null;
        $mailOutboxCounts = $this->countsByState('mail_outbox', 'status');
        $oldestPendingMail = DB::table('mail_outbox')
            ->whereIn('status', ['pending', 'queued', 'processing', 'comp_pending', 'compensating'])
            ->min('created_at');
        $oldestPendingMailAge = $oldestPendingMail !== null
            ? max(0, time() - Carbon::parse($oldestPendingMail)->getTimestamp())
            : null;
        $checks[] = $this->operationCheck(
            'mail_queue_age',
            __('display.display_52dc74359bb9fc'),
            $oldestPendingMailAge === null || $oldestPendingMailAge <= 600,
            __('display.display_85da4cd1bf163d'),
            $production,
        );
        $domainCounts = $this->countsByState('custom_domains', 'desired_state');
        foreach ($this->countsByState('custom_domains', 'tls_status') as $status => $count) {
            $domainCounts['tls_'.$status] = $count;
        }
        // A check is in progress while its start is newer than its completion —
        // the state label no longer knows about checks, the timestamps do.
        $oldestDnsCheck = DB::table('custom_domains')
            ->whereNotNull('dns_check_started_at')
            ->where(function ($inProgress) {
                $inProgress->whereNull('dns_check_completed_at')
                    ->orWhereColumn('dns_check_started_at', '>', 'dns_check_completed_at');
            })
            ->min('dns_check_started_at');
        $oldestDnsCheckAge = $oldestDnsCheck !== null
            ? max(0, time() - Carbon::parse($oldestDnsCheck)->getTimestamp())
            : null;
        $oldestTlsProvisioning = DB::table('custom_domains')->where('tls_status', 'provisioning')->min('updated_at');
        $oldestTlsProvisioningAge = $oldestTlsProvisioning !== null
            ? max(0, time() - Carbon::parse($oldestTlsProvisioning)->getTimestamp())
            : null;
        // These thresholds match housekeeping recovery windows. Crossing one
        // means the automated recovery should already have acted, so the
        // state is operationally actionable rather than normal queue latency.
        $checks[] = $this->operationCheck(
            'webhook_queue_age',
            __('display.display_4ea52a85f31127'),
            $oldestPendingWebhookAge === null || $oldestPendingWebhookAge <= 600,
            __('display.display_113305bef6a0bc'),
            $production,
        );
        $checks[] = $this->operationCheck(
            'dns_check_age',
            __('display.display_6a921ccce190a0'),
            $oldestDnsCheckAge === null || $oldestDnsCheckAge <= 600,
            __('display.display_66a7e1c651d99e'),
            $production,
        );
        $checks[] = $this->operationCheck(
            'tls_provisioning_age',
            __('display.display_6f82b6fee4a54d'),
            $oldestTlsProvisioningAge === null || $oldestTlsProvisioningAge <= 3600,
            __('display.display_cd4de7f3e8b6f0'),
            $production,
        );
        $activeSessions = DB::table('sessions')
            ->whereNull('revoked_at')
            ->where('expires_at', '>', now())
            ->count();
        // Registros que esperan demostrar su buzón. El censo de usuarios sin
        // verificar ya no existe: una fila de usuario está verificada, y quien
        // aún no lo está es un registro pendiente con su propia cola.
        $pendingRegistrations = DB::table('pending_registrations')->count();
        $activePrivacyRequests = DB::table('privacy_rights_requests')
            ->whereIn('status', ['submitted', 'in_progress', 'waiting_user'])->count();
        $overduePrivacyRequests = DB::table('privacy_rights_requests')
            ->whereIn('status', ['submitted', 'in_progress', 'waiting_user'])
            ->whereRaw('COALESCE(extended_until, due_at) < NOW()')->count();

        $state = collect($checks)->contains(fn ($check) => $check['status'] === 'critical')
            ? 'critical'
            : (collect($checks)->contains(fn ($check) => $check['status'] === 'warning')
                || $failedJobs > 0
                || ($deliveryCounts['failed'] ?? 0) > 0
                || ($mailOutboxCounts['failed'] ?? 0) > 0
                || ($mailOutboxCounts['comp_pending'] ?? 0) > 0
                || ($mailOutboxCounts['compensating'] ?? 0) > 0
                // Availability/durability failures make the summary require
                // attention for the same 60-minute window shown to operators.
                // Invalid hCaptcha attempts and 429s remain informational:
                // they can reflect expected hostile or quota-limited traffic.
                || ($events60m['http.server_error'] ?? 0) > 0
                || ($events60m['hcaptcha.unavailable'] ?? 0) > 0
                || ($events60m['audit.write_failed'] ?? 0) > 0
                || ($events60m['housekeeping.stage_failed'] ?? 0) > 0
                || $overduePrivacyRequests > 0
                ? 'attention'
                : 'healthy');

        return response()->json([
            'state' => $state,
            'environment' => $environment,
            'generatedAt' => now()->toIso8601String(),
            'registrationPaused' => RegistrationGate::isPaused(),
            'checks' => $checks,
            'metrics' => [
                'pendingJobs' => $jobCount,
                'oldestJobAgeSeconds' => $oldestJobAge,
                'failedJobs' => $failedJobs,
                // These four are maps of counts, and a client reads them as one:
                // an empty PHP array encodes as `[]`, which is not an object and
                // makes a strict reader reject the whole snapshot. Casting keeps
                // an empty map a map.
                'webhookDeliveries' => (object) $deliveryCounts,
                'oldestPendingWebhookAgeSeconds' => $oldestPendingWebhookAge,
                'mailOutbox' => (object) $mailOutboxCounts,
                'oldestPendingMailAgeSeconds' => $oldestPendingMailAge,
                'activeSessions' => $activeSessions,
                'pendingRegistrations' => $pendingRegistrations,
                'domains' => (object) $domainCounts,
                'oldestDnsCheckAgeSeconds' => $oldestDnsCheckAge,
                'oldestTlsProvisioningAgeSeconds' => $oldestTlsProvisioningAge,
                'events60m' => (object) $events60m,
                'queueHeartbeatAgeSeconds' => $queueHeartbeatAge,
                'schedulerHeartbeatAgeSeconds' => $schedulerHeartbeatAge,
                'activePrivacyRequests' => $activePrivacyRequests,
                'overduePrivacyRequests' => $overduePrivacyRequests,
            ],
        ]);
    }

    /** @return array<string, int> */
    private function countsByState(string $table, string $column): array
    {
        return DB::table($table)
            ->select($column, DB::raw('COUNT(*) as aggregate'))
            ->groupBy($column)
            ->pluck('aggregate', $column)
            ->map(fn ($value) => (int) $value)
            ->all();
    }

    private function heartbeatAge(string $component): ?int
    {
        try {
            $value = Cache::get('uvh:health:'.$component);
            if (! is_int($value) && ! (is_string($value) && ctype_digit($value))) {
                return null;
            }

            return max(0, time() - (int) $value);
        } catch (\Throwable) {
            return null;
        }
    }

    /** @return array{key: string, label: string, status: string, detail: string|null} */
    private function operationCheck(string $key, string $label, bool $passes, string $failure, bool $critical): array
    {
        return [
            'key' => $key,
            'label' => $label,
            'status' => $passes ? 'ok' : ($critical ? 'critical' : 'warning'),
            'detail' => $passes ? null : $failure,
        ];
    }
}
