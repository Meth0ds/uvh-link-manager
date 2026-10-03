<?php

namespace App\Support\Auth;

use App\Support\Ids;
use App\Support\MfaInfrastructureUnavailable;
use App\Support\Totp;
use App\Support\UvhCrypto;
use Illuminate\Support\Facades\Cache;

/** Factor algorithms shared by login, enrollment and authenticated step-up. */
final class MfaFactorVerification
{
    public static function decryptSecret(?string $encrypted): ?string
    {
        if (! is_string($encrypted) || $encrypted === '') {
            return null;
        }

        try {
            return UvhCrypto::decryptAtRest($encrypted);
        } catch (\Throwable) {
            return null;
        }
    }

    /** Consume one TOTP counter once per concrete factor across all workers. */
    public static function consumeTotp(int $userId, string $code, string $secret): bool
    {
        $counter = Totp::matchingCounter($code, $secret);
        if ($counter === null) {
            return false;
        }

        $factor = substr(hash('sha256', $secret), 0, 24);

        try {
            return Cache::add(
                'uvh:mfa:totp-used:'.$userId.':'.$factor.':'.$counter,
                true,
                now()->addMinutes(3),
            );
        } catch (\Throwable $error) {
            throw new MfaInfrastructureUnavailable('MFA replay store unavailable', 0, $error);
        }
    }

    /**
     * Constant-time comparison across the small fixed recovery set.
     *
     * @param  array<array-key, mixed>  $hashes
     */
    public static function recoveryIndex(array $hashes, string $code): ?int
    {
        $target = Ids::sha256Hex($code);
        $match = null;
        foreach ($hashes as $index => $hash) {
            if (is_string($hash) && strlen($hash) === 64 && hash_equals($hash, $target)) {
                $match = (int) $index;
            }
        }

        return $match;
    }
}
