<?php

namespace App\Support;

use App\Models\Link;
use App\Models\CustomDomain;
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
            ->whereIn('state', ['verified', 'active'])
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

        // Password gate: unlock token bound to the exact host AND link id.
        if ($link->password_hash) {
            $unlock = null;
            if (! empty($ctx['unlock_token'])) {
                $unlock = SignedToken::verify((string) $ctx['unlock_token'], function ($payload) {
                    return json_decode($payload, true);
                });
            }
            $host = self::normalizeHost((string) ($ctx['host'] ?? ''));
            if (! is_array($unlock)
                || ($unlock['alias'] ?? null) !== $alias
                || empty($unlock['host'])
                || self::normalizeHost((string) $unlock['host']) !== $host
                || (int) ($unlock['link'] ?? 0) !== $id) {
                return ['kind' => 'password_required', 'link_id' => $id];
            }
        }

        $ua = Ua::parse($ctx['user_agent'] ?? null);
        $referrer = self::referrerDomain($ctx['referrer'] ?? null);

        $campaignFromReferrer = null;
        if (! empty($ctx['referrer'])) {
            $q = parse_url((string) $ctx['referrer'], PHP_URL_QUERY);
            if (is_string($q)) {
                parse_str($q, $params);
                if (isset($params['utm_campaign']) && is_string($params['utm_campaign'])) {
                    $campaignFromReferrer = substr($params['utm_campaign'], 0, 100);
                }
            }
        }

        $acceptLanguage = (string) ($ctx['accept_language'] ?? '');
        $lang = $acceptLanguage !== '' ? strtolower((string) explode('-', explode(',', $acceptLanguage)[0])[0]) : null;
        $country = ! empty($ctx['country']) ? strtolower((string) $ctx['country']) : null;

        $outcome = ['kind' => 'not_found'];

        DB::transaction(function () use ($id, $now, $link, $ua, $referrer, $country, $lang, $campaignFromReferrer, &$outcome) {
            $fresh = Link::lockForUpdate()->find($id);
            if (! $fresh || $fresh->workspace_id === null) {
                $outcome = ['kind' => 'not_found'];

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

            // Rules: deterministic order by priority then id; first match wins.
            $rules = $fresh->rules()->orderBy('priority')->orderBy('id')->get();
            $location = null;
            foreach ($rules as $rule) {
                if ($rule->country && strtolower((string) $rule->country) !== $country) {
                    continue;
                }
                if ($rule->language && strtolower((string) $rule->language) !== $lang) {
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

            $outcome = [
                'kind' => 'redirect',
                'location' => $location ?? $fresh->destination,
                'link_id' => $id,
                'campaign' => $fresh->utm_campaign ?? $campaignFromReferrer,
            ];
        });

        return $outcome;
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

        return preg_replace('/^www\./', '', $host) ?: $host;
    }

    private static function inTimeRange(?string $from, ?string $to, \Illuminate\Support\Carbon $now): bool
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
