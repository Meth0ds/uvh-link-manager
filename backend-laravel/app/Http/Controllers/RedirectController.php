<?php

namespace App\Http\Controllers;

use App\Jobs\RecordClickAnalyticsJob;
use App\Models\Link;
use App\Support\OperationalMetrics;
use App\Support\RedirectService;
use App\Support\SignedToken;
use App\Support\Ua;
use App\Support\UrlUtil;
use App\Support\UvhCrypto;
use App\Support\UvhRequest;
use App\Support\VisitorAnswer;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Hash;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Str;
use Symfony\Component\HttpFoundation\Cookie;

class RedirectController
{
    public function resolve(Request $request, ?string $alias = null)
    {
        $alias = $alias ?? (string) $request->route('alias', '');

        $ctx = [
            'host' => $request->getHost(),
            'alias' => $alias,
            'user_agent' => $request->header('user-agent'),
            'accept_language' => $request->header('accept-language'),
            'referrer' => $request->header('referer'),
            'ip' => $request->ip(),
            'country' => $this->countryFromHeaders($request),
            'unlock_token' => $request->cookies->get(RedirectService::UNLOCK_COOKIE),
        ];

        $outcome = RedirectService::resolve($ctx);

        if ($outcome['kind'] === 'redirect') {
            $this->recordClick($outcome['link_id'], $ctx, $outcome['campaign'] ?? null);

            return response('', 302, [
                'Location' => $outcome['location'],
                'Cache-Control' => 'no-store',
                'Pragma' => 'no-cache',
            ]);
        }

        if ($outcome['kind'] === 'password_required') {
            return VisitorAnswer::passwordRequired($request, $alias);
        }

        if ($outcome['kind'] === 'gone') {
            return VisitorAnswer::notice('Enlace agotado', 'Este enlace ya no está disponible (límite de clics o uso único alcanzado).', 410);
        }

        if ($outcome['kind'] === 'unavailable') {
            $labels = [
                'paused' => ['Enlace en pausa', 'Este enlace está temporalmente desactivado.'],
                'expired' => ['Enlace caducado', 'Este enlace ha expirado.'],
                'blocked' => ['Enlace bloqueado', 'Este enlace fue bloqueado por incumplir nuestras normas.'],
                'archived' => ['Enlace archivado', 'Este enlace ya no está activo.'],
                'scheduled' => ['Enlace programado', 'Este enlace se activará pronto.'],
                'domain' => ['Dominio no configurado', 'El dominio de este enlace no está activo.'],
            ];
            [$title, $body] = $labels[$outcome['reason']] ?? ['No disponible', 'Este enlace no está disponible.'];

            return VisitorAnswer::notice($title, $body, 404);
        }

        return VisitorAnswer::notice('Enlace no encontrado', 'El enlace que buscas no existe o fue eliminado.', 404);
    }

    /**
     * Cada rechazo del formulario que un visitante puede provocar tiene que
     * volver a la pantalla, no a un cuerpo JSON: quien tiene delante la puerta
     * no puede leer `{"error":…}` ni tiene otra forma de continuar. El sobre
     * JSON sigue siendo el mismo para los clientes de API, y el estado HTTP
     * tampoco cambia. Aquí sólo se decide la admisión; quién ve qué lo resuelve
     * `VisitorAnswer`.
     */
    public function unlock(Request $request, string $alias)
    {
        if (! $this->verifyCsrf($request)) {
            return VisitorAnswer::staleForm($request, $alias);
        }

        $password = UvhRequest::inputString($request, 'password');
        if ($password === '' || strlen($password) > 72) {
            return VisitorAnswer::passwordOutOfRange($request, $alias);
        }

        $alias = UrlUtil::normalizeAlias($alias);
        if ($alias === '' || strlen($alias) > 64 || UrlUtil::isReservedAlias($alias) || ! UrlUtil::isValidCustomAlias($alias)) {
            return VisitorAnswer::noSuchLink($request);
        }
        $host = RedirectService::normalizeHost($request->getHost());
        $domainId = RedirectService::resolveDomainId($host);

        if ($domainId === -1) {
            return VisitorAnswer::noSuchLink($request);
        }

        $query = Link::whereNull('deleted_at')->where('alias', $alias);
        if ($domainId === null) {
            $query->whereNull('domain_id');
        } else {
            $query->where('domain_id', $domainId);
        }
        $link = $query->first();

        if (! $link || ! $link->password_hash) {
            return VisitorAnswer::noSuchLink($request);
        }

        if (! Hash::check($password, $link->password_hash)) {
            return VisitorAnswer::wrongPassword($request, $alias);
        }

        // Bind the token to the exact link: a stale unlock token must not open
        // a recreated link with the same alias.
        $token = SignedToken::sign(json_encode([
            'alias' => $alias,
            'host' => $host,
            'link' => $link->id,
            'password_version' => (int) $link->password_version,
        ]), 10 * 60_000);

        $cookie = new Cookie(
            RedirectService::UNLOCK_COOKIE,
            $token,
            time() + 10 * 60,
            '/',
            null,
            (bool) config('uvh.cookie_secure'),
            true,
            false,
            'lax',
        );

        return VisitorAnswer::unlocked($request, $alias, $cookie);
    }

    // ---------------- helpers ----------------

    private function countryFromHeaders(Request $request): ?string
    {
        if (! (bool) config('uvh.trust_country_header')) {
            return null;
        }
        // Provider data, and HTTP does not normalise its casing for us: one
        // edge sends `ES`, another sends `es`. The rule comparison lowercases
        // both sides, so the only place the case decided anything was here:
        // demanding one specific casing silently dropped the country, which
        // sent those visitors to the fallback and lost that slice of the
        // country analytics. The stored form is what a country code is, upper
        // case; anything that is not two ASCII letters is still no country.
        $value = $request->header((string) config('uvh.country_header'));
        if (is_string($value) && preg_match('/^[A-Za-z]{2}$/', $value)) {
            return strtoupper($value);
        }

        return null;
    }

    private function recordClick(int $linkId, array $ctx, ?string $campaign): void
    {
        $ua = Ua::parse($ctx['user_agent'] ?? null);
        try {
            $meta = [
                'country' => $ctx['country'] ?? null,
                'device' => $ua['device'],
                'browser' => $ua['browser'],
                'os' => $ua['os'],
                'referrer_domain' => RedirectService::referrerDomain($ctx['referrer'] ?? null),
                'campaign' => $campaign,
                'visitor_hash' => $this->visitorHash($ctx['ip'] ?? null, $ctx['user_agent'] ?? null),
            ];
            // Queue only privacy-reduced dimensions. Redirect availability is
            // deliberately higher priority than optional analytics admission;
            // failure is counted and never weakens click limits/single-use.
            RecordClickAnalyticsJob::dispatch((string) Str::uuid(), $linkId, now()->utc()->toIso8601String(), $meta);
        } catch (\Throwable $e) {
            // Redirect availability takes priority over analytics. The event is
            // observable by operators without leaking requester identifiers.
            OperationalMetrics::increment('analytics.record_failed');
            Log::error('[analytics] click recording failed', ['exception' => $e::class]);
        }
    }

    private function visitorHash(?string $ip, ?string $userAgent): ?string
    {
        if (! $ip || ! $userAgent) {
            return null;
        }
        $day = now()->format('Y-m-d');

        return UvhCrypto::visitorHash($day, $ip, $userAgent);
    }

    private function verifyCsrf(Request $request): bool
    {
        $cookie = $request->cookies->get((string) config('uvh.csrf_cookie'));
        $supplied = $request->header('x-csrf-token') ?? $request->input('_csrf');

        return is_string($cookie) && is_string($supplied)
            && $cookie !== '' && hash_equals($cookie, $supplied);
    }
}
