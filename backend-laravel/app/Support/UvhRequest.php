<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Http\Request;

final class UvhRequest
{
    public const USER = 'uvh.user';

    public const SESSION_ID = 'uvh.session_id';

    public const WORKSPACE_ID = 'uvh.workspace_id';

    public const ROLE = 'uvh.role';

    public const API_TOKEN = 'uvh.api_token';

    public const CSRF_TOKEN = 'uvh.csrf_token';

    public const CSRF_ISSUED = 'uvh.csrf_issued';

    public const MFA_VERIFIED = 'uvh.mfa_verified';

    public const MFA_VERIFIED_AT = 'uvh.mfa_verified_at';

    public static function user(Request $request): ?User
    {
        return $request->attributes->get(self::USER);
    }

    public static function sessionId(Request $request): ?string
    {
        return $request->attributes->get(self::SESSION_ID);
    }

    public static function mfaVerified(Request $request): bool
    {
        return $request->attributes->get(self::MFA_VERIFIED) === true;
    }

    public static function mfaVerifiedAt(Request $request): ?\DateTimeInterface
    {
        $value = $request->attributes->get(self::MFA_VERIFIED_AT);

        return $value instanceof \DateTimeInterface ? $value : null;
    }

    public static function workspaceId(Request $request): ?int
    {
        return $request->attributes->get(self::WORKSPACE_ID);
    }

    public static function role(Request $request): ?string
    {
        return $request->attributes->get(self::ROLE);
    }

    public static function apiToken(Request $request): ?array
    {
        return $request->attributes->get(self::API_TOKEN);
    }

    /**
     * @return array<string, mixed>
     */
    public static function publicUser(User $u): array
    {
        $pendingEmail = $u->emailChangeRequest()
            ->where('expires_at', '>', now())
            ->where('security_version', (int) $u->security_version)
            ->first();

        return [
            'id' => $u->id,
            'email' => $u->email,
            'name' => $u->name,
            'isAdmin' => (bool) $u->is_admin,
            'emailVerified' => (bool) $u->email_verified_at,
            'mfaEnabled' => (bool) $u->mfa_enabled,
            // Only expose an aggregate. Recovery credentials themselves are
            // write-only and are never returned after their initial issue.
            'recoveryCodesRemaining' => is_array($u->recovery_codes) ? count($u->recovery_codes) : 0,
            'pendingEmail' => $pendingEmail?->new_email,
            'pendingEmailExpiresAt' => $pendingEmail?->expires_at?->toIso8601String(),
        ];
    }

    public static function ip(Request $request): ?string
    {
        return $request->ip();
    }

    /**
     * Read a body/query input only when it is actually a string.
     *
     * PHP's explicit string cast emits an ErrorException for arrays under
     * Laravel's error handler. Treating malformed JSON as the caller's default
     * keeps validation deterministic and prevents user input from becoming a
     * 500 before the controller can return its normal 4xx response.
     */
    public static function inputString(Request $request, string $key, string $default = ''): string
    {
        $value = $request->input($key, $default);

        return is_string($value) ? $value : $default;
    }

    public static function queryString(Request $request, string $key, string $default = ''): string
    {
        $value = $request->query($key, $default);

        return is_string($value) ? $value : $default;
    }
}
