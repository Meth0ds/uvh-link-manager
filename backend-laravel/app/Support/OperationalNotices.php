<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Facades\DB;

/** Bounded, replay-safe reminders. Never include credentials or destination URLs. */
final class OperationalNotices
{
    public static function sweep(): void
    {
        $specs = [
            ['links', NotificationKinds::LINK_EXPIRING, "expires_at > now() AND expires_at <= now() + interval '24 hours' AND deleted_at IS NULL AND state IN ('active','scheduled')", 'expires_at', 'alias'],
            ['links', NotificationKinds::LINK_LIMIT_APPROACHING, 'deleted_at IS NULL AND max_clicks IS NOT NULL AND state = \'active\' AND click_count >= max_clicks * 0.9', 'max_clicks', 'alias'],
            ['api_tokens', NotificationKinds::API_TOKEN_EXPIRING, "revoked_at IS NULL AND expires_at > now() AND expires_at <= now() + interval '7 days'", 'expires_at', 'name'],
            ['invitations', NotificationKinds::INVITATION_EXPIRING, "status = 'pending' AND expires_at > now() AND expires_at <= now() + interval '24 hours'", 'expires_at', null],
            ['webhook_deliveries', NotificationKinds::WEBHOOK_EXHAUSTED, "status = 'failed' AND created_at > now() - interval '30 days'", 'attempts', null],
        ];
        foreach ($specs as [$table, $kind, $condition, $generation, $subject]) {
            $rows = DB::table($table.' as r')->whereRaw($condition)
                ->whereNotExists(function ($query) use ($kind, $generation): void {
                    $query->selectRaw('1')->from('operational_notice_events as n')
                        ->where('n.kind', $kind)->whereColumn('n.resource_id', 'r.id')
                        ->whereRaw('n.generation = CAST(r.'.$generation.' AS TEXT)');
                })->select('r.*')->selectRaw('CAST(r.'.$generation.' AS TEXT) AS notice_generation')
                ->when($table === 'webhook_deliveries', static fn ($query) => $query->selectRaw('(SELECT workspace_id FROM webhooks WHERE id = r.webhook_id) AS workspace_id'))
                ->orderBy('r.id')->limit(20)->get();
            foreach ($rows as $row) {
                $candidateIds = DB::table('memberships')->where('workspace_id', $row->workspace_id)
                    ->whereIn('role', ['owner', 'admin'])->pluck('user_id')->all();
                DB::transaction(static function () use ($row, $kind, $subject, $candidateIds, $table, $condition, $generation): void {
                    $users = User::whereIn('id', $candidateIds)->orderBy('id')->lockForUpdate()->get();
                    if (! DB::table('workspaces')->where('id', $row->workspace_id)->lockForUpdate()->first()) {
                        return;
                    }
                    $resource = DB::table($table)->where('id', $row->id)->whereRaw($condition)
                        ->whereRaw('CAST('.$generation.' AS TEXT) = ?', [$row->notice_generation])->lockForUpdate()->first();
                    if (! $resource) {
                        return;
                    }
                    $workspaceId = (int) $row->workspace_id;
                    $memberIds = DB::table('memberships')->where('workspace_id', $workspaceId)
                        ->whereIn('role', ['owner', 'admin'])->pluck('user_id')->all();
                    // A newly admitted admin was not in the pre-lock user set.
                    // Retry on the next sweep rather than consume the ledger and
                    // omit them, or acquire another user lock after the workspace.
                    if (array_diff($memberIds, $users->modelKeys()) !== []) {
                        return;
                    }
                    // The ledger and all notifications/mail admission commit together.
                    if (DB::table('operational_notice_events')->insertOrIgnore([
                        'kind' => $kind, 'resource_id' => $row->id,
                        'generation' => $row->notice_generation, 'created_at' => now(),
                    ]) !== 1) {
                        return;
                    }
                    $recipients = $users->filter(static fn (User $user): bool => ! $user->deleted_at && $user->email_verified_at !== null
                        && in_array($user->id, $memberIds, true));
                    $label = $subject !== null ? (string) $resource->{$subject} : 'Revisa los recursos de tu workspace';
                    foreach ($recipients as $user) {
                        $dedupe = hash('sha256', $kind.':'.$row->id.':'.$row->notice_generation);
                        $delivery = NotificationInbox::record((int) $user->id, $kind, $workspaceId, $label, $dedupe);
                        if ($delivery === 'immediate' && ! UvhMail::operationalNotice($user->email, $kind, $label)) {
                            throw new MailAdmissionException('Operational reminder admission failed');
                        }
                    }
                });
            }
        }
    }
}
