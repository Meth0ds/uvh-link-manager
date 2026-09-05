<?php

namespace App\Http\Controllers;

use App\Models\CustomDomain;
use App\Support\ProductionSecurity;
use App\Support\UvhRequest;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Response;

final class EdgeController
{
    /**
     * Caddy On-Demand TLS authorization endpoint.
     *
     * It is reachable only through Nginx's internal listener, which injects a
     * shared secret. The decision is deliberately a single indexed lookup: the
     * TLS handshake must not trigger DNS or other outbound network activity.
     */
    public function caddyAsk(Request $request): Response
    {
        $configuredSecret = (string) config('uvh.custom_domains.edge_ask_secret');
        $providedSecret = (string) $request->header('X-UVH-Edge-Secret', '');
        if ($configuredSecret === '' || $providedSecret === '' || ! hash_equals($configuredSecret, $providedSecret)) {
            return response('', 404)->header('Cache-Control', 'no-store');
        }

        $domain = strtolower(rtrim(UvhRequest::queryString($request, 'domain'), '.'));
        if (! ProductionSecurity::validHostname($domain)) {
            return response('', 404)->header('Cache-Control', 'no-store');
        }

        $publicHost = strtolower(rtrim((string) config('uvh.public_host'), '.'));
        $appHost = strtolower(rtrim((string) config('uvh.app_host'), '.'));
        if (in_array($domain, [$publicHost, 'www.'.$publicHost, $appHost, 'www.'.$appHost], true)) {
            return response('', 204)->header('Cache-Control', 'no-store');
        }

        $allowed = CustomDomain::whereRaw('lower(domain) = ?', [$domain])
            ->where('edge_eligible', true)
            ->where(function ($query) {
                $query->where('state', 'provisioning')
                    ->orWhere(function ($active) {
                        $active->where('state', 'active')->whereNotNull('tls_ready_at');
                    });
            })
            ->exists();

        return response('', $allowed ? 204 : 404)->header('Cache-Control', 'no-store');
    }
}
