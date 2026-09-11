<?php

namespace App\Support;

use App\Models\CustomDomain;
use App\Models\Link;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

class RedirectService
{
    public const UNLOCK_COOKIE = 'uvh_unlock';

    public static function normalizeHost(string $host): string
    {
        return strtolower(preg_replace('/:\d+$/', '', $host) ?? $host);
    }

    /**
     * Map a Host header to a domain_id (null = default public host, -1 = unknown).
     */
    public static function resolveDomainId(string $host): ?int
    {
        $h = self::normalizeHost($host);
        $publicHost = strtolower((string) config('uvh.public_host'));
        if ($h === $publicHost || $h === "www.{$publicHost}") {
            return null;
        }
        $row = CustomDomain::where('domain', $h)
            ->where('state', 'active')
            ->where('edge_eligible', true)
            ->whereNotNull('tls_ready_at')
            ->value('id');

        return $row ?? -1;
    }

    /**
     * @param  array{host: string, alias: string, user_agent?: ?string, accept_language?: ?string, referrer?: ?string, ip?: ?string, country?: ?string, unlock_token?: ?string}  $ctx
     * @return array<string, mixed>
     */
    public static function resolve(array $ctx): array
    {
        $alias = UrlUtil::normalizeAlias((string) ($ctx['alias'] ?? ''));
        if ($alias === '' || strlen($alias) > 64 || UrlUtil::isReservedAlias($alias) || ! UrlUtil::isValidCustomAlias($alias)) {
            return ['kind' => 'not_found'];
        }

        $domainId = self::resolveDomainId((string) ($ctx['host'] ?? ''));
        if ($domainId === -1) {
            return ['kind' => 'unavailable', 'reason' => 'domain'];
        }

        $query = Link::whereNull('deleted_at')->where('alias', $alias);
        if ($domainId === null) {
            $query->whereNull('domain_id');
        } else {
            $query->where('domain_id', $domainId);
        }
        $link = $query->first();

        if (! $link) {
            return ['kind' => 'not_found'];
        }

        $id = $link->id;
        $state = $link->state;
        $now = now();

        if ($state === 'deleted') {
            return ['kind' => 'not_found'];
        }
        if ($state === 'blocked') {
            return ['kind' => 'unavailable', 'reason' => 'blocked'];
        }
        if ($state === 'paused') {
            return ['kind' => 'unavailable', 'reason' => 'paused'];
        }
        if ($state === 'archived') {
            return ['kind' => 'unavailable', 'reason' => 'archived'];
        }
        if ($state === 'scheduled' || ($link->scheduled_at && $link->scheduled_at->isFuture())) {
            return ['kind' => 'unavailable', 'reason' => 'scheduled'];
        }
        if ($state === 'expired' || ($link->expires_at && $link->expires_at->isPast())) {
            return ['kind' => 'unavailable', 'reason' => 'expired'];
        }

        // Parse once, but repeat the authorization decision after locking the
        // link. Password, alias and domain can all change between this lookup
        // and the click transaction.
        $unlock = ! empty($ctx['unlock_token'])
            ? SignedToken::verify((string) $ctx['unlock_token'], fn ($payload) => json_decode($payload, true))
            : null;
        $host = self::normalizeHost((string) ($ctx['host'] ?? ''));
        if ($link->password_hash && ! self::unlockMatches($unlock, $alias, $host, $id, (int) $link->password_version)) {
            return ['kind' => 'password_required', 'link_id' => $id];
        }

        $ua = Ua::parse($ctx['user_agent'] ?? null);
        $referrer = self::referrerDomain($ctx['referrer'] ?? null);

        $campaignFromReferrer = null;
        if (! empty($ctx['referrer'])) {
            $q = parse_url((string) $ctx['referrer'], PHP_URL_QUERY);
            if (is_string($q)) {
                parse_str($q, $params);
                if (isset($params['utm_campaign']) && is_string($params['utm_campaign'])) {
                    $candidate = mb_substr($params['utm_campaign'], 0, 100);
                    if (mb_check_encoding($candidate, 'UTF-8') && ! preg_match('/[\x00-\x1f\x7f]/', $candidate)) {
                        $campaignFromReferrer = $candidate;
                    }
                }
            }
        }

        $languages = self::acceptedLanguages((string) ($ctx['accept_language'] ?? ''));
        $country = ! empty($ctx['country']) ? strtolower((string) $ctx['country']) : null;

        $outcome = ['kind' => 'not_found'];

        DB::transaction(function () use ($id, $domainId, $alias, $host, $unlock, $now, $ua, $referrer, $country, $languages, $campaignFromReferrer, &$outcome) {
            $fresh = Link::lockForUpdate()->find($id);
            if (! $fresh || $fresh->workspace_id === null) {
                $outcome = ['kind' => 'not_found'];

                return;
            }

            $freshDomainId = $fresh->domain_id !== null ? (int) $fresh->domain_id : null;
            if ($fresh->alias !== $alias || $freshDomainId !== $domainId) {
                $outcome = ['kind' => 'not_found'];

                return;
            }
            // Domain rows are read-only on redirects. A shared lock lets every
            // redirect for the same hostname proceed concurrently while still
            // ordering disable/delete after already-admitted redirects. This
            // preserves the previous atomic eligibility boundary without the
            // unnecessary exclusive-lock bottleneck.
            if ($freshDomainId !== null && ! CustomDomain::where('id', $freshDomainId)
                ->where('state', 'active')->where('edge_eligible', true)
                ->whereNotNull('tls_ready_at')->sharedLock()->first(['id'])) {
                $outcome = ['kind' => 'unavailable', 'reason' => 'domain'];

                return;
            }
            if ($fresh->password_hash && ! self::unlockMatches($unlock, $alias, $host, $id, (int) $fresh->password_version)) {
                $outcome = ['kind' => 'password_required', 'link_id' => $id];

                return;
            }

            $freshState = $fresh->state;
            if ($freshState === 'deleted') {
                $outcome = ['kind' => 'not_found'];

                return;
            }
            if (in_array($freshState, ['blocked', 'paused', 'archived'], true)) {
                $outcome = ['kind' => 'unavailable', 'reason' => $freshState];

                return;
            }
            if ($freshState === 'scheduled' || ($fresh->scheduled_at && $fresh->scheduled_at->isFuture())) {
                $outcome = ['kind' => 'unavailable', 'reason' => 'scheduled'];

                return;
            }
            if ($freshState === 'expired' || ($fresh->expires_at && $fresh->expires_at->isPast())) {
                $outcome = ['kind' => 'unavailable', 'reason' => 'expired'];

                return;
            }

            // Rules: deterministic order by priority then id; first match wins.
            $rules = $fresh->rules()->orderBy('priority')->orderBy('id')->get();
            $location = null;
            foreach ($rules as $rule) {
                if ($rule->country && strtolower((string) $rule->country) !== $country) {
                    continue;
                }
                if ($rule->language && ! self::languageMatches((string) $rule->language, $languages)) {
                    continue;
                }
                if ($rule->device && strtolower((string) $rule->device) !== strtolower((string) ($ua['device'] ?? ''))) {
                    continue;
                }
                if ($rule->os && ! str_contains(strtolower((string) ($ua['os'] ?? '')), strtolower((string) $rule->os))) {
                    continue;
                }
                if ($rule->referrer && ! str_contains(strtolower((string) ($referrer ?? '')), strtolower((string) $rule->referrer))) {
                    continue;
                }
                if ($rule->campaign && strtolower((string) $rule->campaign) !== strtolower((string) ($campaignFromReferrer ?? ''))) {
                    continue;
                }
                if (! self::inTimeRange($rule->time_from, $rule->time_to, $now)) {
                    continue;
                }
                $location = $rule->destination;
                break;
            }
            if ($location === null && $fresh->fallback_destination) {
                $location = $fresh->fallback_destination;
            }

            $destination = $location ?? $fresh->destination;
            $validDestination = is_string($destination) ? UrlUtil::validateDestination($destination) : ['ok' => false];
            if (! $validDestination['ok']) {
                $outcome = ['kind' => 'unavailable', 'reason' => 'destination'];

                return;
            }

            $destination = self::withUtmParameters($destination, [
                'utm_source' => $fresh->utm_source,
                'utm_medium' => $fresh->utm_medium,
                'utm_campaign' => $fresh->utm_campaign,
                'utm_term' => $fresh->utm_term,
                'utm_content' => $fresh->utm_content,
            ]);

            // Appending campaign data can push an otherwise valid target over
            // the URL boundary. Revalidate the actual Location before spending
            // single-use state or click quota; fail closed on an invalid result.
            if (! UrlUtil::validateDestination($destination)['ok']) {
                $outcome = ['kind' => 'unavailable', 'reason' => 'destination'];

                return;
            }

            // Do not consume a single-use link or its click quota until the
            // final rule/fallback destination is known to be safe. The row
            // lock keeps the selection and consumption one atomic decision.
            if ($fresh->single_use) {
                if ($fresh->used_at) {
                    $outcome = ['kind' => 'gone'];

                    return;
                }
                $updated = Link::where('id', $id)->whereNull('used_at')->update([
                    'used_at' => now(),
                    'click_count' => DB::raw('click_count + 1'),
                    'updated_at' => now(),
                ]);
                if ($updated === 0) {
                    $outcome = ['kind' => 'gone'];

                    return;
                }
            } elseif ($fresh->max_clicks !== null) {
                $updated = Link::where('id', $id)->whereRaw('click_count < max_clicks')->update([
                    'click_count' => DB::raw('click_count + 1'),
                    'updated_at' => now(),
                ]);
                if ($updated === 0) {
                    $outcome = ['kind' => 'gone'];

                    return;
                }
            } else {
                Link::where('id', $id)->update([
                    'click_count' => DB::raw('click_count + 1'),
                    'updated_at' => now(),
                ]);
            }

            $thresholdReached = $fresh->max_clicks !== null
                && (int) $fresh->click_count + 1 === (int) $fresh->max_clicks;
            if ($thresholdReached) {
                WebhookService::dispatch((int) $fresh->workspace_id, 'link.threshold_reached', [
                    'linkId' => $id,
                    'threshold' => (int) $fresh->max_clicks,
                ]);
            }

            $outcome = [
                'kind' => 'redirect',
                'location' => $destination,
                'link_id' => $id,
                'campaign' => $fresh->utm_campaign ?? $campaignFromReferrer,
            ];
        });

        return $outcome;
    }

    /**
     * Add configured campaign parameters without reserializing unrelated query
     * bytes. Configured values are authoritative: every exact, percent-decoded
     * homonym is removed before one RFC 3986-encoded value is appended. Query
     * names remain case-sensitive and the original fragment stays last.
     *
     * @param  array<string, ?string>  $configured
     */
    private static function withUtmParameters(string $destination, array $configured): string
    {
        $utm = [];
        foreach ($configured as $name => $value) {
            if ($value !== null) {
                $utm[$name] = $value;
            }
        }
        if ($utm === []) {
            return $destination;
        }

        $fragment = '';
        $withoutFragment = $destination;
        $fragmentPosition = strpos($destination, '#');
        if ($fragmentPosition !== false) {
            $fragment = substr($destination, $fragmentPosition);
            $withoutFragment = substr($destination, 0, $fragmentPosition);
        }

        $base = $withoutFragment;
        $existingQuery = '';
        $queryPosition = strpos($withoutFragment, '?');
        if ($queryPosition !== false) {
            $base = substr($withoutFragment, 0, $queryPosition);
            $existingQuery = substr($withoutFragment, $queryPosition + 1);
        }

        $keptSegments = [];
        if ($existingQuery !== '') {
            foreach (explode('&', $existingQuery) as $segment) {
                $separatorPosition = strpos($segment, '=');
                $rawName = $separatorPosition === false ? $segment : substr($segment, 0, $separatorPosition);
                if (! array_key_exists(rawurldecode($rawName), $utm)) {
                    $keptSegments[] = $segment;
                }
            }
        }

        $newSegments = [];
        foreach ($utm as $name => $value) {
            $newSegments[] = rawurlencode($name).'='.rawurlencode($value);
        }

        $query = implode('&', $keptSegments);
        if ($query !== '' && ! str_ends_with($query, '&')) {
            $query .= '&';
        }
        $query .= implode('&', $newSegments);

        return $base.'?'.$query.$fragment;
    }

    /**
     * Parse a bounded Accept-Language list in preference order. A primary rule
     * such as `es` matches every accepted Spanish variant; a regional rule such
     * as `es-ES` requires that exact tag. Rule priority still decides which of
     * multiple matching redirect rules wins.
     *
     * @return array<int, string>
     */
    private static function acceptedLanguages(string $header): array
    {
        $accepted = [];
        foreach (array_slice(explode(',', substr($header, 0, 512)), 0, 16) as $position => $entry) {
            $parts = array_map('trim', explode(';', $entry));
            $tag = strtolower((string) array_shift($parts));
            if (preg_match('/^[a-z]{2,3}(?:-[a-z0-9]{2,4})?$/D', $tag) !== 1) {
                continue;
            }

            $quality = 1.0;
            $validQuality = true;
            foreach ($parts as $parameter) {
                if (preg_match('/^q=(0(?:\.\d{1,3})?|1(?:\.0{1,3})?)$/D', strtolower($parameter), $matches) === 1) {
                    $quality = (float) $matches[1];
                    break;
                }
                if (str_starts_with(strtolower($parameter), 'q=')) {
                    // An invalid q-value must not accidentally become the
                    // highest preference merely because the default is 1.
                    $validQuality = false;
                    break;
                }
            }
            if ($validQuality && $quality > 0) {
                $accepted[] = ['tag' => $tag, 'quality' => $quality, 'position' => $position];
            }
        }

        usort($accepted, fn (array $left, array $right): int => $right['quality'] <=> $left['quality']
            ?: $left['position'] <=> $right['position']);

        return array_values(array_unique(array_column($accepted, 'tag')));
    }

    /** @param array<int, string> $accepted */
    private static function languageMatches(string $ruleLanguage, array $accepted): bool
    {
        $rule = strtolower($ruleLanguage);
        foreach ($accepted as $language) {
            if ($language === $rule || (! str_contains($rule, '-') && str_starts_with($language, $rule.'-'))) {
                return true;
            }
        }

        return false;
    }

    private static function unlockMatches(mixed $unlock, string $alias, string $host, int $linkId, int $passwordVersion): bool
    {
        return is_array($unlock)
            && ($unlock['alias'] ?? null) === $alias
            && ! empty($unlock['host'])
            && self::normalizeHost((string) $unlock['host']) === $host
            && (int) ($unlock['link'] ?? 0) === $linkId
            && (int) ($unlock['password_version'] ?? -1) === $passwordVersion;
    }

    public static function referrerDomain(?string $referrer): ?string
    {
        if (! $referrer) {
            return null;
        }
        $host = parse_url($referrer, PHP_URL_HOST);
        if (! is_string($host)) {
            return null;
        }

        $normalized = strtolower(preg_replace('/^www\./i', '', $host) ?: $host);
        if (strlen($normalized) > 253 || ! preg_match('/^(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/', $normalized)) {
            return null;
        }

        return $normalized;
    }

    private static function inTimeRange(?string $from, ?string $to, Carbon $now): bool
    {
        if (! $from && ! $to) {
            return true;
        }
        $minutes = ($now->hour * 60) + $now->minute;
        $toMin = fn (?string $t) => $t ? ((int) explode(':', $t)[0] * 60 + (int) (explode(':', $t)[1] ?? 0)) : null;

        $a = $toMin($from);
        $b = $toMin($to);

        if ($a !== null && $b !== null) {
            return $a <= $b
                ? ($minutes >= $a && $minutes <= $b)
                : ($minutes >= $a || $minutes <= $b);
        }
        if ($a !== null) {
            return $minutes >= $a;
        }

        return $minutes <= $b;
    }
}
