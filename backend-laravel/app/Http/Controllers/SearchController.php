<?php

namespace App\Http\Controllers;

use App\Models\CustomDomain;
use App\Models\Link;
use App\Support\DomainStatus;
use App\Support\LinkSearch;
use App\Support\LinkService;
use App\Support\SearchTerm;
use App\Support\UvhRequest;
use Illuminate\Database\Query\JoinClause;
use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;

final class SearchController
{
    public function index(Request $request): JsonResponse
    {
        $raw = $request->query('q', '');
        if (! is_string($raw) || ! mb_check_encoding($raw, 'UTF-8') || mb_strlen($raw) > 200 || preg_match('/[\p{Cc}\p{Cf}]/u', $raw)) {
            return response()->json(['error' => __('messages.error_623f7b6004bba5')], 422);
        }
        $term = trim($raw);
        $empty = ['version' => 1, 'links' => [], 'domains' => [], 'moreLinks' => false, 'moreDomains' => false];
        if (mb_strlen($term) < 2) {
            return response()->json($empty)->header('Cache-Control', 'private, no-store');
        }
        $workspaceId = UvhRequest::workspaceId($request);
        $pattern = SearchTerm::contains($term);
        $query = Link::where('links.workspace_id', $workspaceId)->whereNull('links.deleted_at');
        LinkSearch::matching($query, $pattern);
        LinkSearch::rank($query, $term);
        // One join, no per-result relation lookups and no expensive total count.
        $links = $query->leftJoin('custom_domains', fn (JoinClause $join) => $join
            ->on('custom_domains.id', '=', 'links.domain_id')->where('custom_domains.workspace_id', $workspaceId))
            ->limit(11)->get(['links.id', 'links.name', 'links.alias', 'links.state', 'custom_domains.domain as hostname']);
        $domains = CustomDomain::where('workspace_id', $workspaceId)->where('domain', 'ilike', $pattern)
            ->orderByRaw('CASE WHEN domain ILIKE ? THEN 0 WHEN domain ILIKE ? THEN 1 ELSE 2 END', [SearchTerm::escape($term), SearchTerm::escape($term).'%'])
            ->orderBy('id')->limit(6)->get(['id', 'domain', 'desired_state', 'ownership_status', 'routing_status', 'tls_status', 'edge_eligible', 'tls_ready_at', 'dns_error']);

        return response()->json([
            'version' => 1,
            'links' => $links->take(10)->map(fn ($link) => ['id' => (int) $link->id, 'name' => $link->name,
                'shortUrl' => LinkService::shortUrl($link->getAttribute('hostname'), $link->alias), 'state' => $link->state])->values(),
            'domains' => $domains->take(5)->map(fn ($domain) => ['id' => (int) $domain->id, 'hostname' => $domain->domain, 'state' => DomainStatus::trafficStatus($domain)])->values(),
            'moreLinks' => $links->count() > 10, 'moreDomains' => $domains->count() > 5,
        ])->header('Cache-Control', 'private, no-store');
    }
}
