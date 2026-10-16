<?php

namespace App\Support;

use App\Exceptions\LinkException;
use App\Models\Link;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Str;

final class AppOpening
{
    /** @return array<string, mixed>|null */
    public static function validate(mixed $value, int $workspace, ?int $domain): ?array
    {
        if ($value === null) {
            return null;
        }
        if (! is_array($value) || ($value['version'] ?? null) !== 1) {
            throw new LinkException('La configuración de aplicación no es válida.', 422);
        }
        if (($value['kind'] ?? null) === 'provider') {
            if (array_diff(array_keys($value), ['version', 'kind', 'provider', 'url'])) {
                throw new LinkException('La configuración contiene campos no admitidos.', 422);
            }
            if (! is_string($value['provider'] ?? null)) {
                throw new LinkException('Selecciona un servicio conocido.', 422);
            }

            $url = AppProviders::normalize($value['provider'], $value['url'] ?? null);
            if (DestinationDenylist::reason($url) !== null) {
                throw new LinkException('Este destino de aplicación está bloqueado.', 422);
            }

            return ['version' => 1, 'kind' => 'provider', 'provider' => $value['provider'], 'url' => $url];
        }
        if (($value['kind'] ?? null) !== 'native' || array_diff(array_keys($value), ['version', 'kind', 'profileId', 'route']) || ! is_string($value['profileId'] ?? null) || ! is_string($value['route'] ?? null)) {
            throw new LinkException('Selecciona una app y una ruta de contenido válida.', 422);
        }
        $profile = self::profile($value['profileId'], $workspace, $domain);
        if (! $profile || ! self::routeAllowed($value['route'], json_decode($profile->route_prefixes, true))) {
            throw new LinkException('La app no está disponible en este dominio o la ruta no está permitida.', 422);
        }

        return ['version' => 1, 'kind' => 'native', 'profileId' => $profile->public_id, 'route' => $value['route']];
    }

    /** @param list<string> $prefixes */
    public static function routeAllowed(string $route, array $prefixes): bool
    {
        // Deliberately exclude escapes, query strings and fragments: routing is
        // a content path, never a second URL or a native command.
        if (strlen($route) > 500 || preg_match('~^/(?:[A-Za-z0-9_-]+/)*[A-Za-z0-9_-]*$~D', $route) !== 1) {
            return false;
        }
        foreach ($prefixes as $prefix) {
            if ($route === rtrim($prefix, '/') || str_starts_with($route, $prefix)) {
                return true;
            }
        }

        return false;
    }

    public static function profile(string $id, int $workspace, ?int $domain): ?object
    {
        if ($domain === null || ! Str::isUuid($id)) {
            return null;
        }

        return DB::table('app_link_profiles')->join('custom_domains as d', function ($join) {
            $join->on('d.id', '=', 'app_link_profiles.domain_id')->on('d.workspace_id', '=', 'app_link_profiles.workspace_id');
        })->where('app_link_profiles.public_id', $id)->where('app_link_profiles.workspace_id', $workspace)
            ->where('d.id', $domain)->where('app_link_profiles.enabled', true)
            ->where('d.desired_state', 'enabled')->where('d.edge_eligible', true)->whereNotNull('d.tls_ready_at')
            ->whereExists(fn ($q) => $q->selectRaw('1')->from('custom_domain_claims')->whereColumn('custom_domain_claims.workspace_id', 'd.workspace_id')->whereRaw('lower(custom_domain_claims.domain) = lower(d.domain)'))
            ->sharedLock()->first(['app_link_profiles.*']);
    }

    /** @return array<string, mixed>|null */
    public static function delivery(Link $link, string $source, ?object $profile = null): ?array
    {
        $spec = $link->app_opening;
        if ($source !== 'primary' || ! is_array($spec)) {
            return null;
        }
        if (($spec['kind'] ?? '') === 'provider' && config('app_links.providers')) {
            if (DestinationDenylist::reason($spec['url']) !== null) {
                return null;
            }

            return ['kind' => 'provider', 'label' => AppProviders::LABELS[$spec['provider']], 'url' => AppProviders::normalize($spec['provider'], $spec['url'])];
        }
        if (($spec['kind'] ?? '') === 'native' && config('app_links.native')) {
            $p = $profile ?? self::profile($spec['profileId'], (int) $link->workspace_id, $link->domain_id);
            if (! $p || ! self::routeAllowed($spec['route'], json_decode($p->route_prefixes, true))) {
                return null;
            }

            return ['kind' => 'native', 'label' => $p->name, 'profileId' => $p->public_id, 'profileVersion' => (int) $p->version, 'route' => $spec['route']];
        }

        return null;
    }

    public static function enabled(Link $link): bool
    {
        return ($link->app_opening['kind'] ?? '') === 'native' ? (bool) config('app_links.native')
            : (($link->app_opening['kind'] ?? '') === 'provider' && (bool) config('app_links.providers'));
    }

    public static function domainRelation(): string
    {
        return config('app_links.native') ? 'domain.appProfile' : 'domain';
    }

    public static function launchUrl(Link $link, string $shortUrl): ?string
    {
        if (! config('app_links.native') || ($link->app_opening['kind'] ?? '') !== 'native') {
            return null;
        }

        $link->loadMissing('domain.appProfile');
        $profile = $link->domain?->appProfile;
        if (! $profile || ! $profile->enabled || (int) $profile->workspace_id !== (int) $link->workspace_id || $profile->public_id !== ($link->app_opening['profileId'] ?? null) || $link->domain->desired_state !== 'enabled' || ! $link->domain->edge_eligible || $link->domain->tls_ready_at === null) {
            return null;
        }

        return preg_replace('~/[^/]+$~', '/a/'.rawurlencode($link->alias), $shortUrl);
    }
}
