<?php

namespace App\Support;

use App\Exceptions\LinkException;
use App\Models\Link;
use Illuminate\Support\Facades\DB;

final class SocialPreview
{
    /** @return array<string, mixed>|null */
    public static function validate(mixed $spec, ?int $workspace = null): ?array
    {
        if ($spec === null) {
            return null;
        }
        if (! is_array($spec) || ($spec['version'] ?? null) !== 1 || ! is_bool($spec['enabled'] ?? null) || array_diff(array_keys($spec), ['version', 'enabled', 'title', 'description', 'imageAssetId', 'imageAlt'])) {
            throw new LinkException('La tarjeta social no es válida.', 422);
        }
        $title = AnalyticsReports::text($spec['title'] ?? '', 120, $spec['enabled']);
        $description = $spec['description'] ?? null;
        $alt = $spec['imageAlt'] ?? null;
        if ($description !== null) {
            $description = AnalyticsReports::text($description, 240);
        }
        if ($alt !== null) {
            $alt = AnalyticsReports::text($alt, 160);
        }
        $asset = $spec['imageAssetId'] ?? null;
        if ($asset !== null && (! is_int($asset) || $asset < 1)) {
            throw new LinkException('Imagen inválida.', 422);
        }
        if ($asset !== null && $workspace !== null && ! DB::table('social_preview_assets')->where('workspace_id', $workspace)->where('id', $asset)->where('status', 'ready')->sharedLock()->first(['id'])) {
            throw new LinkException('Esta imagen ya no está disponible en tu workspace.', 422);
        }

        return ['version' => 1, 'enabled' => $spec['enabled'], 'title' => $title, 'description' => $description, 'imageAssetId' => $asset, 'imageAlt' => $alt];
    }

    public static function isFetcher(?string $ua): bool
    {
        if (! is_string($ua) || strlen($ua) > 2048) {
            return false;
        }

        return preg_match('/(?:facebookexternalhit\/|Facebot\b|Twitterbot\/|LinkedInBot\/|Slackbot-LinkExpanding\b|Discordbot\/|TelegramBot\b)|^WhatsApp\/[0-9]/i', $ua) === 1;
    }

    public static function publishable(Link $link): bool
    {
        return ! $link->password_hash && self::eligible($link);
    }

    public static function eligible(Link $link): bool
    {
        return ! $link->deleted_at && $link->state === 'active'
            && (! $link->scheduled_at || ! $link->scheduled_at->isFuture())
            && (! $link->expires_at || $link->expires_at->isFuture())
            && (! $link->single_use || ! $link->used_at)
            && ($link->max_clicks === null || $link->click_count < $link->max_clicks)
            && UrlUtil::validateDestination($link->destination)['ok'] && DestinationDenylist::reason($link->destination) === null;
    }

    /** Pure read: never calls RedirectService::resolve or the matcher/analytics. */
    public static function lookup(string $host, string $alias): ?Link
    {
        $domain = RedirectService::resolveDomainId(RedirectService::normalizeHost($host));
        $alias = UrlUtil::normalizeAlias($alias);
        if ($domain === -1 || ! UrlUtil::isValidCustomAlias($alias) || UrlUtil::isReservedAlias($alias)) {
            return null;
        }
        $q = Link::whereRaw('lower(alias) = ?', [$alias])->whereNull('deleted_at');
        $domain === null ? $q->whereNull('domain_id') : $q->where('domain_id', $domain);

        return $q->sharedLock()->first();
    }
}
