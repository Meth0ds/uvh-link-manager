<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/** SQL admission counters, committed or rolled back with invitation + outbox. */
final class InvitationMailBudget
{
    private const DAY = 86400;
    private const DEFAULT_LIMITS = [
        'actor_day' => 100, 'workspace_day' => 200, 'recipient_day' => 5,
        'ip_day' => 200, 'global_day' => 2000, 'recipient_cooldown' => 1,
    ];

    /** Pure configuration check shared by admission and release readiness. */
    public static function limits(): array
    {
        $limits = [];
        foreach (self::DEFAULT_LIMITS as $scope => $default) {
            $limit = config('uvh.invitation_mail_budget.'.$scope, $default);
            if (! is_int($limit) || $limit < 1 || $limit > 1_000_000) {
                throw new \InvalidArgumentException('Invalid invitation mail budget configuration');
            }
            $limits[$scope] = $limit;
        }
        return $limits;
    }

    /** Call only after locked authorization and conflict/capacity checks. */
    public static function reserve(int $actorId, int $workspaceId, string $email, ?string $ip): void
    {
        if (DB::transactionLevel() < 1) {
            throw new \LogicException('Invitation mail budgets require the caller transaction');
        }
        try {
            $limits = self::limits();
            $email = strtolower(trim($email));
            if ($actorId < 1 || $workspaceId < 1 || ! filter_var($email, FILTER_VALIDATE_EMAIL) || strlen($email) > 254) {
                throw new \InvalidArgumentException('Invalid invitation budget identity');
            }
            // Canonical binary addresses prevent alternative IPv6 spellings
            // from getting fresh quotas. Missing/invalid IPs share one fallback.
            $packedIp = is_string($ip) ? @inet_pton($ip) : false;
            if (is_string($packedIp) && strlen($packedIp) === 16
                && substr($packedIp, 0, 12) === str_repeat("\0", 10)."\xff\xff") {
                $packedIp = substr($packedIp, 12); // IPv4-mapped IPv6 shares IPv4's quota.
            }
            $subjects = [
                'actor_day' => [(string) $actorId, self::DAY],
                'workspace_day' => [(string) $workspaceId, self::DAY],
                'recipient_day' => [$email, self::DAY],
                'ip_day' => [$packedIp === false ? 'unknown' : bin2hex($packedIp), self::DAY],
                'global_day' => ['all', self::DAY],
                'recipient_cooldown' => [$email, 60],
            ];
            $budgets = [];
            foreach ($subjects as $scope => [$identity, $seconds]) {
                $limit = $limits[$scope];
                // Enforce every overlapping keyring generation. A rotation must
                // not erase yesterday's counts; operators retain old keys for
                // at least 24h after the last old-only writer has stopped.
                foreach (UvhCrypto::secrets() as $secret) {
                    $key = hash_hmac('sha256', 'uvh:invitation-budget:v1|'.$scope.'|'.$identity, $secret);
                    $budgets[$key] = ['limit' => $limit, 'seconds' => $seconds];
                }
            }
            ksort($budgets, SORT_STRING);
            $locked = [];
            foreach ($budgets as $key => $budget) {
                // Seed AND lock in the same global order, including first use.
                // The unique constraint makes insertOrIgnore wait on a competing
                // creator, then read its committed count under read-committed.
                DB::table('invitation_mail_budgets')->insertOrIgnore([
                    'budget_key' => $key, 'used' => 0, 'expires_at_epoch' => 0,
                ]);
                $row = DB::table('invitation_mail_budgets')->where('budget_key', $key)->lockForUpdate()->first();
                if (! $row) {
                    throw new \RuntimeException('Invitation budget row missing after admission');
                }
                $locked[$key] = $row;
            }
            // Read the DATABASE clock after waiting for all locks. Node clock
            // drift and lock waits must not change the effective reset boundary.
            $now = self::databaseEpoch();
            $retryAfter = 0;
            foreach ($budgets as $key => $budget) {
                $row = $locked[$key];
                if ((int) $row->expires_at_epoch > $now && (int) $row->used >= $budget['limit']) {
                    $retryAfter = max($retryAfter, (int) $row->expires_at_epoch - $now);
                }
            }
            if ($retryAfter > 0) {
                // Throw through the OUTER transaction: even seeded zero rows and
                // any expired-invitation normalization must disappear on rejection.
                throw new InvitationBudgetExceeded($retryAfter);
            }
            foreach ($budgets as $key => $budget) {
                $row = $locked[$key];
                $expired = (int) $row->expires_at_epoch <= $now;
                DB::table('invitation_mail_budgets')->where('budget_key', $key)->update([
                    'used' => $expired ? 1 : (int) $row->used + 1,
                    'expires_at_epoch' => $expired ? $now + $budget['seconds'] : (int) $row->expires_at_epoch,
                ]);
            }
        } catch (InvitationBudgetExceeded $error) {
            throw $error;
        } catch (\Throwable $error) {
            // Do not catch and return inside a PostgreSQL transaction: a failed
            // SQL statement can leave it aborted. The controller rolls it back.
            throw new InvitationBudgetUnavailable('Invitation mail budget unavailable', 0, $error);
        }
    }

    /** Bounded cleanup of inactive counters; active/locked rows are never reset. */
    public static function purgeExpired(): int
    {
        $cutoff = self::databaseEpoch() - self::DAY;
        return DB::delete(
            'DELETE FROM invitation_mail_budgets WHERE budget_key IN ('
            .'SELECT budget_key FROM invitation_mail_budgets WHERE expires_at_epoch < ? '
            .'ORDER BY budget_key LIMIT 500 FOR UPDATE SKIP LOCKED) AND expires_at_epoch < ?',
            [$cutoff, $cutoff],
        );
    }

    private static function databaseEpoch(): int
    {
        return (int) DB::selectOne('SELECT FLOOR(EXTRACT(EPOCH FROM clock_timestamp()))::bigint AS epoch')->epoch;
    }
}
