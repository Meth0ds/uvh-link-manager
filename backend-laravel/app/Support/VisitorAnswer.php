<?php

namespace App\Support;

use Illuminate\Http\JsonResponse;
use Illuminate\Http\Request;
use Illuminate\Http\Response as HtmlResponse;
use Symfony\Component\HttpFoundation\Cookie;
use Symfony\Component\HttpFoundation\Response;

/**
 * Lo que se le contesta a quien pide un enlace público, y —en el mismo sitio— a
 * un cliente que acepta JSON.
 *
 * Antes esta decisión estaba repartida: el controlador repetía
 * `wantsHtml($request)` en cada rechazo, cada copia con su mensaje en línea, y
 * el limitador `uvh-unlock` construía e imprimía la propia puerta, de modo que
 * quien editaba la pantalla tenía que saber que había código suyo dentro de la
 * definición de un rate limiter. Aquí cada desenlace tiene un solo método y sus
 * dos caras se leen juntas: qué ve un navegador y qué recibe un cliente JSON.
 * El controlador decide la admisión; el limitador declara el hecho; ninguno de
 * los dos compone el documento.
 *
 * El contrato está congelado (`docs/api.md`) y no se toca aquí: mismos códigos,
 * mismos cuerpos, mismas cabeceras (`Retry-After` y `X-RateLimit-*` viajan en
 * las dos caras) y la misma política de seguridad. Dos detalles que parecen
 * descuidos y no lo son: el sobre lleva `error` primero, porque los clientes lo
 * leen así, y la página del límite agotado **no** emite la cookie CSRF —no es
 * su función, y el formulario se repara solo en la siguiente visita— mientras
 * que la puerta sí la emite cuando falta.
 *
 * El tipo declarado es el `Response` de Symfony porque cada método devuelve una
 * página o un sobre, y ése es el único ancestro común de los dos.
 */
final class VisitorAnswer
{
    /** El enlace está protegido: se pide la contraseña. */
    public static function passwordRequired(Request $request, string $alias): Response
    {
        if (! self::wantsPage($request)) {
            return self::envelope(__('visitor.password_required'), 403, ['passwordRequired' => true]);
        }

        return self::gate($request, $alias, null, 403);
    }

    /** El formulario llegó sin un token válido: se repite la puerta. */
    public static function staleForm(Request $request, string $alias): Response
    {
        if (! self::wantsPage($request)) {
            return self::envelope(__('visitor.csrf_invalid'), 403);
        }

        return self::gate($request, $alias, __('visitor.form_expired'), 403);
    }

    /** La contraseña enviada no tiene una longitud usable. */
    public static function passwordOutOfRange(Request $request, string $alias): Response
    {
        if (! self::wantsPage($request)) {
            return self::envelope(__('visitor.password_missing'), 422);
        }

        return self::gate($request, $alias, __('visitor.password_range'), 422);
    }

    /** La contraseña no es la del enlace. */
    public static function wrongPassword(Request $request, string $alias): Response
    {
        if (! self::wantsPage($request)) {
            return self::envelope(__('visitor.wrong_password'), 403);
        }

        return self::gate($request, $alias, __('visitor.wrong_password_retry'), 403);
    }

    /**
     * La contraseña era correcta y la cookie de desbloqueo viaja en la respuesta.
     *
     * La pantalla de continuación no es un 302: el porqué está en
     * `VisitorPage::handoff()`, y es lo que arregló el rechazo de
     * `form-action 'self'`.
     */
    public static function unlocked(Request $request, string $alias, Cookie $cookie): Response
    {
        $response = self::wantsPage($request)
            ? response(VisitorPage::handoff($alias, QrAttribution::fromRequest($request)), 200)
            : response()->json(['ok' => true]);

        return $response->withCookie($cookie);
    }

    /**
     * El alias no resuelve a un enlace (o no a uno protegido). Responde lo mismo
     * desde el GET y desde el POST: el visitante que envió la contraseña justo
     * cuando el enlace se borraba tiene que ver la pantalla, no un JSON.
     */
    public static function noSuchLink(Request $request): Response
    {
        if (! self::wantsPage($request)) {
            return self::envelope(__('visitor.missing'), 404);
        }

        return self::notFound();
    }

    /** Only the explicit missing-link outcome uses the interactive 404. */
    public static function notFound(?string $brandHost = null, ?string $rootDestination = null): Response
    {
        $home = rtrim((string) config('uvh.public_origin'), '/');
        $panel = app()->environment('production')
            ? 'https://'.config('uvh.app_host')
            : rtrim((string) (config('uvh.frontend_url') ?: config('app.url')), '/');
        $root = is_string($rootDestination) && UrlUtil::validateDestination($rootDestination)['ok']
            && DestinationDenylist::reason($rootDestination) === null ? $rootDestination : null;

        return response()->view('visitor.not-found', [
            'brandHost' => $brandHost,
            'root' => $root,
            'home' => $home,
            'homeUrl' => $home.(config('uvh.localisation_enabled') ? Language::path('/') : '/'),
            'helpUrl' => $home.(config('uvh.localisation_enabled') ? Language::path('/help') : '/help'),
            'privacyUrl' => $home.(config('uvh.localisation_enabled') ? Language::path('/legal/privacidad') : '/legal/privacidad'),
            'panelUrl' => $panel.(config('uvh.localisation_enabled') ? Language::path('/app/dashboard') : '/app/dashboard'),
            'panel' => $panel,
        ], 404)->header('X-Robots-Tag', 'noindex, nofollow');
    }

    /**
     * El visitante agotó el presupuesto de intentos del enlace. Las cabeceras
     * son del limitador y viajan en las dos caras.
     *
     * @param  array<string, int>  $headers
     */
    public static function tooManyAttempts(Request $request, array $headers): Response
    {
        $message = __('visitor.too_many');

        if (! self::wantsPage($request)) {
            return self::envelope($message, 429)->withHeaders($headers);
        }

        return self::gate($request, (string) $request->route('alias'), $message.' '.__('visitor.wait_minute'), 429, mint: false)
            ->withHeaders($headers);
    }

    /**
     * Un aviso del enlace público: siempre página, nunca sobre. Un aviso no lo
     * provoca un formulario, y quien llega hasta él viene navegando.
     *
     * `$brandHost` sustituye la marca de la plataforma por el hostname: un
     * dominio con 404 «de marca» responde como suyo, no como el servicio que
     * hay detrás.
     */
    /** @param array<string, mixed>|null $button */
    public static function notice(string $title, string $body, int $status, ?string $brandHost = null, ?array $button = null): Response
    {
        return response(VisitorPage::notice($title, $body, $status, $brandHost, $button), $status);
    }

    /** Quien pide HTML está mirando la pantalla; cualquier otro es un cliente. */
    private static function wantsPage(Request $request): bool
    {
        return $request->accepts('text/html');
    }

    /**
     * El sobre JSON: `error` primero, el resto detrás.
     *
     * @param  array<string, mixed>  $extra
     */
    private static function envelope(string $message, int $status, array $extra = []): JsonResponse
    {
        return response()->json(['error' => $message] + $extra, $status);
    }

    /**
     * La puerta, con la cookie que la hace utilizable: sin token no hay
     * formulario que pueda enviarse, así que se emite en el mismo momento en que
     * se pinta y sólo si el visitante no traía uno.
     */
    private static function gate(Request $request, string $alias, ?string $error, int $status, bool $mint = true): HtmlResponse
    {
        $token = $request->cookies->get((string) config('uvh.csrf_cookie'));
        $cookie = null;
        if ($mint && (! is_string($token) || $token === '')) {
            $token = Ids::base64urlEncode(random_bytes(24));
            $cookie = new Cookie((string) config('uvh.csrf_cookie'), $token, 0, '/', null, (bool) config('uvh.cookie_secure'), false, false, 'lax');
        }

        $response = response(VisitorPage::gate($alias, (string) $token, $error, QrAttribution::fromRequest($request)), $status);

        return $cookie ? $response->withCookie($cookie) : $response;
    }
}
