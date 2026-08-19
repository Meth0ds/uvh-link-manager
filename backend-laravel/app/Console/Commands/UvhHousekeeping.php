<?php

namespace App\Console\Commands;

use App\Support\WebhookService;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

class UvhHousekeeping extends Command
{
    protected $signature = 'uvh:housekeeping';

    protected $description = 'Scheduled link transitions, webhook retries and retention purges';

    public function handle(): int
    {
        $now = now()->toIso8601String();

        try {
            // Scheduled links become active.
            DB::update(
                "UPDATE links SET state = 'active', updated_at = ? WHERE state = 'scheduled' AND scheduled_at IS NOT NULL AND scheduled_at <= ?",
                [$now, $now],
            );

            // Expired links.
            DB::update(
                "UPDATE links SET state = 'expired', updated_at = ? WHERE state = 'active' AND expires_at IS NOT NULL AND expires_at < ?",
                [$now, $now],
            );

            // Retry pending webhook deliveries.
            $pending = DB::table('webhook_deliveries')
                ->where('status', 'pending')
                ->whereNotNull('next_attempt_at')
                ->where('next_attempt_at', '<=', $now)
                ->limit(20)
                ->pluck('id');
            foreach ($pending as $id) {
                WebhookService::resend((int) $id);
            }

            // Heavy pass, throttled.
            $intervalMs = ((int) env('HOUSEKEEPING_INTERVAL_MINUTES', 60)) * 60_000;
            $last = (int) Cache::get('uvh:housekeeping:last_heavy', 0);
            if ((int) floor(microtime(true) * 1000) - $last >= $intervalMs) {
                $this->runPurges();
                Cache::put('uvh:housekeeping:last_heavy', (int) floor(microtime(true) * 1000));
            }

            return self::SUCCESS;
        } catch (\Throwable $e) {
            $this->error('[housekeeping] job failed: '.$e->getMessage());

            return self::FAILURE;
        }
    }

    private function runPurges(): void
    {
        $batch = 1000;
        $nowIso = now()->toIso8601String();
        $cutoff = fn (int $days) => now()->subDays($days)->toIso8601String();

        $sessionCutoff = $cutoff($this->days('SESSION_PURGE_DAYS', 30));
        $this->purgeInBatches(
            'sessions', 'id',
            '(revoked_at IS NOT NULL AND revoked_at < ?) OR (revoked_at IS NULL AND expires_at < ?)',
            [$sessionCutoff, $sessionCutoff],
            $batch,
        );

        $tokenCutoff = $cutoff($this->days('TOKEN_PURGE_DAYS', 7));
        $this->purgeInBatches(
            'email_tokens', 'id',
            'created_at < ? AND (used_at IS NOT NULL OR expires_at < ?)',
            [$tokenCutoff, $nowIso],
            $batch,
        );

        $deliveryCutoff = $cutoff($this->days('DELIVERY_PURGE_DAYS', 90));
        $this->purgeInBatches(
            'webhook_deliveries', 'id',
            "status = 'success' AND delivered_at < ?",
            [$deliveryCutoff],
            $batch,
        );

        $auditCutoff = $cutoff($this->days('AUDIT_PURGE_DAYS', 365));
        $this->purgeInBatches('audit_events', 'id', 'created_at < ?', [$auditCutoff], $batch);

        $retentionCutoff = $cutoff($this->days('ANALYTICS_RETENTION_DAYS', 180));
        $this->purgeInBatches('click_events', 'id', 'occurred_at < ?', [$retentionCutoff], $batch);
        $this->purgeInBatches('metric_rollups', 'id', 'day < ?', [$retentionCutoff], $batch);
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
        $value = (int) env($key, $default);

        return max(1, $value);
    }
}
