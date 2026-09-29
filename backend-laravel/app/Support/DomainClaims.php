<?php

namespace App\Support;

use App\Models\CustomDomain;
use App\Models\CustomDomainClaim;
use Illuminate\Support\Facades\DB;

/**
 * Ownership claims on hostnames: the exclusive right to serve a domain.
 *
 * `custom_domains` rows are requests and may exist for the same hostname in any
 * number of workspaces; the claim created here — atomically, only when the TXT
 * challenge is proven — is what makes a hostname belong to exactly one of
 * them. Three outcomes exist when a workspace proves the challenge:
 *
 *  - `claimed`/`yours`: the hostname now belongs to this workspace.
 *  - `conflict`: another workspace proved ownership recently. The name is
 *    theirs; this workspace keeps its request but may not serve, and the fact
 *    is only revealed to whoever can publish the TXT record.
 *  - `takeover`: the previous holder stopped proving ownership long ago (the
 *    name changed hands, or the old tenant abandoned it). The claim moves
 *    atomically and the previous holder is demoted and told.
 *
 * Callers must run inside a transaction: the claim write, the domain status
 * write and the demotion of a displaced holder are one indivisible fact.
 */
final class DomainClaims
{
    /**
     * @return array{
     *   outcome: 'claimed'|'yours'|'conflict'|'takeover',
     *   previous_workspace_id: ?int,
     *   previous_domain_ids: list<int>,
     * }
     */
    public static function prove(int $workspaceId, string $domain): array
    {
        $normalized = strtolower(rtrim($domain, '.'));
        $now = now();
        $freshDays = max(1, (int) config('uvh.custom_domains.claim_fresh_days', 30));

        self::lockHostname($normalized);
        $claim = CustomDomainClaim::whereRaw('lower(domain) = ?', [$normalized])->lockForUpdate()->first();
        if ($claim === null) {
            CustomDomainClaim::create([
                'workspace_id' => $workspaceId,
                'domain' => $normalized,
                'claimed_at' => $now,
                'last_proven_at' => $now,
            ]);

            return ['outcome' => 'claimed', 'previous_workspace_id' => null, 'previous_domain_ids' => []];
        }

        if ((int) $claim->workspace_id === $workspaceId) {
            $claim->forceFill(['last_proven_at' => $now])->save();

            return ['outcome' => 'yours', 'previous_workspace_id' => null, 'previous_domain_ids' => []];
        }

        if ($claim->last_proven_at->gt($now->copy()->subDays($freshDays))) {
            return ['outcome' => 'conflict', 'previous_workspace_id' => (int) $claim->workspace_id, 'previous_domain_ids' => []];
        }

        // The previous holder has not proven ownership within the freshness
        // window: whoever controls the DNS record today is the owner. The move
        // and the demotion of every request the displaced holder kept for this
        // hostname commit together, so the edge can never serve a hostname
        // whose claim has moved away.
        $previousWorkspaceId = (int) $claim->workspace_id;
        $claim->forceFill([
            'workspace_id' => $workspaceId,
            'claimed_at' => $now,
            'last_proven_at' => $now,
        ])->save();
        $previousDomainIds = self::demoteHolder($previousWorkspaceId, $normalized);

        return [
            'outcome' => 'takeover',
            'previous_workspace_id' => $previousWorkspaceId,
            'previous_domain_ids' => $previousDomainIds,
        ];
    }

    /**
     * The canonical lock order for hostname state: workspace auth → **this
     * hostname lock** → domain rows (own first, then foreign rows in id order).
     *
     * Every transaction that touches both a claim and the domain rows of a
     * hostname takes this lock first. Without it, two workspaces verifying the
     * same hostname could invert: one holding its own domain row while waiting
     * for the claim, the other holding the claim while demoting that row — a
     * reproducible deadlock right at a takeover. With a transaction-scoped
     * advisory lock keyed by hostname, those transactions serialize instead.
     *
     * Re-acquiring in the same transaction is free: PostgreSQL advisory locks
     * are re-entrant per session, so `prove()`/`release()` may assert the order
     * defensively even when the caller already holds it.
     */
    public static function lockHostname(string $domain): void
    {
        if (DB::connection()->getDriverName() === 'pgsql') {
            DB::select('SELECT pg_advisory_xact_lock(?)', [self::hostnameLockKey($domain)]);

            return;
        }
        // Non-PostgreSQL stores keep the row-level fallback: the claim row
        // lock serializes claim writers at the cost of a null read when no
        // claim exists yet (the create race is guarded by the unique index).
        CustomDomainClaim::whereRaw('lower(domain) = ?', [strtolower(rtrim($domain, '.'))])->lockForUpdate()->first();
    }

    /** The advisory lock key for one hostname. */
    public static function hostnameLockKey(string $domain): int
    {
        return (int) hexdec(substr(hash('sha256', 'uvh:domain-claim:'.strtolower(rtrim($domain, '.'))), 0, 15));
    }

    /**
     * Give up a claim because its domain row is being deleted. Only the claim
     * holder's own row may release it.
     */
    public static function release(int $workspaceId, string $domain): void
    {
        self::lockHostname($domain);
        CustomDomainClaim::whereRaw('lower(domain) = ?', [strtolower(rtrim($domain, '.'))])
            ->where('workspace_id', $workspaceId)
            ->delete();
    }

    /**
     * Retire claims whose holder no longer has any request for the hostname.
     * The grace period keeps a claim alive across a delete-and-recreate, which
     * the owner may do to rotate the verification token.
     */
    public static function purgeOrphans(int $graceDays = 7): int
    {
        return CustomDomainClaim::where('claimed_at', '<', now()->subDays($graceDays))
            ->whereNotExists(function ($query) {
                $query->selectRaw('1')->from('custom_domains')
                    ->whereColumn('custom_domains.workspace_id', 'custom_domain_claims.workspace_id')
                    ->whereRaw('lower(custom_domains.domain) = lower(custom_domain_claims.domain)');
            })
            ->delete();
    }

    /**
     * Demote every request the displaced holder kept for this hostname and
     * return their ids. The transfer event is recorded against these rows —
     * the *old* workspace's rows — so the old owner's activity timeline and
     * notification route name resources that actually exist in their
     * workspace instead of the new owner's ids.
     *
     * @return list<int>
     */
    private static function demoteHolder(int $workspaceId, string $domain): array
    {
        $ids = CustomDomain::where('workspace_id', $workspaceId)
            ->whereRaw('lower(domain) = ?', [$domain])
            ->orderBy('id')
            ->pluck('id')
            ->map(static fn ($id): int => (int) $id)
            ->all();
        // One row at a time, in id order: row-lock acquisition is deterministic
        // even against transactions that lock several domain rows at once.
        foreach ($ids as $id) {
            CustomDomain::where('id', $id)
                ->where('workspace_id', $workspaceId)
                ->where('desired_state', 'enabled')
                ->update([
                    'ownership_status' => 'lost',
                    'ownership_verified_at' => null,
                    'edge_eligible' => false,
                    'tls_ready_at' => null,
                    'tls_status' => 'pending',
                    'dns_error' => 'claim_transferred',
                    'updated_at' => now(),
                ]);
        }

        return $ids;
    }
}
