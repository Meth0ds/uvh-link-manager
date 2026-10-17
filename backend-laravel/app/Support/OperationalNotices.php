<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/** Bounded, replay-safe reminders. Never include credentials or destination URLs. */
final class OperationalNotices
{
    public static function sweep(): void
    {
        $hours = max(1, min(168, (int) config('workflows.reminder_hours', 24)));
        $ratio = max(0.01, min(0.99, (float) config('workflows.reminder_click_ratio', 0.9)));
        /** @var list<array{string, string, string, string, ?string}> $specs */
        $specs = [
            ['links', NotificationKinds::LINK_EXPIRING, "expires_at > now() AND expires_at <= now() + interval '$hours hours' AND deleted_at IS NULL AND state IN ('active','scheduled') AND (max_clicks IS NULL OR click_count < max_clicks) AND (NOT single_use OR used_at IS NULL)", 'expires_at', 'alias'],
            ['links', NotificationKinds::LINK_LIMIT_APPROACHING, "deleted_at IS NULL AND max_clicks IS NOT NULL AND state = 'active' AND click_count >= max_clicks * $ratio AND click_count < max_clicks AND (expires_at IS NULL OR expires_at > now()) AND (NOT single_use OR used_at IS NULL)", 'max_clicks', 'alias'],
            ['api_tokens', NotificationKinds::API_TOKEN_EXPIRING, "revoked_at IS NULL AND expires_at > now() AND expires_at <= now() + interval '7 days'", 'expires_at', 'name'],
            ['invitations', NotificationKinds::INVITATION_EXPIRING, "status = 'pending' AND expires_at > now() AND expires_at <= now() + interval '24 hours'", 'expires_at', null],
            ['webhook_deliveries', NotificationKinds::WEBHOOK_EXHAUSTED, "status = 'failed' AND created_at > now() - interval '30 days'", 'attempts', null],
        ];
        foreach ($specs as [$table, $kind, $condition, $generation, $subject]) {
            $counter = match ($kind) {
                NotificationKinds::LINK_EXPIRING => 'expiry_notice_generation',
                NotificationKinds::LINK_LIMIT_APPROACHING => 'limit_notice_generation',
                default => null,
            };
            $generationSql = $counter === null ? 'CAST('.$generation.' AS TEXT)'
                : "CASE WHEN $counter = 1 THEN CAST($generation AS TEXT) ELSE CAST($generation AS TEXT) || ':' || CAST($counter AS TEXT) END";
            $aliasedGenerationSql = preg_replace('/\b('.preg_quote($generation, '/').($counter !== null ? '|'.preg_quote($counter, '/') : '').')\b/', 'r.$1', $generationSql);
            $rows = DB::table($table.' as r')->whereRaw($condition)
                ->whereNotExists(function ($query) use ($kind, $aliasedGenerationSql): void {
                    $query->selectRaw('1')->from('operational_notice_events as n')
                        ->where('n.kind', $kind)->whereColumn('n.resource_id', 'r.id')
                        ->whereRaw('n.generation = ('.$aliasedGenerationSql.')');
                })->select('r.*')->selectRaw('('.$aliasedGenerationSql.') AS notice_generation')
                ->when($table === 'webhook_deliveries', static fn ($query) => $query->selectRaw('(SELECT workspace_id FROM webhooks WHERE id = r.webhook_id) AS workspace_id'))
                ->orderBy('r.id')->limit(20)->get();
            foreach ($rows as $row) {
                $candidateIds = DB::table('memberships')->where('workspace_id', $row->workspace_id)
                    ->where(function ($query) use ($table, $row): void {
                        $query->whereIn('role', ['owner', 'admin']);
                        if ($table === 'links' && config('workflows.enabled') && $row->created_by !== null) {
                            $query->orWhere('user_id', $row->created_by);
                        }
                    })->pluck('user_id')->all();
                DB::transaction(static function () use ($row, $kind, $subject, $candidateIds, $table, $condition, $generationSql): void {
                    $users = User::whereIn('id', $candidateIds)->orderBy('id')->lockForUpdate()->get();
                    if (! DB::table('workspaces')->where('id', $row->workspace_id)->lockForUpdate()->first()) {
                        return;
                    }
                    $resource = DB::table($table)->where('id', $row->id)->whereRaw($condition)
                        ->whereRaw('('.$generationSql.') = ?', [$row->notice_generation])->lockForUpdate()->first();
                    if (! $resource) {
                        return;
                    }
                    $workspaceId = (int) $row->workspace_id;
                    $memberIds = DB::table('memberships')->where('workspace_id', $workspaceId)
                        ->where(function ($query) use ($table, $resource): void {
                            $query->whereIn('role', ['owner', 'admin']);
                            if ($table === 'links' && config('workflows.enabled') && $resource->created_by !== null) {
                                $query->orWhere('user_id', $resource->created_by);
                            }
                        })->pluck('user_id')->all();
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
                    $subjectData = $subject === null ? ['version' => 1, 'type' => 'review', 'label' => ''] : null;
                    if ($table === 'links' && config('workflows.enabled')) {
                        $subjectData = ['version' => 1, 'label' => $label] + ($kind === NotificationKinds::LINK_EXPIRING
                            ? ['type' => 'expiry', 'expiresAt' => Carbon::parse($resource->expires_at)->utc()->toIso8601String()]
                            : ['type' => 'remaining', 'remaining' => max(0, (int) $resource->max_clicks - (int) $resource->click_count)]);
                        $label .= $kind === NotificationKinds::LINK_EXPIRING
                            ? ' · Caduca el '.Carbon::parse($resource->expires_at)->utc()->format('d/m/Y H:i').' UTC'
                            : ' · '.max(0, (int) $resource->max_clicks - (int) $resource->click_count).' clics disponibles';
                    }
                    $route = $table === 'links' && config('workflows.enabled')
                        ? '/app/links/'.$row->id.'?workspaceId='.$workspaceId : null;
                    foreach ($recipients as $user) {
                        $dedupe = hash('sha256', $kind.':'.$row->id.':'.$row->notice_generation);
                        $delivery = NotificationInbox::record((int) $user->id, $kind, $workspaceId, $label, $dedupe, $route, $subjectData);
                        if ($delivery === 'immediate' && ! MailLanguage::render($user->email, static fn (): bool => UvhMail::operationalNotice(
                            $user->email, $kind, NotificationSubject::render($label, $subjectData) ?? '',
                            $route !== null ? FrontendUrl::base().$route : null, Language::current(),
                        ))) {
                            throw new MailAdmissionException('Operational reminder admission failed');
                        }
                    }
                });
            }
        }
    }
}
