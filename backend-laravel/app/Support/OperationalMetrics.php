<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/** PII-free, bounded-cardinality operational counters. */
final class OperationalMetrics
{
    public const ALLOWED = [
        'http.server_error',
        'http.slow_request',
        // Aggregate every HTTP 429 without a route/account label. Operators
        // can detect capacity or abuse pressure without creating a cardinality
        // explosion or persisting an identifier derived from the requester.
        'http.too_many_requests',
        'hcaptcha.valid',
        'hcaptcha.invalid',
        'hcaptcha.unavailable',
        'mfa.failure',
        'mfa.infrastructure_unavailable',
        'mail.sent',
        'mail.retry_scheduled',
        'mail.failed',
        'mail.obsolete',
        'mail.manual_retry',
        'mail.compensation_pending',
        'mail.compensated',
        'invitation.budget_rejected',
        'invitation.budget_unavailable',
        'export.cleaned',
        'export.cleanup_failed',
        'export.download_unavailable',
        'export.download_ack_unavailable',
        'export.memory_budget_rejected',
        'export.queue_recovered',
        'export.queue_unavailable',
        'export.too_large',
        'analytics.record_failed',
        // Valores distintos descartados al alcanzar el tope del mapa diario. Un
        // mapa recortado sin contador es un sesgo que nadie puede ver.
        'analytics.map_keys_dropped',
        'audit.write_failed',
        'privacy.decrypt_failed',
        'dns.verified',
        'dns.failed',
        'dns.job_stale',
        'tls.ready',
        'tls.failed',
        'webhook.success',
        'webhook.retry_scheduled',
        'webhook.failed',
        'webhook.admission_failed',
        'housekeeping.stage_failed',
        'lock.unavailable',
        // Destination reputation. A blocked link, a moderation case opened from
        // a provider verdict and a failed lookup are three different operational
        // facts, so they are three different series: an alert on
        // `provider_unavailable` must not be satisfiable by blocking links.
        'reputation.blocked',
        // A block the platform applied to itself and then withdrew. Separate
        // from `blocked` on purpose: block and release churning on the same link
        // is a provider whose verdicts are flapping, and that is a different
        // alert from "we are blocking more abuse than usual".
        'reputation.released',
        'reputation.moderated',
        'reputation.appeal_opened',
        'reputation.check_failed',
        'reputation.provider_unavailable',
        // El proveedor contestó algo que este contrato no entiende. No es lo
        // mismo que `provider_unavailable`: aquí sí hubo respuesta, y una
        // respuesta ilegible es un cambio de integración que hay que mirar.
        'reputation.verdict_unusable',
        'reputation.reanalysis_scheduled',
        // El barrido de reanálisis dejó candidatos sin encolar. Sin esta serie,
        // un bloqueo aplicado a medias se lee como un bloqueo completo.
        'reputation.reanalysis_truncated',
        // Una continuación del barrido que la cola no admitió. El bloqueo
        // quedó, por tanto, incompleto más allá del cursor: se vigila aparte
        // para que un fallo al terminar no se lea como "ya terminó".
        'reputation.sweep_continuation_failed',
        // Un veredicto descartado porque el enlace cambió mientras se calculaba
        // (o porque la fila ya no existe). No es un fallo del proveedor ni un
        // bloqueo: es una carrera que se resolvió del lado seguro, y una tasa
        // alta sí es una señal — significa que el trabajo llega tarde.
        'reputation.decision_discarded',
        'reputation.domain_listed',
        // Un job auxiliar que la cola no admite. Distinto de `check_failed`: la
        // comprobación nunca llegó a intentarse.
        'reputation.dispatch_failed',
        // Rate limiting counts on Redis first and falls back to PostgreSQL when
        // it is unreachable, so public traffic keeps being served. The fallback
        // is recorded because a silent one would hide a failing dependency.
        'cache.failed_over',
        // Queue depth and age come from the configured driver. A failed read
        // must be distinguishable from a genuinely empty queue, otherwise a
        // monitoring gap looks like a healthy idle system.
        'queue.metrics_unavailable',
    ];

    private static bool $reportingFailure = false;

    public static function increment(string $metric, int $amount = 1): void
    {
        if (! in_array($metric, self::ALLOWED, true) || $amount < 1 || $amount > 1_000_000) {
            return;
        }

        // A missing metrics table or transient database error must never mark
        // a business transaction as aborted on PostgreSQL. Defer the auxiliary
        // write until the outer transaction has committed successfully.
        if (DB::transactionLevel() > 0) {
            try {
                DB::afterCommit(static fn () => self::increment($metric, $amount));
            } catch (\Throwable $error) {
                self::logFailure($error);
            }

            return;
        }

        try {
            $bucket = now()->utc()->startOfMinute();
            DB::statement(
                'INSERT INTO operational_metrics (metric, bucket_at, count) VALUES (?, ?, ?) '
                .'ON CONFLICT (metric, bucket_at) DO UPDATE SET count = LEAST(9223372036854775807, operational_metrics.count + EXCLUDED.count)',
                [$metric, $bucket, $amount],
            );
        } catch (\Throwable $error) {
            // Metrics are auxiliary and must never turn an authentication or
            // delivery result into a failure. Emit one generic diagnostic and
            // avoid recursion if the logging pipeline itself reports errors.
            self::logFailure($error);
        }
    }

    private static function logFailure(\Throwable $error): void
    {
        if (self::$reportingFailure) {
            return;
        }
        self::$reportingFailure = true;
        try {
            Log::warning('[metrics] counter write unavailable', ['exception' => $error::class]);
        } finally {
            self::$reportingFailure = false;
        }
    }

    /** @return array<string, int> */
    public static function totals(int $minutes = 60): array
    {
        $minutes = max(1, min(1440, $minutes));
        $rows = DB::table('operational_metrics')
            ->where('bucket_at', '>=', now()->subMinutes($minutes))
            ->whereIn('metric', self::ALLOWED)
            ->groupBy('metric')
            ->orderBy('metric')
            ->get(['metric', DB::raw('SUM(count) AS total')]);

        // Export every approved series even when no event occurred. A stable
        // zero lets Prometheus rules distinguish healthy inactivity from an
        // absent/renamed metric. Unknown legacy rows are deliberately omitted.
        $totals = array_fill_keys(self::ALLOWED, 0);
        foreach ($rows as $row) {
            $metric = (string) $row->metric;
            if (array_key_exists($metric, $totals)) {
                $totals[$metric] = (int) $row->total;
            }
        }

        return $totals;
    }
}
