<?php

namespace App\Http\Controllers;

use App\Http\Middleware\UvhCsrf;
use App\Models\Link;
use App\Support\RedirectService;
use App\Support\SignedToken;
use App\Support\UrlUtil;
use App\Support\VisitorAnswer;
use Illuminate\Http\Request;
use Illuminate\Http\Response;
use Illuminate\Support\Facades\DB;
use Symfony\Component\HttpFoundation\BinaryFileResponse;
use Symfony\Component\HttpFoundation\Cookie;

final class AppOpeningController
{
    public function launch(Request $request, string $alias): \Symfony\Component\HttpFoundation\Response
    {
        abort_unless(config('app_links.native'), 404);
        $domain = RedirectService::resolveDomainId($request->getHost());
        $link = is_int($domain) && $domain > 0 ? Link::where('domain_id', $domain)->whereRaw('lower(alias) = ?', [UrlUtil::normalizeAlias($alias)])->first() : null;
        abort_unless($link && ($link->app_opening['kind'] ?? '') === 'native', 404);
        $request->attributes->set('uvh.native_profile', $link->app_opening['profileId']);
        if ($request->query('handoff') === '1') {
            // The fragment holds the grant, never a query string. This bridge
            // cannot admit a new visit and cannot recursively attempt app launch.
            $domain = RedirectService::resolveDomainId($request->getHost());
            $profile = is_int($domain) && $domain > 0 ? DB::table('app_link_profiles')->where('domain_id', $domain)->where('enabled', true)->first() : null;
            abort_unless($profile !== null, 404);

            return response()->view('app-opening-bridge', ['profileId' => $profile->public_id])->header('Cache-Control', 'no-store')->header('X-Robots-Tag', 'noindex, nofollow');
        }

        return app(RedirectController::class)->resolve($request, $alias);
    }

    /** @param array<string, mixed> $ctx
     * @param  array<string, mixed>  $outcome
     */
    public function page(Request $request, string $alias, array $ctx, array $outcome): \Symfony\Component\HttpFoundation\Response
    {
        return app(UvhCsrf::class)->handle($request, function (Request $request) use ($alias, $ctx, $outcome) {
            $native = ($outcome['app']['kind'] ?? '') === 'native';
            $launch = null;
            if ($native) {
                $launch = 'https://'.RedirectService::canonicalHost($ctx['host']).'/a/'.rawurlencode($alias).'?handoff=1';
                if (! empty($ctx['qr_public_id'])) {
                    $launch .= '&qr='.rawurlencode($ctx['qr_public_id']);
                }
                $launch .= '#grant='.rawurlencode($outcome['grant']);
            }

            $response = response()->view('app-opening', ['webPreparedUrl' => '/app-links/continue/'.$outcome['admission_id'].'/web?'.http_build_query(['alias' => $alias, 'qr' => $ctx['qr_public_id'] ?? null], '', '&', PHP_QUERY_RFC3986), 'label' => $outcome['app']['label'], 'preparedUrl' => '/app-links/continue/'.$outcome['admission_id'].'/app?'.http_build_query(['alias' => $alias, 'qr' => $ctx['qr_public_id'] ?? null], '', '&', PHP_QUERY_RFC3986), 'nativeUrl' => $launch])->header('Cache-Control', 'no-store')->header('X-Robots-Tag', 'noindex, nofollow');
            $response->headers->setCookie(new Cookie('uvh_app_continue', $outcome['grant'], time() + 300, '/app-links/continue/'.$outcome['admission_id'], null, (bool) config('uvh.cookie_secure'), true, false, 'lax'));

            return $response;
        });
    }

    public function prepared(Request $request, string $id, string $choice): \Symfony\Component\HttpFoundation\Response
    {
        $grant = $request->cookie('uvh_app_continue');
        $claims = is_string($grant) ? SignedToken::verify($grant, fn ($v) => json_decode($v, true)) : null;
        if (! is_array($claims) || ($claims['purpose'] ?? '') !== 'app-admission' || ($claims['id'] ?? '') !== $id) {
            return VisitorAnswer::notice('El acceso ha caducado', 'Vuelve a abrir el enlace original para continuar.', 404);
        }
        $request->merge(['grant' => $grant, 'alias' => $request->query('alias'), 'choice' => $choice]);

        return $this->continue($request);
    }

    public function continue(Request $request): \Symfony\Component\HttpFoundation\Response
    {
        if (! in_array($request->input('choice'), ['app', 'web'], true) || ! is_string($request->input('alias')) || ! is_string($request->input('grant')) || strlen($request->input('grant')) > 4096) {
            abort(422);
        }
        $ctx = app(RedirectController::class)->context($request, $request->input('alias'));
        $ctx['app_grant'] = $request->input('grant');
        $outcome = RedirectService::resolve($ctx);
        if (! in_array($outcome['kind'], ['redirect', 'app_opening'], true) || empty($outcome['grant'])) {
            return VisitorAnswer::notice('El acceso ya no está disponible', 'Vuelve a abrir el enlace para comprobar su disponibilidad.', 404);
        }
        $url = $outcome['location'];
        if ($request->input('choice') === 'app' && ($outcome['app']['kind'] ?? '') === 'provider') {
            $url = $outcome['app']['url'];
        }

        return redirect()->away($url, 303)->header('Cache-Control', 'no-store')->header('Referrer-Policy', 'no-referrer');
    }

    public function font(string $weight): BinaryFileResponse
    {
        abort_unless(in_array($weight, ['400', '600'], true), 404);

        return response()->file(resource_path('fonts/app-links/manrope-'.$weight.'.woff2'), ['Content-Type' => 'font/woff2', 'Cache-Control' => 'public, max-age=86400']);
    }

    public function bridgeScript(): Response
    {
        return response(file_get_contents(resource_path('js/app-opening-bridge.js')), 200, ['Content-Type' => 'text/javascript; charset=UTF-8', 'Cache-Control' => 'no-store']);
    }
}
