<?php

namespace App\Support;

use App\Exceptions\LinkException;
use App\Models\CustomDomain;
use App\Models\Link;
use App\Models\User;
use Illuminate\Database\Eloquent\Collection;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;

/** Shared review/execution rules; every caller holds the workspace write lock. */
final class DomainReassignment
{
    public static function authorize(Request $request): User
    {
        $user = UvhRequest::user($request);
        $context = SecurityContext::lock($user, UvhRequest::sessionId($request), requireVerifiedEmail: true);
        if (! $context || ! WorkspaceAccess::getMembershipForContext($context, UvhRequest::workspaceId($request), 'admin')) {
            throw new LinkException('Tu acceso al workspace cambió. Recarga antes de continuar.', 403);
        }

        return $context->user;
    }

    /** @return list<int> */
    public static function linkIds(mixed $value): array
    {
        if (! is_array($value) || ! array_is_list($value) || count($value) < 1 || count($value) > 100) {
            throw new LinkException('Selecciona entre 1 y 100 enlaces.', 422);
        }
        foreach ($value as $id) {
            if (! is_int($id) || $id < 1) {
                throw new LinkException('Selección de enlaces inválida.', 422);
            }
        }
        if (count(array_unique($value)) !== count($value)) {
            throw new LinkException('La selección contiene enlaces repetidos.', 422);
        }
        sort($value, SORT_NUMERIC);

        return $value;
    }

    /**
     * @param  list<int>  $ids
     * @return array<int, int>
     */
    public static function versions(mixed $value, array $ids): array
    {
        if (! is_array($value) || ! array_is_list($value) || count($value) !== count($ids)) {
            throw new LinkException('Vuelve a revisar los enlaces antes de confirmar.', 422);
        }
        $versions = [];
        foreach ($value as $item) {
            if (! is_array($item) || ! is_int($item['id'] ?? null) || ! in_array($item['id'], $ids, true)
                || ! is_int($item['version'] ?? null) || $item['version'] < 1 || isset($versions[$item['id']])) {
                throw new LinkException('Versiones de enlaces inválidas.', 422);
            }
            $versions[$item['id']] = $item['version'];
        }

        return $versions;
    }

    public static function source(int $workspaceId, int $id): CustomDomain
    {
        $domain = CustomDomain::where('workspace_id', $workspaceId)->where('id', $id)->lockForUpdate()->first();
        if (! $domain) {
            throw new LinkException('Dominio no encontrado.', 404);
        }

        return $domain;
    }

    /** @return array<string, mixed> */
    public static function impact(CustomDomain $domain): array
    {
        $links = Link::withTrashed()->where('domain_id', $domain->id)->where('workspace_id', $domain->workspace_id);
        $live = (clone $links)->whereNull('deleted_at')->count();
        $trash = (clone $links)->whereNotNull('deleted_at')->count();
        $blocked = (clone $links)->where(fn ($q) => $q->where('state', 'blocked')->orWhere('state_before_delete', 'blocked'))->count();

        return [
            'domainId' => (int) $domain->id, 'domain' => $domain->domain,
            'isDefault' => (bool) $domain->is_default,
            'liveLinks' => $live, 'trashedLinks' => $trash, 'blockedLinks' => $blocked,
            'totalLinks' => $live + $trash, 'canDelete' => $live + $trash === 0,
        ];
    }

    /**
     * @param  list<int>  $ids
     * @param  array<int, int>|null  $versions
     * @return array{preview: array<string, mixed>, links: Collection<int, Link>}
     */
    public static function prepare(int $workspaceId, int $sourceId, array $ids, ?int $targetId, ?array $versions = null): array
    {
        if ($targetId === $sourceId) {
            throw new LinkException('Elige un dominio de destino diferente.', 422);
        }
        // All browser link writers serialize on the workspace parent first.
        // Domain locks are additionally ordered to match concurrent batches.
        $domainIds = $targetId === null ? [$sourceId] : [$sourceId, $targetId];
        sort($domainIds, SORT_NUMERIC);
        $hostnames = CustomDomain::where('workspace_id', $workspaceId)->whereIn('id', $domainIds)->orderBy('domain')->pluck('domain');
        foreach ($hostnames as $hostname) {
            DomainClaims::lockHostname($hostname);
        }
        $domains = CustomDomain::where('workspace_id', $workspaceId)->whereIn('id', $domainIds)
            ->orderBy('id')->lockForUpdate()->get()->keyBy('id');
        $source = $domains->get($sourceId);
        if (! $source || ($targetId !== null && ! $domains->has($targetId))) {
            throw new LinkException('Dominio no encontrado.', 404);
        }
        $target = $targetId === null ? null : $domains->get($targetId);
        if ($target && ! DomainStatus::servingReady($target)) {
            throw new LinkException('El dominio de destino no está disponible. Revisa su conexión.', 409);
        }
        $links = Link::withTrashed()->where('workspace_id', $workspaceId)->where('domain_id', $sourceId)
            ->whereIn('id', $ids)->orderBy('id')->lockForUpdate()->get();
        if ($links->count() !== count($ids)) {
            throw new LinkException('La selección cambió o contiene enlaces que no pertenecen a este dominio. Recarga y vuelve a revisarla.', 409);
        }
        $aliases = $links->map(fn (Link $link) => strtolower($link->alias))->all();
        $duplicates = array_count_values($aliases);
        // Platform aliases are global, not workspace-local. Only return the
        // conflict, never the owner, resource id or destination of its holder.
        $taken = Link::withTrashed()->where('domain_id', $targetId)
            ->whereIn(DB::raw('lower(alias)'), $aliases)
            ->pluck('alias')->map(fn ($alias) => strtolower($alias))->flip();
        $retention = max(1, (int) config('uvh.housekeeping.link_trash_days', 30));
        $rows = [];
        foreach ($links as $link) {
            if ($versions !== null && ($versions[(int) $link->id] ?? null) !== (int) $link->version) {
                throw new LinkException('Un enlace cambió desde la revisión. Revisa de nuevo antes de confirmar.', 409);
            }
            $alias = strtolower($link->alias);
            $blocked = $link->state === 'blocked' || $link->state_before_delete === 'blocked';
            $rows[] = [
                'linkId' => (int) $link->id, 'version' => (int) $link->version, 'alias' => $link->alias,
                'oldUrl' => LinkService::shortUrl($source->domain, $link->alias),
                'newUrl' => LinkService::shortUrl($target?->domain, $link->alias),
                'state' => $link->state, 'inTrash' => $link->deleted_at !== null,
                'deletedAt' => IsoDate::format($link->deleted_at),
                'purgeAt' => IsoDate::format($link->deleted_at?->copy()->addDays($retention)),
                'conflict' => $blocked ? 'blocked' : (($taken->has($alias) || $duplicates[$alias] > 1) ? 'alias_conflict' : null),
            ];
        }

        return ['links' => $links, 'preview' => [
            'domainId' => $sourceId, 'targetDomainId' => $targetId,
            'canApply' => ! collect($rows)->contains(fn ($row) => $row['conflict'] !== null), 'links' => $rows,
        ]];
    }
}
