<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Why the platform is refusing traffic to a link.
 *
 * A block leaves no reason on the link itself: the reason is in the decision
 * that produced it — a moderation decision, the reputation sweep, the denylist —
 * and the audit trail keeps every one of them. This class is the single reader
 * of that trail for that question, so the owner's notice and any other surface
 * that has to explain a block answer the same thing.
 *
 * Two traps are what make this a reader of its own instead of one more query:
 * a decision taken on a report is recorded against the report, not against the
 * link it blocks, so both scopes have to be read; and only the newest
 * transition decides, because an older one describes a block that was already
 * lifted.
 */
final class LinkBlockReason
{
    private const BLOCKS = ['admin.link_block', 'system.link_block'];

    private const RELEASES = ['admin.link_unblock', 'system.link_release'];

    /** A moderation decision: block, unblock, review or dismiss, on a report. */
    private const MODERATION = 'admin.report_moderate';

    /** A decision on an appeal records the state the link was left in. */
    private const APPEAL_DECISION = 'admin.link_appeal_resolved';

    /** Bounds on each scope, so one busy link or workspace cannot blow the read. */
    private const LINK_WINDOW = 50;

    private const MODERATION_WINDOW = 200;

    /**
     * The reason for the block standing right now, or null when the trail does
     * not carry one.
     *
     * Null is a legitimate answer — a link can arrive blocked from a path that
     * records no reason — and a caller that prints it must say the block without
     * inventing a cause.
     */
    public static function forLink(int $linkId, int $workspaceId): ?string
    {
        foreach (self::candidates($linkId, $workspaceId) as $event) {
            $metadata = self::metadata($event->metadata);
            $blocked = self::transition((string) $event->action, $metadata);
            if ($blocked === null) {
                continue;
            }

            return $blocked ? self::reason($metadata) : null;
        }

        return null;
    }

    /**
     * Every event that can have decided this link's state, newest first.
     *
     * @return list<object>
     */
    private static function candidates(int $linkId, int $workspaceId): array
    {
        $onTheLink = DB::table('audit_events')
            ->select(['id', 'action', 'metadata'])
            ->where('resource_type', 'link')
            ->where('resource_id', (string) $linkId)
            ->whereIn('action', [...self::BLOCKS, ...self::RELEASES, self::APPEAL_DECISION])
            ->orderByDesc('id')
            ->limit(self::LINK_WINDOW)
            ->get();

        // A moderation decision names the report it resolves; the link it blocks
        // is inside the event, so the workspace's decisions are read and the
        // ones about this link are kept.
        $onItsReport = DB::table('audit_events')
            ->select(['id', 'action', 'metadata'])
            ->where('action', self::MODERATION)
            ->where('workspace_id', $workspaceId)
            ->orderByDesc('id')
            ->limit(self::MODERATION_WINDOW)
            ->get()
            ->filter(fn ($event) => (string) (self::metadata($event->metadata)['linkId'] ?? '') === (string) $linkId)
            ->values();

        return $onTheLink
            ->concat($onItsReport)
            ->sortByDesc('id')
            ->values()
            ->all();
    }

    /**
     * Whether the event left the link blocked, took it out of that state, or
     * says nothing about the link's state at all.
     *
     * @param  array<string, mixed>  $metadata
     */
    private static function transition(string $action, array $metadata): ?bool
    {
        if (in_array($action, self::BLOCKS, true)) {
            return true;
        }
        if (in_array($action, self::RELEASES, true)) {
            return false;
        }
        if ($action === self::MODERATION) {
            return match ($metadata['action'] ?? null) {
                'block' => true,
                'unblock' => false,
                // Review and dismiss change the report, never the link.
                default => null,
            };
        }
        if ($action === self::APPEAL_DECISION) {
            // A granted appeal is what lifts a block; an upheld one leaves the
            // block that was already there standing, and its own reason with it.
            return ($metadata['state'] ?? null) === 'active' ? false : null;
        }

        return null;
    }

    /**
     * The reason the decision gave, bounded like the field the operator filled.
     *
     * @param  array<string, mixed>  $metadata
     */
    private static function reason(array $metadata): ?string
    {
        $reason = $metadata['reason'] ?? null;
        if (! is_string($reason)) {
            return null;
        }

        $reason = trim($reason);

        return $reason === '' ? null : mb_substr($reason, 0, 300);
    }

    /**
     * An event's `metadata` as an array.
     *
     * The column is `jsonb` and the query builder hands it back decoded, but the
     * same column arrives as text wherever a raw read or another driver is in
     * play; both shapes are accepted rather than one being assumed.
     *
     * @return array<string, mixed>
     */
    private static function metadata(mixed $raw): array
    {
        if (is_string($raw)) {
            $decoded = json_decode($raw, true);

            return is_array($decoded) ? $decoded : [];
        }

        return is_array($raw) ? $raw : [];
    }
}
