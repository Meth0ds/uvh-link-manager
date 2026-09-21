<?php

declare(strict_types=1);

/**
 * Accounts and audit: the rows the moderation drill counts, and the one way an
 * environment without a real authenticator can produce an administrative
 * session. That last one grants authority deliberately and says so in its
 * output.
 */

use App\Support\SessionManager;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

return [
    'audit-count' => static function (string $argument): array {
        [$action, $resourceId] = array_pad(preg_split('/\s+/', trim($argument)) ?: [], 2, '');

        return ['count' => (int) DB::table('audit_events')->where('action', $action)
            ->where('resource_id', $resourceId)->count()];
    },
    // An administrative session for the operator surfaces, in the only way an
    // environment without a real authenticator can produce one. It grants
    // authority deliberately and prints that fact: the drill is about what the
    // administrative retry does, never about whether the admin gate holds,
    // which is proven elsewhere against the real middleware.

    'admin-session' => static function (string $argument): array {
        $user = DB::table('users')->whereRaw('lower(email) = ?', [mb_strtolower($argument)])->first(['id', 'security_version']);
        if (! $user) {
            return ['error' => 'unknown account'];
        }
        DB::table('users')->where('id', (int) $user->id)->update([
            'is_admin' => true, 'mfa_enabled' => true, 'updated_at' => now(),
        ]);
        $token = SessionManager::create((int) $user->id, Request::create('/'), (int) $user->security_version, true);

        return ['token' => $token, 'user_id' => (int) $user->id, 'granted_admin' => true];
    },
    // The publication half of the mail recovery stage: housekeeping opens the
    // backoff window and hands pending rows to the dispatcher. Driving it from
    // here lets the exhaustion and compensation drills cover five durable
    // attempts without waiting out 60/300/900/1800 seconds of real backoff.

    'invitations' => static fn (string $argument): array => DB::table('invitations')->orderBy('id')->get([
        'id', 'workspace_id', 'email', 'role', 'status', 'created_at',
    ])->map(static fn ($row): array => [
        'id' => (int) $row->id,
        'workspace_id' => (int) $row->workspace_id,
        'email' => (string) $row->email,
        'role' => (string) $row->role,
        'status' => (string) $row->status,
    ])->all(),
];
