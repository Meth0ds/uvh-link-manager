<?php

namespace App\Support;

use App\Models\Membership;
use App\Models\ApiToken;
use App\Models\User;
use App\Models\Workspace;
use Illuminate\Http\Request;

class WorkspaceAccess
{
    public const ROLE_ORDER = ['viewer', 'editor', 'admin', 'owner'];

    private const ROLE_RANK = ['viewer' => 0, 'editor' => 1, 'admin' => 2, 'owner' => 3];

    public static function roleAtLeast(string $role, string $min): bool
    {
        return (self::ROLE_RANK[$role] ?? -1) >= (self::ROLE_RANK[$min] ?? PHP_INT_MAX);
    }

    public static function getMembership(int $userId, int $workspaceId): ?Membership
    {
        return Membership::where('user_id', $userId)->where('workspace_id', $workspaceId)->first();
    }

    /**
     * Re-read authorization while holding the workspace parent-row lock.
     *
     * Every membership mutation also locks this row, so callers inside a
     * transaction cannot commit a tenant write after a completed removal or
     * demotion merely because middleware observed an older role.
     *
     * Lock order is deliberately account -> workspace -> child resource. The
     * account recheck closes the in-flight window after password/email/MFA
     * rotations or account deletion; acquiring it after the workspace would
     * invert the order used by lifecycle operations and invite deadlocks.
     */
    public static function getMembershipLocked(
        int $userId,
        int $workspaceId,
        string $min = 'viewer',
        ?array $apiTokenContext = null,
        ?string $requiredScope = null,
        ?int $expectedSecurityVersion = null,
    ): ?Membership
    {
        $account = User::where('id', $userId)->lockForUpdate()->first();
        if (! $account || $account->deleted_at || ! $account->email_verified_at
            || ($expectedSecurityVersion !== null
                && (int) $account->security_version !== $expectedSecurityVersion)) {
            return null;
        }

        if (! Workspace::where('id', $workspaceId)->lockForUpdate()->first()) {
            return null;
        }

        $membership = self::getMembership($userId, $workspaceId);
        if (! $membership || ! self::roleAtLeast($membership->role, $min)) {
            return null;
        }

        // Browser callers pass the security version observed by SessionAuth.
        // Bearer mutations additionally re-lock the exact token after the
        // workspace parent row, matching the revocation lock order. A revocation
        // or role reduction that already committed therefore cannot be bypassed
        // by a request which authenticated earlier and was waiting to write.
        if ($apiTokenContext !== null) {
            $tokenId = $apiTokenContext['token_id'] ?? null;
            if (! is_int($tokenId) || $tokenId < 1 || $requiredScope === null) {
                return null;
            }
            $token = ApiToken::where('id', $tokenId)
                ->where('workspace_id', $workspaceId)
                ->where('created_by', $userId)
                ->lockForUpdate()->first();
            $scopes = $token?->scopes;
            if (! $token || $token->revoked_at || ($token->expires_at && $token->expires_at->isPast())
                || ! is_array($scopes) || ! in_array($requiredScope, $scopes, true)) {
                return null;
            }
        }

        return $membership;
    }

    public static function getDefaultWorkspace(int $userId): ?int
    {
        $row = Membership::where('user_id', $userId)
            ->orderByRaw("CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END")
            ->orderBy('workspace_id')
            ->first();

        return $row?->workspace_id;
    }

    /**
     * Resolve the workspace from the X-Workspace-Id header or the user's default.
     *
     * @return array{workspace_id: int, role: string}|null
     */
    public static function resolve(User $user, Request $request): ?array
    {
        $header = $request->header('x-workspace-id');
        if ($header !== null && $header !== '') {
            if (! is_string($header) || ! preg_match('/^[1-9][0-9]{0,18}$/D', $header)) {
                return null;
            }
            $validated = filter_var($header, FILTER_VALIDATE_INT, ['options' => ['min_range' => 1]]);
            if ($validated === false) {
                return null;
            }
            $workspaceId = $validated;
        } else {
            $workspaceId = self::getDefaultWorkspace($user->id);
        }
        if (! $workspaceId) {
            return null;
        }
        $m = self::getMembership($user->id, $workspaceId);

        return $m ? ['workspace_id' => $m->workspace_id, 'role' => $m->role] : null;
    }
}
