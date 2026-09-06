<?php

namespace App\Support;

use App\Models\User;
use App\Models\UvhSession;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Hash;

/** Shared verification for operations that already hold user/session row locks. */
class MfaStepUp
{
    /** @return array{status: string, factor?: string, recovery_codes?: array<int, string>} */
    public static function verify(
        User $user,
        UvhSession $session,
        string $password,
        string $factorCode,
        bool $requirePreviouslyVerified = true,
    ): array {
        if (! Hash::check($password, $user->password_hash)) {
            return ['status' => 'password'];
        }
        if (! $user->mfa_enabled) {
            return ['status' => 'ok', 'factor' => 'password_only'];
        }
        if ($requirePreviouslyVerified && $session->mfa_verified_at === null) {
            return ['status' => 'stale'];
        }

        $factorCode = trim($factorCode);
        if (preg_match('/^\d{6}$/D', $factorCode)) {
            if (! is_string($user->mfa_secret) || $user->mfa_secret === '') {
                return ['status' => 'factor'];
            }
            try {
                $secret = UvhCrypto::decryptAtRest($user->mfa_secret);
            } catch (\Throwable) {
                return ['status' => 'factor'];
            }
            $counter = Totp::matchingCounter($factorCode, $secret);
            if ($counter === null) {
                return ['status' => 'factor'];
            }
            $factor = substr(hash('sha256', $secret), 0, 24);
            try {
                $reserved = Cache::add('uvh:mfa:totp-used:'.$user->id.':'.$factor.':'.$counter, true, now()->addMinutes(3));
            } catch (\Throwable $error) {
                throw new MfaInfrastructureUnavailable('MFA replay store unavailable', 0, $error);
            }
            if (! $reserved) {
                return ['status' => 'factor'];
            }

            return ['status' => 'ok', 'factor' => 'totp'];
        }

        $normalized = strtoupper((string) preg_replace('/[\s-]+/', '', $factorCode));
        if (! preg_match('/^[A-Z2-9]{16}$/D', $normalized) || ! is_array($user->recovery_codes)) {
            return ['status' => 'factor'];
        }
        $target = Ids::sha256Hex($normalized);
        $match = null;
        foreach ($user->recovery_codes as $index => $hash) {
            if (is_string($hash) && strlen($hash) === 64 && hash_equals($hash, $target)) {
                $match = (int) $index;
            }
        }
        if ($match === null) {
            return ['status' => 'factor'];
        }
        $remaining = $user->recovery_codes;
        array_splice($remaining, $match, 1);

        return ['status' => 'ok', 'factor' => 'recovery', 'recovery_codes' => $remaining];
    }
}
