<?php

namespace App\Support\Auth;

use App\Support\SessionManager;
use App\Support\UvhRequest;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class CredentialChangeResponse
{
    /**
     * Only clear the browser identity if this bearer revoked its own account.
     *
     * @param  array{message?: string, executeAfter?: string}  $extra
     */
    public static function forUser(Request $request, int $userId, array $extra = []): JsonResponse
    {
        $current = UvhRequest::user($request)?->id === $userId;
        $response = response()->json([...$extra, 'ok' => true, 'current' => $current]);

        return $current ? $response->withCookie(SessionManager::clearCookie()) : $response;
    }
}
