<?php

namespace App\Support;

use App\Models\Membership;
use App\Models\User;
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
        $workspaceId = $header !== null && $header !== '' ? (int) $header : self::getDefaultWorkspace($user->id);
        if (! $workspaceId) {
            return null;
        }
        $m = self::getMembership($user->id, $workspaceId);

        return $m ? ['workspace_id' => $m->workspace_id, 'role' => $m->role] : null;
    }
}
