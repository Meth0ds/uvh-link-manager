<?php

namespace App\Support;

use App\Jobs\CheckDestinationReputationJob;
use App\Jobs\ContinueDestinationSweepJob;
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

    public const OUTCOME_RELEASED = 'released';

    public const OUTCOME_MISSING = 'missing';

    /**
     * The verdict was discarded because the link moved while it was being
     * applied.
     *
     * A verdict describes the destinations read at the start of the evaluation.
     * If the link's owner edits it in between — the ordinary case being a
     * destination change — the row is a different decision's subject by the time
     * the write arrives, and that edit has already queued its own check.
     */
    public const OUTCOME_STALE = 'stale';

    /** Results of applying one decision; internal, never returned as an outcome. */
    private const APPLIED = 'applied';

    private const UNCHANGED = 'unchanged';

    private const STALE = 'stale';

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
            // row exists: an old verdict is not a current one. Returning the row
            // here contradicted that same sentence, and it turned switching the
            // provider off into a state where its expired verdicts kept deciding
            // indefinitely — a slow-motion version of blocking on a lookup that
            // never happened.
            return ReputationVerdict::unknown(NullReputationProvider::LABEL, 'provider_not_configured');
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
     * a blocked one without re-reading the row. The link is moved to the back of
     * the sweep's queue as part of being examined — including when the check
     * failed, because a verdict nobody revisits after a failed lookup is a
     * verdict that quietly outlives its window.
     */
    public static function evaluate(int $linkId): string
    {
        $outcome = self::decide($linkId);
        if ($outcome !== self::OUTCOME_MISSING) {
            self::markExamined([$linkId]);
        }

        return $outcome;
    }

    /** The decision itself: read the link, ask the denylist, ask the provider, apply. */
    private static function decide(int $linkId): string
    {
        $link = DB::table('links')
            ->where('id', $linkId)
            ->first([
                'id', 'workspace_id', 'state', 'state_before_delete', 'deleted_at', 'destination', 'fallback_destination',
                'expires_at', 'scheduled_at', 'version',
                'reputation_blocked_at', 'reputation_block_source', 'reputation_block_prior_state',
            ]);
        if ($link === null) {
            return self::OUTCOME_MISSING;
        }

        $destinations = self::destinationsOf($link);
        foreach ($destinations as $destination) {
            $reason = DestinationDenylist::reason($destination);
            if ($reason !== null) {
                return self::block($link, 'denylist', $reason) === self::STALE
                    ? self::OUTCOME_STALE
                    : self::OUTCOME_BLOCKED;
            }
        }

        // Nothing is listed any more. A block this platform applied by itself
        // has lost its ground — the entry was withdrawn or it expired — so it is
        // withdrawn too. A moderator's block carries no marker and never reaches
        // this branch, which is what makes "the platform may undo its own
        // decisions" and "a human decision stands" two different code paths.
        if (self::release($link, 'denylist')) {
            return self::OUTCOME_RELEASED;
        }

        $autoBlock = (bool) config('uvh.reputation.auto_block', false);
        $outcome = self::OUTCOME_ALLOWED;
        // Withdrawing a provider block requires every destination to have
        // answered, and `unknown` is not an answer: an outage, a rate limit, an
        // answer this contract does not describe, or a provider a deployment has
        // switched off are all the absence of evidence. Reading them as "no
        // longer malicious" republished links the platform had taken down on a
        // verdict it did receive, which made a third party's bad minute a way to
        // lift a block.
        $answered = true;
        foreach ($destinations as $destination) {
            $verdict = self::verdictFor($destination);
            if ($verdict->verdict() === ReputationVerdict::UNKNOWN) {
                $answered = false;

                continue;
            }
            if ($verdict->verdict() === ReputationVerdict::MALICIOUS && $autoBlock) {
                return self::block($link, 'provider', 'Señal de reputación '.$verdict->provider()) === self::STALE
                    ? self::OUTCOME_STALE
                    : self::OUTCOME_BLOCKED;
            }
            if ($verdict->verdict() === ReputationVerdict::SUSPICIOUS) {
                self::moderate($link, $verdict);
                $outcome = self::OUTCOME_MODERATED;
            }
        }

        // The same two-way rule for a provider block: when no destination still
        // reads malicious — the verdict improved, or automatic blocking was
        // turned off — the block it justified is withdrawn instead of standing
        // for the lifetime of the link. The denylist branch above needs no such
        // condition: it is local, and its answer is authoritative.
        if ($answered && self::release($link, 'provider')) {
            return self::OUTCOME_RELEASED;
        }

        return $outcome;
    }

    /**
     * Links this platform blocked by itself, oldest block first.
     *
     * The marker is the filter, so a moderator's block can never appear here.
     * Bounded like every other sweep: withdrawing a block is a background
     * correction, not a traversal of the table.
     *
     * @return list<int>
     */
    public static function machineBlockedLinkIds(int $limit = 50, ?string $source = null): array
    {
        $limit = max(1, min(500, $limit));
        $query = DB::table('links')
            ->whereNull('deleted_at')
            ->where('state', 'blocked')
            ->whereNotNull('reputation_blocked_at');
        if ($source !== null) {
            $query->where('reputation_block_source', $source);
        }

        return $query
            ->orderBy('reputation_blocked_at')
            ->orderBy('id')
            ->limit($limit)
            ->pluck('id')
            ->map(fn ($id): int => (int) $id)
            ->all();
    }

    /**
     * Re-evaluate a bounded batch of self-applied blocks whose reason came from
     * the denylist, releasing the ones whose entries no longer apply.
     *
     * Called when an entry is withdrawn — so the effect is immediate instead of
     * waiting for the next sweep — and once per housekeeping cycle, so an entry
     * that simply expired is noticed too: expiry has no event to hang from.
     * Only denylist-sourced blocks are walked, and for those the denylist is
     * consulted before any provider, so this path answers a local question with
     * local data and never spends a network call.
     *
     * @return int blocks released
     */
    public static function releaseUnlistedBlocks(int $limit = 50): int
    {
        $released = 0;
        foreach (self::machineBlockedLinkIds($limit, 'denylist') as $linkId) {
            if (self::evaluate($linkId) === self::OUTCOME_RELEASED) {
                $released++;
            }
        }

        return $released;
    }

    /**
     * Links whose destinations have no fresh verdict, least recently examined
     * first.
     *
     * Bounded on purpose: re-analysis is a background sweep, not a full-table
     * scan of every link on every scheduler tick. Bounded *and advancing* is the
     * harder half — the ordering is `reputation_checked_at`, the cursor the
     * sweep writes as it examines candidates, not `updated_at`. Ordering by
     * `updated_at` looked stable and was: examining a link does not touch it, so
     * the same rows were read on every tick and any link beyond the window kept
     * an expired verdict forever while the sweep reported nothing wrong.
     *
     * The window is still wider than the batch, because most candidates turn out
     * to have a fresh verdict and the batch should not come back short for it.
     *
     * @return list<int>
     */
    public static function staleLinkIds(int $limit = 50): array
    {
        $limit = max(1, min(500, $limit));
        $candidates = DB::table('links')
            ->whereNull('deleted_at')
            ->where(function ($query) {
                $query->whereIn('state', ['active', 'paused', 'scheduled'])
                    // A self-applied block is never final: it is re-checked like
                    // any other verdict, which is how one whose ground
                    // disappeared is withdrawn instead of standing until someone
                    // notices by hand. A moderator's block is not a verdict and
                    // is excluded here.
                    ->orWhere(function ($blocked) {
                        $blocked->where('state', 'blocked')->whereNotNull('reputation_blocked_at');
                    });
            })
            ->orderByRaw('reputation_checked_at NULLS FIRST')
            ->orderBy('id')
            ->limit($limit * 4)
            ->get(['id', 'destination', 'fallback_destination', 'reputation_blocked_at']);
        if ($candidates->isEmpty()) {
            return [];
        }

        // Every candidate is stamped, whether or not it turns out to need a
        // check: the stamp is the queue position, and a candidate that keeps its
        // place would starve the ones behind it — which is the defect this
        // column exists to remove. Links whose check is dispatched get stamped
        // twice (here and when the job evaluates them); that is cheaper than a
        // second pass and keeps the two paths independent.
        self::markExamined($candidates->pluck('id')->all());

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

        $machineBlocked = [];
        foreach ($candidates as $candidate) {
            if ($candidate->reputation_blocked_at !== null) {
                $machineBlocked[(int) $candidate->id] = true;
            }
        }

        $stale = [];
        foreach ($byHash as $hash => $ids) {
            $freshVerdict = in_array($hash, $fresh, true);
            foreach ($ids as $id) {
                // A self-applied block is re-checked even when its verdict is
                // still fresh: what may have expired is the block's own ground,
                // not the verdict that produced it.
                if (! $freshVerdict || isset($machineBlocked[$id])) {
                    $stale[$id] = true;
                }
            }
        }

        return array_slice(array_keys($stale), 0, $limit);
    }

    /**
     * Move a batch of links to the back of the sweep's queue.
     *
     * Deliberately does not touch `updated_at`: the column that means "this row
     * changed" must not be rewritten by a background reader, or every sweep would
     * push its own candidates to the top of every other ordered list in the
     * product.
     *
     * @param  list<int|string>  $linkIds
     */
    private static function markExamined(array $linkIds): void
    {
        if ($linkIds === []) {
            return;
        }

        DB::table('links')->whereIn('id', $linkIds)->update(['reputation_checked_at' => now()]);
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
     * The budget is per call and the answer says whether it was enough. An
     * operator who blocks a destination on a platform-wide host has to know that
     * the sweep covered every existing link, or that it stopped at the budget —
     * silently reporting "500 scheduled" as if it were the whole set is how a
     * partial block gets mistaken for a complete one. When it stops, it does not
     * wait for a background sweep that may never reach that host (and that does
     * not run at all without a reputation provider configured): the continuation
     * resumes from the cursor this call publishes and finishes the propagation.
     *
     * @return array{scheduled: int, truncated: bool, cursor: int}
     */
    public static function reanalyzeHost(string $host, ?int $budget = null, int $afterId = 0): array
    {
        $normalized = DestinationDenylist::normalizeHost($host);
        if ($normalized === null) {
            return ['scheduled' => 0, 'truncated' => false, 'cursor' => $afterId];
        }
        $budget = max(1, min(2000, $budget ?? (int) config('uvh.reputation.reanalysis_budget', 500)));
        $afterId = max(0, $afterId);
        $like = '%'.$normalized.'%';

        // One row over the budget per source is all it takes to know the source
        // had more, which avoids a `count()` that would scan the same rows twice.
        // Both sources are the same id space (a rule's `link_id` is a link id),
        // so a cursor over link ids covers them together.
        $linkIds = DB::table('links')
            ->whereNull('deleted_at')
            ->whereIn('state', ['active', 'paused', 'scheduled'])
            ->where('id', '>', $afterId)
            ->where(function ($query) use ($like) {
                $query->where('destination', 'ilike', $like)
                    ->orWhere('fallback_destination', 'ilike', $like);
            })
            ->orderBy('id')
            ->limit($budget + 1)
            ->pluck('id')
            ->all();

        $ruleLinkIds = DB::table('redirect_rules')
            ->where('link_id', '>', $afterId)
            ->where('destination', 'ilike', $like)
            ->orderBy('link_id')
            ->limit($budget + 1)
            ->pluck('link_id')
            ->all();

        $truncated = count($linkIds) > $budget || count($ruleLinkIds) > $budget;
        $candidates = array_values(array_unique([
            ...array_slice($linkIds, 0, $budget),
            ...array_slice($ruleLinkIds, 0, $budget),
        ]));
        // Ascending before trimming: the cursor below is "everything up to here
        // has been considered", and that is only true of a prefix of the sorted
        // set. Slicing an unsorted union would leave holes the cursor then skips
        // over — the same silent partial block, one layer lower.
        sort($candidates);
        if (count($candidates) > $budget) {
            // Two sources that each fit but together do not: the union is what
            // the budget bounds, so it is trimmed here as well.
            $truncated = true;
            $candidates = array_slice($candidates, 0, $budget);
        }

        $scheduled = 0;
        foreach ($candidates as $id) {
            if (self::dispatchCheck((int) $id)) {
                $scheduled++;
            }
        }
        if ($scheduled > 0) {
            OperationalMetrics::increment('reputation.reanalysis_scheduled', $scheduled);
        }

        $cursor = $candidates === [] ? $afterId : (int) max($candidates);
        if ($truncated) {
            OperationalMetrics::increment('reputation.reanalysis_truncated');
            // The rest is not left to a sweep that may never reach it: the
            // propagation continues from the id it stopped at. Telling the
            // operator the block was partial is necessary but not sufficient —
            // the links beyond the budget would otherwise stay live, and a
            // deployment with no reputation provider configured has no sweep
            // running at all.
            self::dispatchSweepContinuation($normalized, $cursor);
        }

        return ['scheduled' => $scheduled, 'truncated' => $truncated, 'cursor' => $cursor];
    }

    /**
     * Hand the rest of a truncated propagation to the queue.
     *
     * Same contract as `dispatchCheck`: an unreachable broker never fails the
     * operator's request, and the truncation is still published in the response,
     * so the work that did not get queued is visible instead of assumed.
     */
    private static function dispatchSweepContinuation(string $host, int $afterId): bool
    {
        try {
            ContinueDestinationSweepJob::dispatch($host, $afterId);

            return true;
        } catch (\Throwable) {
            OperationalMetrics::increment('reputation.dispatch_failed');

            return false;
        }
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
     *
     * The row is re-read under a lock and the write is conditioned on the
     * version the evaluation read. Checking destinations happens before a
     * network call, and the link can be edited during it: without that
     * condition, a verdict obtained for `malware.example` blocked a link whose
     * owner had already pointed it at somewhere else. The blocking decision then
     * belongs to a row that no longer exists, and the edit already queued its
     * own analysis of the row that does.
     */
    private static function block(object $link, string $source, string $reason): string
    {
        $analysedVersion = (int) ($link->version ?? 0);

        $status = DB::transaction(function () use ($link, $source, $reason, $analysedVersion): string {
            $current = DB::table('links')->where('id', $link->id)->lockForUpdate()->first([
                'id', 'workspace_id', 'state', 'state_before_delete', 'deleted_at', 'version',
            ]);
            if ($current === null || (int) $current->version !== $analysedVersion) {
                // The row is gone, or it is not the row this decision was made
                // about. Either way there is nothing here to block.
                OperationalMetrics::increment('reputation.decision_discarded');

                return self::STALE;
            }

            $alreadyBlocked = (string) $current->state === 'blocked'
                && ($current->deleted_at === null || (string) $current->state_before_delete === 'blocked');
            if ($alreadyBlocked) {
                // A link a moderator already blocked keeps its block and gains
                // no marker: the platform must not be able to withdraw it later.
                return self::UNCHANGED;
            }

            $deleted = $current->deleted_at !== null;
            DB::table('links')->where('id', $link->id)->where('version', $analysedVersion)->update($deleted
                ? ['state' => 'deleted', 'state_before_delete' => 'blocked', 'version' => DB::raw('version + 1'), 'updated_at' => now()]
                : [
                    'state' => 'blocked',
                    // The marker is what makes this decision the platform's own:
                    // reversible by it, and never by accident. A deleted link
                    // deliberately keeps its tombstone unmarked, so a withdrawal
                    // can never resurrect it.
                    'reputation_blocked_at' => now(),
                    'reputation_block_source' => $source,
                    'reputation_block_prior_state' => self::priorState($current),
                    'version' => DB::raw('version + 1'),
                    'updated_at' => now(),
                ]);

            Audit::write(
                null,
                'system.link_block',
                'link',
                (int) $link->id,
                ['controller' => 'destination_reputation', 'signal' => $source, 'reason' => mb_substr($reason, 0, 200)],
                null,
                workspaceId: (int) $current->workspace_id,
            );

            return self::APPLIED;
        });

        if ($status === self::APPLIED) {
            OperationalMetrics::increment('reputation.blocked');
        }

        return $status;
    }

    /**
     * Withdraw a block this platform applied, if that block is still standing.
     *
     * The three conditions in the `where` clause are the whole safety argument:
     * the row must still be `blocked`, it must still carry the marker, and the
     * marker must name the same reason being withdrawn. Two workers reaching the
     * same link therefore produce exactly one transition and one audit entry, and
     * a block a moderator applied between the read and the write is left alone.
     */
    private static function release(object $link, string $source): bool
    {
        if ($link->reputation_blocked_at === null
            || (string) $link->reputation_block_source !== $source
            || $link->deleted_at !== null
            || (string) $link->state !== 'blocked') {
            return false;
        }

        $analysedVersion = (int) ($link->version ?? 0);
        $status = DB::transaction(function () use ($link, $source, $analysedVersion): string {
            // Everything the withdrawal depends on is re-read under the lock,
            // including the state the link goes back to: the earlier read is the
            // one the verdict was computed from, not necessarily the current
            // row.
            $current = DB::table('links')->where('id', $link->id)->lockForUpdate()->first([
                'id', 'workspace_id', 'state', 'deleted_at', 'state_before_delete', 'version',
                'scheduled_at', 'expires_at', 'reputation_blocked_at', 'reputation_block_source',
                'reputation_block_prior_state',
            ]);
            if ($current === null || $current->reputation_blocked_at === null
                || (string) $current->reputation_block_source !== $source
                || $current->deleted_at !== null
                || (string) $current->state !== 'blocked') {
                return self::UNCHANGED;
            }
            if ((int) $current->version !== $analysedVersion) {
                // Withdrawn on the strength of a stale read, the link would come
                // back up in a state nobody chose; the edit that moved it states
                // its own case.
                OperationalMetrics::increment('reputation.decision_discarded');

                return self::STALE;
            }

            $state = self::releaseState($current);
            $updated = DB::table('links')
                ->where('id', $link->id)
                ->where('version', $analysedVersion)
                ->where('state', 'blocked')
                ->where('reputation_block_source', $source)
                ->whereNotNull('reputation_blocked_at')
                ->update([
                    'state' => $state,
                    'reputation_blocked_at' => null,
                    'reputation_block_source' => null,
                    'reputation_block_prior_state' => null,
                    'version' => DB::raw('version + 1'),
                    'updated_at' => now(),
                ]);
            if ($updated !== 1) {
                return self::UNCHANGED;
            }

            Audit::write(
                null,
                'system.link_release',
                'link',
                (int) $link->id,
                ['controller' => 'destination_reputation', 'signal' => $source, 'state' => $state],
                null,
                workspaceId: (int) $current->workspace_id,
            );

            return self::APPLIED;
        });

        if ($status === self::APPLIED) {
            OperationalMetrics::increment('reputation.released');

            return true;
        }

        return false;
    }

    /**
     * The state a link returns to when a self-applied block is withdrawn.
     *
     * The stored prior state is honoured instead of defaulting to `active`: a
     * block that landed on a paused link must give `paused` back, or the
     * platform would silently republish a link its owner had switched off. The
     * expiry and schedule are re-read because either may have passed while the
     * link was blocked.
     */
    private static function releaseState(object $link): string
    {
        $prior = (string) ($link->reputation_block_prior_state ?? 'active');
        $now = now();
        if ($prior === 'paused') {
            return 'paused';
        }
        if ($prior === 'scheduled' && $link->scheduled_at !== null && Carbon::parse($link->scheduled_at)->gt($now)) {
            return 'scheduled';
        }
        if ($link->expires_at !== null && Carbon::parse($link->expires_at)->lte($now)) {
            return 'expired';
        }

        return 'active';
    }

    /** The state a block is replacing, from the set the schema accepts. */
    private static function priorState(object $link): string
    {
        $state = (string) ($link->state ?? '');

        return in_array($state, ['active', 'paused', 'scheduled', 'expired'], true) ? $state : 'active';
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
