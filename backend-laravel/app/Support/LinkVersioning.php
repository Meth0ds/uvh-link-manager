<?php

namespace App\Support;

use App\Models\Link;
use App\Models\LinkVersion;

/** Captures safe, user-visible link configuration inside the write transaction. */
final class LinkVersioning
{
    /** @return array<string, mixed> */
    public static function configuration(Link $link): array
    {
        $link->loadMissing(['domain', 'collection', 'tags']);
        $rules = $link->rules()->orderBy('priority')->orderBy('id')->get();

        return [
            'name' => $link->name,
            'destination' => $link->destination,
            'fallbackDestination' => $link->fallback_destination,
            'domainId' => $link->domain_id,
            'domain' => $link->domain?->domain,
            'alias' => $link->alias,
            'collectionId' => $link->collection_id,
            'collection' => $link->collection?->name,
            'tags' => $link->tags->pluck('name')->values()->all(),
            'notes' => $link->notes,
            'maxClicks' => $link->max_clicks,
            'singleUse' => (bool) $link->single_use,
            'scheduledAt' => $link->scheduled_at?->toIso8601String(),
            'expiresAt' => $link->expires_at?->toIso8601String(),
            'socialPreview' => $link->social_preview,
            'expiredPage' => ExpiredLinkPage::canonical($link->expired_page),
            'utm' => ['source' => $link->utm_source, 'medium' => $link->utm_medium, 'campaign' => $link->utm_campaign, 'term' => $link->utm_term, 'content' => $link->utm_content],
            'rules' => $rules->map(fn ($rule) => $rule->only(['id', 'priority', 'country', 'language', 'device', 'os', 'time_from', 'time_to', 'referrer', 'campaign', 'destination']))->values()->all(),
        ];
    }

    /** @param array<string, mixed>|null $previous */
    public static function capture(Link $link, int $actorUserId, string $source, ?array $previous = null): LinkVersion
    {
        // Mutations such as tag/rule sync can leave Eloquent's relationship
        // cache holding the pre-write collection. Always re-read the safe
        // configuration before persisting a snapshot.
        $link->unsetRelation('domain')->unsetRelation('collection')->unsetRelation('tags')->unsetRelation('rules');
        $configuration = self::configuration($link);
        $encoded = json_encode($configuration, JSON_UNESCAPED_UNICODE | JSON_UNESCAPED_SLASHES | JSON_THROW_ON_ERROR);
        $changed = $previous === null ? null : self::changedFields($previous, $configuration);
        // PostgreSQL cannot combine FOR UPDATE with MAX(). Lock the latest
        // concrete row instead; the link write transaction already serializes
        // normal edits, and the unique key remains the final concurrency fence.
        $latest = LinkVersion::where('link_id', $link->id)->orderByDesc('revision')->lockForUpdate()->value('revision');
        $revision = ((int) $latest) + 1;

        return LinkVersion::create([
            'workspace_id' => $link->workspace_id,
            'link_id' => $link->id,
            'revision' => $revision,
            'link_version' => (int) $link->version,
            'actor_user_id' => $actorUserId,
            'source' => $source,
            'configuration' => $configuration,
            'configuration_hash' => hash('sha256', $encoded),
            'changed_fields' => $changed,
            'created_at' => now(),
        ]);
    }

    /**
     * @param  array<string, mixed>  $before
     * @param  array<string, mixed>  $after
     * @return list<string>
     */
    public static function changedFields(array $before, array $after): array
    {
        $fields = [];
        foreach (array_unique([...array_keys($before), ...array_keys($after)]) as $field) {
            if (json_encode($before[$field] ?? null) !== json_encode($after[$field] ?? null)) {
                $fields[] = $field;
            }
        }

        return $fields;
    }
}
