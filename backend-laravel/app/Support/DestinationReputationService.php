<?php

namespace App\Support;

use App\Jobs\CheckDestinationReputationJob;
use Illuminate\Support\Carbon;
use Illuminate\Support\Facades\DB;

/**
 * Decides what a destination's reputation means for a link.
 *
 * The ordering is deliberate and is the whole point of this class:
 *
 *  1. the local denylist decides first, because it is a human or provider
 *     decision already taken and needs no network call;
 *  2. only then is the optional provider consulted, through a cache;
 *  3. and the outcome is applied to the link's state, never to the redirect
 *     path. A blocked link is refused by `RedirectService` exactly like one a
 *     moderator blocked; nothing here runs while a click is being served.
 *
 * A provider verdict of `suspicious` opens a moderation case. Only a
 * high-confidence `malicious` verdict may block, and only when the deployment
 * has explicitly enabled automatic blocking: an unconfigured deployment can
 * never block anyone on a verdict it never received.
 */
final class DestinationReputationService
{
    public const OUTCOME_ALLOWED = 'allowed';

    public const OUTCOME_MODERATED = 'moderated';

    public const OUTCOME_BLOCKED = 'blocked';

    public const OUTCOME_MISSING = 'missing';

    public static function provider(): ReputationProvider
    {
        $settings = config('uvh.reputation');
        if (! is_array($settings) || ! ExternalEndpoint::isSafeHttps(trim((string) ($settings['provider_url'] ?? '')))) {
            return new NullReputationProvider;
        }

        return new HttpReputationProvider([
            'url' => (string) $settings['provider_url'],
            'token' => (string) ($settings['provider_token'] ?? ''),
            'timeout_ms' => max(1, min(30, (int) $settings['timeout_seconds'])) * 1000,
            'max_body_bytes' => max(1024, min(1_048_576, (int) $settings['max_body_bytes'])),
            'ttl_hours' => max(1, min(24 * 30, (int) $settings['cache_ttl_hours'])),
        ]);
    }

    /**
     * Enqueue one link's check without letting an unreachable broker undo the
     * caller's work.
     *
     * Analysing a destination is auxiliary by design: a link that has already
     * been committed must not fail because the queue refused an extra job. The
     * next scheduled sweep — or the next edit of the link — picks it up again,
     * exactly like a webhook delivery stays pending until its lease retry.
     */
    public static function dispatchCheck(int $linkId): bool
    {
        try {
            CheckDestinationReputationJob::dispatch($linkId);

            return true;
        } catch (\Throwable) {
            OperationalMetrics::increment('reputation.dispatch_failed');

            return false;
        }
    }

    /** @return list<string> every destination a link can send a visitor to */
    public static function destinationsOf(object $link): array
    {
        $destinations = [];
        foreach (['destination', 'fallback_destination'] as $column) {
            $value = $link->{$column} ?? null;
            if (is_string($value) && trim($value) !== '') {
                $destinations[] = $value;
            }
        }

        $rules = DB::table('redirect_rules')
            ->where('link_id', $link->id ?? 0)
            ->orderBy('id')
            ->limit(50)
            ->pluck('destination');
        foreach ($rules as $destination) {
            if (is_string($destination) && trim($destination) !== '') {
                $destinations[] = $destination;
            }
        }

        return array_values(array_unique($destinations));
    }

    /**
     * Cached verdict for a destination, refreshing it through the provider when
     * the row is absent, stale, or an explicit refresh was asked for and a
     * provider is configured.
     */
    public static function verdictFor(string $destination, bool $refresh = false): ReputationVerdict
    {
        $key = DestinationDenylist::key($destination);
        if ($key === null) {
            return ReputationVerdict::unknown('none', 'invalid_destination');
        }

        $cached = self::cached($key['url_hash']);
        $provider = self::provider();
        if ($cached !== null && ! $refresh && $cached->isFresh()) {
            return $cached;
        }
        if (! $provider->configured()) {
            // Without a provider the honest answer stays `unknown`, even when a
            // stale row exists: an old verdict is not a current one.
            return $cached ?? ReputationVerdict::unknown(NullReputationProvider::LABEL, 'provider_not_configured');
        }

        $verdict = $provider->check($destination);
        self::remember($destination, $verdict);

        return $verdict;
    }

    public static function cached(string $urlHash): ?ReputationVerdict
    {
        $row = DB::table('destination_reputation_checks')->where('url_hash', $urlHash)->first();
        if ($row === null) {
            return null;
        }

        return ReputationVerdict::make(
            (string) $row->verdict,
            (string) $row->provider,
            Carbon::parse($row->checked_at),
            $row->expires_at !== null ? Carbon::parse($row->expires_at) : null,
            $row->score !== null ? (int) $row->score : null,
            $row->last_error !== null ? (string) $row->last_error : null,
        );
    }

    public static function remember(string $destination, ReputationVerdict $verdict): void
    {
        $key = DestinationDenylist::key($destination);
        if ($key === null) {
            return;
        }

        $existing = self::cached($key['url_hash']);
        $failures = 0;
        if ($verdict->verdict() === ReputationVerdict::UNKNOWN && $existing !== null) {
            // Consecutive unknowns are what tells an operator that a provider
            // has been degrading rather than answering "nothing known".
            $failures = self::failureCount($key['url_hash']) + 1;
        }

        // An unknown verdict is a failed lookup, not a lasting answer: it is
        // re-tried on a short window instead of being cached for the full TTL,
        // and it is never mistaken for a decision. Without this, one provider
        // outage would freeze "nothing known" for a whole day.
        $expiresAt = $verdict->verdict() === ReputationVerdict::UNKNOWN
            ? now()->addMinutes(15)
            : $verdict->expiresAt();

        $row = [
            'host' => $key['host'],
            'verdict' => $verdict->verdict(),
            'score' => $verdict->score(),
            'provider' => $verdict->provider(),
            'checked_at' => $verdict->checkedAt(),
            'expires_at' => $expiresAt,
            'failure_count' => $failures,
            'last_error' => $verdict->error(),
            'updated_at' => now(),
        ];

        $updated = DB::table('destination_reputation_checks')->where('url_hash', $key['url_hash'])->update($row);
        if ($updated === 0) {
            DB::table('destination_reputation_checks')->insertOrIgnore($row + [
                'url_hash' => $key['url_hash'],
                'created_at' => now(),
            ]);
        }
    }

    /**
     * Evaluate one link and apply the resulting decision to its state.
     *
     * Returns the outcome so a caller (or a test) can tell an allowed link from
     * a blocked one without re-reading the row.
     */
    public static function evaluate(int $linkId): string
    {
        $link = DB::table('links')
            ->where('id', $linkId)
            ->first(['id', 'workspace_id', 'state', 'state_before_delete', 'deleted_at', 'destination', 'fallback_destination']);
        if ($link === null) {
            return self::OUTCOME_MISSING;
        }

        $destinations = self::destinationsOf($link);
        foreach ($destinations as $destination) {
            $reason = DestinationDenylist::reason($destination);
            if ($reason !== null) {
                self::block($link, 'denylist', $reason);

                return self::OUTCOME_BLOCKED;
            }
        }

        $autoBlock = (bool) config('uvh.reputation.auto_block', false);
        $outcome = self::OUTCOME_ALLOWED;
        foreach ($destinations as $destination) {
            $verdict = self::verdictFor($destination);
            if ($verdict->verdict() === ReputationVerdict::MALICIOUS && $autoBlock) {
                self::block($link, 'provider', 'Señal de reputación '.$verdict->provider());

                return self::OUTCOME_BLOCKED;
            }
            if ($verdict->verdict() === ReputationVerdict::SUSPICIOUS) {
                self::moderate($link, $verdict);
                $outcome = self::OUTCOME_MODERATED;
            }
        }

        return $outcome;
    }

    /**
     * Links whose destinations have no fresh verdict, oldest activity first.
     *
     * Bounded on purpose: re-analysis is a background sweep, not a full-table
     * scan of every link on every scheduler tick.
     *
     * @return list<int>
     */
    public static function staleLinkIds(int $limit = 50): array
    {
        $limit = max(1, min(500, $limit));
        $candidates = DB::table('links')
            ->whereNull('deleted_at')
            ->whereIn('state', ['active', 'paused', 'scheduled'])
            ->orderBy('updated_at')
            ->limit($limit * 4)
            ->get(['id', 'destination', 'fallback_destination']);
        if ($candidates->isEmpty()) {
            return [];
        }

        // One query for every rule in the batch: a sweep that opened a query per
        // link would cost more than the checks it schedules.
        $rulesByLink = [];
        $rules = DB::table('redirect_rules')
            ->whereIn('link_id', $candidates->pluck('id')->all())
            ->orderBy('id')
            ->get(['link_id', 'destination']);
        foreach ($rules as $rule) {
            if (is_string($rule->destination) && trim($rule->destination) !== '') {
                $rulesByLink[(int) $rule->link_id][] = $rule->destination;
            }
        }

        $hashes = [];
        $byHash = [];
        foreach ($candidates as $candidate) {
            $destinations = [$candidate->destination, $candidate->fallback_destination, ...($rulesByLink[(int) $candidate->id] ?? [])];
            foreach ($destinations as $destination) {
                if (! is_string($destination) || trim($destination) === '') {
                    continue;
                }
                $key = DestinationDenylist::key($destination);
                if ($key === null) {
                    continue;
                }
                $hashes[$key['url_hash']] = true;
                $byHash[$key['url_hash']][] = (int) $candidate->id;
            }
        }
        if ($hashes === []) {
            return [];
        }

        $fresh = DB::table('destination_reputation_checks')
            ->whereIn('url_hash', array_keys($hashes))
            /* A row with no expiry never goes stale; a row whose expiry passed
               is exactly what this sweep exists to refresh. */
            ->where(function ($query) {
                $query->whereNull('expires_at')->orWhere('expires_at', '>', now());
            })
            ->pluck('url_hash')
            ->all();

        $stale = [];
        foreach ($byHash as $hash => $ids) {
            if (! in_array($hash, $fresh, true)) {
                foreach ($ids as $id) {
                    $stale[$id] = true;
                }
            }
        }

        return array_slice(array_keys($stale), 0, $limit);
    }

    /**
     * Age of the most recent actionable verdict obtained from a provider.
     *
     * `/api/v1/status` reports `operational` only from this signal: a probe is a
     * check that actually answered something, not a configured URL.
     */
    public static function lastProviderVerdictAt(): ?Carbon
    {
        $value = DB::table('destination_reputation_checks')
            ->where('provider', '<>', NullReputationProvider::LABEL)
            ->where('verdict', '<>', ReputationVerdict::UNKNOWN)
            ->max('checked_at');

        return is_string($value) ? Carbon::parse($value) : null;
    }

    /**
     * Re-analyse every link that could point at a host, after the denylist
     * changed.
     *
     * A new entry has to reach the links that already exist, and the stale
     * sweep will not find them: their verdicts are fresh, because nothing about
     * the provider changed — the platform's own decision did. The SQL match is
     * deliberately loose (`ilike %host%`) and can over-select; the job applies
     * the exact label-aware rule, so an over-selection costs one cheap job and
     * can never block a link the denylist does not cover.
     *
     * @return int links scheduled
     */
    public static function reanalyzeHost(string $host, int $limit = 500): int
    {
        $normalized = DestinationDenylist::normalizeHost($host);
        if ($normalized === null) {
            return 0;
        }
        $limit = max(1, min(2000, $limit));

        $linkIds = DB::table('links')
            ->whereNull('deleted_at')
            ->whereIn('state', ['active', 'paused', 'scheduled'])
            ->where(function ($query) use ($normalized) {
                $query->where('destination', 'ilike', '%'.$normalized.'%')
                    ->orWhere('fallback_destination', 'ilike', '%'.$normalized.'%');
            })
            ->orderBy('id')
            ->limit($limit)
            ->pluck('id')
            ->all();

        $ruleLinkIds = DB::table('redirect_rules')
            ->where('destination', 'ilike', '%'.$normalized.'%')
            ->orderBy('link_id')
            ->limit($limit)
            ->pluck('link_id')
            ->all();

        $scheduled = 0;
        foreach (array_values(array_unique([...$linkIds, ...$ruleLinkIds])) as $id) {
            if (self::dispatchCheck((int) $id)) {
                $scheduled++;
            }
        }
        if ($scheduled > 0) {
            OperationalMetrics::increment('reputation.reanalysis_scheduled', $scheduled);
        }

        return $scheduled;
    }

    /** Reputation of the platform's own host, for the abuse-monitoring signal. */
    public static function monitorHost(string $host): ReputationVerdict
    {
        $normalized = DestinationDenylist::normalizeHost($host);
        if ($normalized === null) {
            return ReputationVerdict::unknown('none', 'invalid_host');
        }

        return self::verdictFor('https://'.$normalized.'/', true);
    }

    private static function failureCount(string $urlHash): int
    {
        $value = DB::table('destination_reputation_checks')->where('url_hash', $urlHash)->value('failure_count');

        return is_numeric($value) ? (int) $value : 0;
    }

    /**
     * Block a link for a destination-level reason.
     *
     * The transition mirrors an administrative block: a soft-deleted link keeps
     * its tombstone blocked so a restore cannot resurrect it, and every decision
     * is audited with the workspace it belongs to.
     */
    private static function block(object $link, string $source, string $reason): void
    {
        $alreadyBlocked = (string) $link->state === 'blocked'
            && ($link->deleted_at === null || (string) $link->state_before_delete === 'blocked');
        if ($alreadyBlocked) {
            return;
        }

        DB::transaction(function () use ($link, $source, $reason): void {
            $deleted = $link->deleted_at !== null;
            DB::table('links')->where('id', $link->id)->update($deleted
                ? ['state' => 'deleted', 'state_before_delete' => 'blocked', 'version' => DB::raw('version + 1'), 'updated_at' => now()]
                : ['state' => 'blocked', 'version' => DB::raw('version + 1'), 'updated_at' => now()]);

            Audit::write(
                null,
                'system.link_block',
                'link',
                (int) $link->id,
                ['controller' => 'destination_reputation', 'signal' => $source, 'reason' => mb_substr($reason, 0, 200)],
                null,
                workspaceId: (int) $link->workspace_id,
            );
        });

        OperationalMetrics::increment('reputation.blocked');
    }

    /** Open a moderation case for a verdict that is suspicious but not conclusive. */
    private static function moderate(object $link, ReputationVerdict $verdict): void
    {
        $day = now()->format('Y-m-d');
        $existing = DB::table('abuse_reports')
            ->where('link_id', (int) $link->id)
            ->where('source', 'reputation')
            ->where('status', 'open')
            ->exists();
        if ($existing) {
            return;
        }

        DB::table('abuse_reports')->insertOrIgnore([
            'link_id' => (int) $link->id,
            'reporter_email' => null,
            'reporter_hash' => null,
            'report_day' => $day,
            'source' => 'reputation',
            'reason' => mb_substr('Señal de reputación: '.$verdict->verdict().' ('.$verdict->provider().')', 0, 200),
            'details' => null,
            'status' => 'open',
            'created_at' => now(),
        ]);

        OperationalMetrics::increment('reputation.moderated');
        Audit::write(
            null,
            'system.link_reputation_signal',
            'link',
            (int) $link->id,
            ['controller' => 'destination_reputation', 'verdict' => $verdict->verdict(), 'provider' => $verdict->provider()],
            null,
            workspaceId: (int) $link->workspace_id,
        );
    }
}
