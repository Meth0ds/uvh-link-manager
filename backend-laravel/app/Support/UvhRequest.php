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

    public static function user(Request $request): ?User
    {
        return $request->attributes->get(self::USER);
    }

    public static function sessionId(Request $request): ?string
    {
        return $request->attributes->get(self::SESSION_ID);
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
        return [
            'id' => $u->id,
            'email' => $u->email,
            'name' => $u->name,
            'isAdmin' => (bool) $u->is_admin,
            'emailVerified' => (bool) $u->email_verified_at,
            'mfaEnabled' => (bool) $u->mfa_enabled,
        ];
    }

    public static function ip(Request $request): ?string
    {
        return $request->ip();
    }
}
