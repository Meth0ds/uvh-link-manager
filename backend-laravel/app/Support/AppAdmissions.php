<?php

namespace App\Support;

use App\Models\Link;
use Carbon\CarbonImmutable;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

/** Called only while RedirectService owns the link's exclusive admission lock. */
final class AppAdmissions
{
    /** @param array<string, mixed> $ctx */
    public static function proof(Link $link, array $ctx): ?object
    {
        $token = $ctx['app_grant'] ?? null;
        $claims = is_string($token) ? SignedToken::verify($token, fn ($v) => json_decode($v, true)) : null;
        if (! is_array($claims) || ($claims['purpose'] ?? '') !== 'app-admission' || ! Str::isUuid($claims['id'] ?? '')) {
            return null;
        }
        $row = DB::table('app_link_admissions')->where('id', $claims['id'])->where('link_id', $link->id)->first();

        return $row && self::current($row, $link, $ctx) ? $row : null;
    }

    /** @param array<string, mixed> $ctx */
    private static function current(object $row, Link $link, array $ctx): bool
    {
        $version = self::profileVersion($link, $ctx);
        if (($link->app_opening['kind'] ?? '') === 'native' && ! config('app_links.native') || ($link->app_opening['kind'] ?? '') === 'provider' && ! config('app_links.providers')) {
            return false;
        }

        return (int) $row->link_version === (int) $link->version
            && (int) $row->password_version === (int) $link->password_version
            && ($row->profile_version === null ? null : (int) $row->profile_version) === $version
            && CarbonImmutable::parse($row->expires_at)->isFuture()
            && hash_equals($row->context_hash, self::contextHash($ctx));
    }

    /** @param array<string, mixed> $ctx */
    private static function profileVersion(Link $link, array $ctx): ?int
    {
        if (($link->app_opening['kind'] ?? '') !== 'native') {
            return null;
        }
        if (array_key_exists('app_profile_version', $ctx)) {
            return $ctx['app_profile_version'];
        }
        $profile = AppOpening::profile($link->app_opening['profileId'], (int) $link->workspace_id, $link->domain_id);

        return $profile ? (int) $profile->version : -1;
    }

    /** @param array<string, mixed> $ctx */
    private static function contextHash(array $ctx): string
    {
        return hash('sha256', json_encode([RedirectService::canonicalHost($ctx['host']), UrlUtil::normalizeAlias($ctx['alias']), QrAttribution::token($ctx['qr_public_id'] ?? null)], JSON_THROW_ON_ERROR));
    }

    /** @param array<string, mixed> $ctx
     * @return array<string, mixed>|null
     */
    public static function replay(Link $link, array $ctx): ?array
    {
        $row = self::proof($link, $ctx);
        if (! $row && is_string($ctx['app_attempt_id'] ?? null) && Str::isUuid($ctx['app_attempt_id'])) {
            $row = DB::table('app_link_admissions')->where('link_id', $link->id)->where('attempt_id', $ctx['app_attempt_id'])->first();
            if ($row && ! self::current($row, $link, $ctx)) {
                return ['kind' => 'unavailable', 'reason' => 'changed'];
            }
        }
        if (! $row) {
            return ! empty($ctx['app_grant']) ? ['kind' => 'unavailable', 'reason' => 'changed'] : null;
        }

        return self::outcome($row);
    }

    /** @return array<string, mixed> */
    private static function outcome(object $row): array
    {
        $result = json_decode(UvhCrypto::decryptAtRest($row->outcome_encrypted), true, 32, JSON_THROW_ON_ERROR);
        if (! is_string($result['location'] ?? null) || ! UrlUtil::validateDestination($result['location'])['ok'] || DestinationDenylist::reason($result['location']) !== null || (isset($result['app']['url']) && DestinationDenylist::reason($result['app']['url']) !== null)) {
            return ['kind' => 'unavailable', 'reason' => 'destination'];
        }
        $ttl = max(1, min(300_000, (int) (CarbonImmutable::parse($row->expires_at)->getTimestampMs() - now()->getTimestampMs())));
        $result['grant'] = SignedToken::sign(json_encode(['purpose' => 'app-admission', 'id' => $row->id], JSON_THROW_ON_ERROR), $ttl);
        $result['admission_id'] = $row->id;
        $result['analytics_recorded'] = true;

        return $result;
    }

    /** @param array<string, mixed> $ctx
     * @param  array<string, mixed>  $result
     * @return array<string, mixed>
     */
    public static function record(Link $link, array $ctx, array $result): array
    {
        $ua = Ua::parse($ctx['user_agent'] ?? null);
        $id = (string) Str::uuid();
        $meta = [
            'country' => $ctx['country'] ?? null, 'device' => $ua['device'], 'browser' => $ua['browser'], 'os' => $ua['os'],
            'referrer_domain' => RedirectService::referrerDomain($ctx['referrer'] ?? null),
            'campaign' => $result['campaign'] ?? null, 'qr_variant_id' => $result['qr_variant_id'] ?? null,
            'visitor_hash' => ! empty($ctx['ip']) && ! empty($ctx['user_agent']) ? UvhCrypto::visitorHash(now('UTC')->format('Y-m-d'), $ctx['ip'], $ctx['user_agent']) : null,
        ];
        // Consumption, event and receipt commit together; replay never enqueues
        // another event, including after a lost response or a single-use visit.
        AnalyticsService::recordClick((int) $link->id, $meta, $id);
        $expiry = now()->addSeconds(min(300, (int) config('app_links.receipt_seconds', 300)));
        if ($link->expires_at && $link->expires_at->lt($expiry)) {
            $expiry = $link->expires_at;
        }
        DB::table('app_link_admissions')->insert([
            'id' => $id, 'link_id' => $link->id, 'attempt_id' => $ctx['app_attempt_id'] ?? (string) Str::uuid(),
            'link_version' => $link->version, 'password_version' => $link->password_version,
            'profile_version' => self::profileVersion($link, $ctx), 'context_hash' => self::contextHash($ctx),
            'outcome_encrypted' => UvhCrypto::encryptAtRest(json_encode($result, JSON_THROW_ON_ERROR)),
            'expires_at' => $expiry, 'created_at' => now(),
        ]);

        return self::outcome(DB::table('app_link_admissions')->where('id', $id)->first());
    }
}
