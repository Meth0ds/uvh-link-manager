<?php

namespace App\Support\Auth;

use App\Support\Ids;
use App\Support\MfaInfrastructureUnavailable;
use Illuminate\Support\Facades\Cache;

/**
 * Shared MFA login challenges. The distributed lock coordinates TOTP/recovery;
 * the consumed marker prevents replay even if secret cleanup or SQL fails.
 * Cache reservations deliberately do not roll back with database transactions.
 */
final class MfaChallengeStore
{
    private const TTL_SECONDS = 300;

    private static function key(string $challenge): string
    {
        return 'uvh:mfa:challenge:'.Ids::sha256Hex($challenge);
    }

    public static function store(string $challenge, int $userId, int $securityVersion): void
    {
        try {
            $stored = Cache::put(
                self::key($challenge),
                ['user_id' => $userId, 'security_version' => $securityVersion],
                now()->addSeconds(self::TTL_SECONDS),
            );
            if ($stored === false) {
                throw new \RuntimeException('MFA challenge store rejected write');
            }
        } catch (\Throwable $error) {
            throw new MfaInfrastructureUnavailable('MFA challenge store unavailable', 0, $error);
        }
    }

    /** @return array{user_id: int, security_version: int}|null */
    public static function get(string $challenge): ?array
    {
        if ($challenge === '' || strlen($challenge) > 128) {
            return null;
        }
        try {
            $value = Cache::get(self::key($challenge));
        } catch (\Throwable $error) {
            throw new MfaInfrastructureUnavailable('MFA challenge store unavailable', 0, $error);
        }

        return is_array($value) && isset($value['user_id'], $value['security_version'])
            ? ['user_id' => (int) $value['user_id'], 'security_version' => (int) $value['security_version']]
            : null;
    }

    public static function forget(string $challenge): void
    {
        try {
            Cache::forget(self::key($challenge));
        } catch (\Throwable $error) {
            throw new MfaInfrastructureUnavailable('MFA challenge store unavailable', 0, $error);
        }
    }

    public static function consume(string $challenge): bool
    {
        $key = self::key($challenge);
        if (self::get($challenge) === null) {
            return false;
        }
        try {
            $reserved = Cache::add($key.':consumed', true, now()->addSeconds(self::TTL_SECONDS));
        } catch (\Throwable $error) {
            throw new MfaInfrastructureUnavailable('MFA challenge store unavailable', 0, $error);
        }
        if (! $reserved) {
            return false;
        }

        try {
            Cache::forget($key);
        } catch (\Throwable $error) {
            // The consumed marker was already persisted. Report an explicit
            // infrastructure outage rather than a generic 500; the caller
            // must start a new challenge and cannot replay this one.
            throw new MfaInfrastructureUnavailable('MFA challenge store unavailable', 0, $error);
        }

        return true;
    }

    public static function lockKey(string $challenge): string
    {
        return self::key($challenge).':lock';
    }
}
