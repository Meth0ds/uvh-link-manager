<?php

namespace App\Support;

use App\Models\CustomDomain;
use App\Models\CustomDomainClaim;

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
    /** @return array{outcome: 'claimed'|'yours'|'conflict'|'takeover', previous_workspace_id: ?int} */
    public static function prove(int $workspaceId, string $domain): array
    {
        $normalized = strtolower(rtrim($domain, '.'));
        $now = now();
        $freshDays = max(1, (int) config('uvh.custom_domains.claim_fresh_days', 30));

        $claim = CustomDomainClaim::whereRaw('lower(domain) = ?', [$normalized])->lockForUpdate()->first();
        if ($claim === null) {
            CustomDomainClaim::create([
                'workspace_id' => $workspaceId,
                'domain' => $normalized,
                'claimed_at' => $now,
                'last_proven_at' => $now,
            ]);

            return ['outcome' => 'claimed', 'previous_workspace_id' => null];
        }

        if ((int) $claim->workspace_id === $workspaceId) {
            $claim->forceFill(['last_proven_at' => $now])->save();

            return ['outcome' => 'yours', 'previous_workspace_id' => null];
        }

        if ($claim->last_proven_at->gt($now->copy()->subDays($freshDays))) {
            return ['outcome' => 'conflict', 'previous_workspace_id' => (int) $claim->workspace_id];
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
        self::demoteHolder($previousWorkspaceId, $normalized);

        return ['outcome' => 'takeover', 'previous_workspace_id' => $previousWorkspaceId];
    }

    /**
     * Give up a claim because its domain row is being deleted. Only the claim
     * holder's own row may release it.
     */
    public static function release(int $workspaceId, string $domain): void
    {
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

    private static function demoteHolder(int $workspaceId, string $domain): void
    {
        CustomDomain::where('workspace_id', $workspaceId)
            ->whereRaw('lower(domain) = ?', [$domain])
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
}
