<?php

namespace App\Http\Controllers;

use App\Models\Link;
use App\Support\AnalyticsService;
use App\Support\Ids;
use App\Support\RedirectService;
use App\Support\SignedToken;
use App\Support\Ua;
use App\Support\UrlUtil;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Hash;
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
            if ($this->wantsHtml($request)) {
                [$html, $cookie] = $this->passwordPage($request, $alias);

                return $cookie
                    ? response($html, 403)->withCookie($cookie)
                    : response($html, 403);
            }

            return response()->json(['error' => 'Enlace protegido con contraseña', 'passwordRequired' => true], 403);
        }

        if ($outcome['kind'] === 'gone') {
            return response($this->page('Enlace agotado', 'Este enlace ya no está disponible (límite de clics o uso único alcanzado).', 410), 410);
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

            return response($this->page($title, $body, 404), 404);
        }

        return response($this->page('Enlace no encontrado', 'El enlace que buscas no existe o fue eliminado.', 404), 404);
    }

    public function unlock(Request $request, string $alias)
    {
        if (! $this->verifyCsrf($request)) {
            return response()->json(['error' => 'Token CSRF inválido'], 403);
        }

        $password = (string) $request->input('password', '');
        if ($password === '' || strlen($password) > 256) {
            return response()->json(['error' => 'Contraseña requerida'], 422);
        }

        $alias = UrlUtil::normalizeAlias($alias);
        if ($alias === '' || strlen($alias) > 64 || UrlUtil::isReservedAlias($alias) || ! UrlUtil::isValidCustomAlias($alias)) {
            return response()->json(['error' => 'Enlace no encontrado'], 404);
        }
        $host = RedirectService::normalizeHost($request->getHost());
        $domainId = RedirectService::resolveDomainId($host);

        if ($domainId === -1) {
            return response()->json(['error' => 'Enlace no encontrado'], 404);
        }

        $query = Link::whereNull('deleted_at')->where('alias', $alias);
        if ($domainId === null) {
            $query->whereNull('domain_id');
        } else {
            $query->where('domain_id', $domainId);
        }
        $link = $query->first();

        if (! $link || ! $link->password_hash) {
            return response()->json(['error' => 'Enlace no encontrado'], 404);
        }

        if (! Hash::check($password, $link->password_hash)) {
            if ($this->wantsHtml($request)) {
                [$html, $cookie] = $this->passwordPage($request, $alias, 'Contraseña incorrecta');
                $response = response($html, 403);
                if ($cookie) {
                    $response->withCookie($cookie);
                }

                return $response;
            }

            return response()->json(['error' => 'Contraseña incorrecta'], 403);
        }

        // Bind the token to the exact link: a stale unlock token must not open
        // a recreated link with the same alias.
        $token = SignedToken::sign(json_encode(['alias' => $alias, 'host' => $host, 'link' => $link->id]), 10 * 60_000);

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

        if ($this->wantsHtml($request)) {
            return redirect('/r/'.rawurlencode($alias), 302)->withCookie($cookie);
        }

        return response()->json(['ok' => true])->withCookie($cookie);
    }

    // ---------------- helpers ----------------

    private function wantsHtml(Request $request): bool
    {
        return $request->accepts('text/html');
    }

    private function countryFromHeaders(Request $request): ?string
    {
        if (! (bool) config('uvh.trust_country_header')) {
            return null;
        }
        $value = $request->header((string) config('uvh.country_header'));
        if (is_string($value) && preg_match('/^[A-Z]{2}$/', $value)) {
            return $value;
        }

        return null;
    }

    private function recordClick(int $linkId, array $ctx, ?string $campaign): void
    {
        $ua = Ua::parse($ctx['user_agent'] ?? null);
        AnalyticsService::recordClick($linkId, [
            'country' => $ctx['country'] ?? null,
            'device' => $ua['device'],
            'browser' => $ua['browser'],
            'os' => $ua['os'],
            'referrer_domain' => RedirectService::referrerDomain($ctx['referrer'] ?? null),
            'campaign' => $campaign,
            'visitor_hash' => $this->visitorHash($ctx['ip'] ?? null, $ctx['user_agent'] ?? null),
        ]);
    }

    private function visitorHash(?string $ip, ?string $userAgent): ?string
    {
        if (! $ip || ! $userAgent) {
            return null;
        }
        $day = now()->format('Y-m-d');

        return substr(hash('sha256', "{$day}|{$ip}|{$userAgent}"), 0, 32);
    }

    private function verifyCsrf(Request $request): bool
    {
        $cookie = $request->cookies->get((string) config('uvh.csrf_cookie'));
        $supplied = $request->header('x-csrf-token') ?? $request->input('_csrf');

        return is_string($cookie) && is_string($supplied)
            && $cookie !== '' && hash_equals($cookie, $supplied);
    }

    private function passwordPage(Request $request, string $alias, ?string $error = null): array
    {
        $token = $request->cookies->get((string) config('uvh.csrf_cookie'));
        $cookie = null;
        if (! is_string($token) || $token === '') {
            $token = Ids::base64urlEncode(random_bytes(24));
            $cookie = new Cookie((string) config('uvh.csrf_cookie'), $token, 0, '/', null, (bool) config('uvh.cookie_secure'), false, false, 'lax');
        }

        $err = $error !== null
            ? '<div class="err">'.htmlspecialchars($error, ENT_QUOTES, 'UTF-8').'</div>'
            : '';

        $html = '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            .'<title>Enlace protegido · UVH</title><style>'
            .'body{font-family:Manrope,Segoe UI,Arial,sans-serif;background:#F6F8FC;color:#07111F;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}'
            .'.card{background:#fff;border:1px solid #E3E8F0;border-radius:16px;padding:40px;max-width:400px;width:100%}'
            .'h1{font-size:20px;margin:0 0 4px} p{color:#33415C;margin:0 0 16px}'
            .'input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #CBD3E0;border-radius:8px;font-size:15px}'
            .'button{width:100%;margin-top:12px;background:#2457F5;color:#fff;border:0;padding:12px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}'
            .'.err{color:#C62828;font-size:13px;margin-top:10px}'
            .'</style></head><body><div class="card"><h1>Enlace protegido</h1><p>Este enlace está protegido con contraseña. Introdúcela para continuar.</p>'
            .'<form method="post" action="/r/'.rawurlencode($alias).'/unlock">'
            .'<input type="password" name="password" placeholder="Contraseña" autofocus required>'
            .'<input type="hidden" name="_csrf" value="'.htmlspecialchars($token, ENT_QUOTES, 'UTF-8').'">'
            .'<button type="submit">Continuar</button>'
            .$err
            .'</form></div></body></html>';

        return [$html, $cookie];
    }

    private function page(string $title, string $body, int $status): string
    {
        return '<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'
            .'<title>'.$title.' · UVH</title><style>'
            .'body{font-family:Manrope,Segoe UI,Arial,sans-serif;background:#F6F8FC;color:#07111F;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}'
            .'.card{background:#fff;border:1px solid #E3E8F0;border-radius:16px;padding:40px;max-width:420px;text-align:center}'
            .'h1{font-size:22px;margin:0 0 8px} p{color:#33415C;line-height:1.6;margin:0}'
            .'.brand{font-weight:800;color:#2457F5;margin-bottom:16px} .brand b{color:#00A99D}'
            .'a.btn{display:inline-block;margin-top:20px;background:#2457F5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600}'
            .'</style></head><body><div class="card"><div class="brand">UVH <b>· Enlaces cortos. Control total.</b></div>'
            .'<h1>'.htmlspecialchars($title, ENT_QUOTES, 'UTF-8').'</h1><p>'.htmlspecialchars($body, ENT_QUOTES, 'UTF-8').'</p></div></body></html>';
    }
}
