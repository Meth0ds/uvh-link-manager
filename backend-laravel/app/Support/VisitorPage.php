<?php

namespace App\Support;

/**
 * El documento que ve quien abre un enlace público: la puerta con contraseña y
 * los avisos con los que un enlace puede responder.
 *
 * Es una sola clase porque es un solo documento, impreso en claro y en oscuro
 * con los tokens del producto. Antes eran dos constructores de HTML, cada uno
 * con su `<head>` y su paleta, y por eso la puerta se quedó en la identidad
 * retirada (azul eléctrico, turquesa, radio de 16px) mientras el resto del
 * producto es papel, tinta y terracota con marcos de 3px.
 *
 * Aquí no se decide nada de admisión: el alias sólo se interpola —codificado en
 * la acción del formulario y escapado en el texto—, el token CSRF se recibe ya
 * resuelto, y el estado HTTP y el contrato JSON son del controlador.
 *
 * **No se emite script, y es deliberado.** La política de contenidos del
 * producto es `script-src 'self'` con Trusted Types, así que un script en línea
 * se bloquearía; y una página servida bajo el dominio del cliente no tiene
 * ningún recurso propio del mismo origen que pedir, porque allí nginx entrega
 * sólo el shell del SPA en los hosts de primera parte. El formulario es nativo:
 * `autofocus`, Enter envía, `autocomplete="current-password"` para los gestores
 * de contraseñas, y el botón anuncia su propio estado pulsado en CSS. El estado
 * «enviando» es, por tanto, la navegación del navegador más esa señal de pulsación;
 * no se inventa un indicador que no se puede sostener.
 */
final class VisitorPage
{
    private const BRAND = 'UVH · Enlaces cortos. Control total.';

    /**
     * La puerta: pide la contraseña del enlace y, si el intento anterior falló,
     * explica por qué sin cambiar de pantalla.
     */
    public static function gate(string $alias, string $csrfToken, ?string $error = null): string
    {
        // El campo describe el aviso de error además de la ayuda: es la única
        // forma determinista de que un lector anuncie el motivo al enfocar, ya
        // que el documento llega con el error puesto y no hay script que lo
        // anuncie al aparecer.
        $describedBy = $error !== null ? 'gate-error gate-hint' : 'gate-hint';

        $body = '<main class="plate">'
            .'<p class="brand">'.self::escape(self::BRAND).'</p>'
            .'<p class="chip">'.self::icon('lock').'Acceso restringido</p>'
            .'<h1>Enlace protegido</h1>'
            .'<p class="lede">Este enlace está protegido con contraseña. Introdúcela para continuar.</p>'
            .'<form method="post" action="/r/'.rawurlencode($alias).'/unlock">'
            .'<label for="gate-password">Contraseña</label>'
            .'<input id="gate-password" name="password" type="password" autocomplete="current-password"'
            .' maxlength="72" required autofocus spellcheck="false" autocapitalize="none" enterkeyhint="go"'
            .' aria-describedby="'.$describedBy.'"'.($error !== null ? ' aria-invalid="true"' : '').'>'
            // El motivo va pegado al campo, antes de la ayuda: es lo que hay
            // que leer primero y lo que describe el propio campo.
            .($error !== null
                ? '<p class="note" id="gate-error" role="alert">'.self::escape($error).'</p>'
                : '')
            .'<p class="hint" id="gate-hint">Hasta 72 caracteres. Te la habrá compartido quien te envió el enlace.</p>'
            .'<input type="hidden" name="_csrf" value="'.self::escape($csrfToken).'">'
            .'<button type="submit"><span class="label">Continuar</span><span class="pending" aria-hidden="true">Comprobando…</span></button>'
            .'</form>'
            .'<p class="foot">Si no conoces la contraseña, pídesela a quien te envió este enlace.</p>'
            .'</main>';

        return self::document('Enlace protegido', $body);
    }

    /**
     * El acierto: la contraseña era correcta, la cookie de desbloqueo ya está
     * puesta y falta entrar al enlace.
     *
     * **No es un 302, y no por gusto.** La política de contenidos del producto
     * (`form-action 'self'`) se comprueba también en cada salto de la cadena de
     * redirecciones de un envío de formulario, y el destino de un enlace está en
     * otro origen por definición: el salto final se rechazaba y el visitante se
     * quedaba en la puerta con el desbloqueo hecho (reproducido en Chromium:
     * `Refused to send form data … "form-action 'self'"`, con el mismo flujo
     * llegando a un destino del mismo origen). Esta pantalla cierra el envío
     * dentro del propio origen y continúa con una navegación normal, que no pasa
     * por esa comprobación.
     */
    public static function handoff(string $alias): string
    {
        $target = '/r/'.rawurlencode($alias);

        $body = '<main class="plate">'
            .'<p class="brand">'.self::escape(self::BRAND).'</p>'
            .'<h1>Contraseña correcta</h1>'
            .'<p class="lede">Te llevamos al destino.</p>'
            .'<p class="handoff"><a href="'.self::escape($target).'">Continuar sin esperar</a></p>'
            .'</main>';

        // El refresco se anuncia en el propio `<head>`: sin él, esta pantalla
        // sería un callejón sin salida para quien no ve el enlace.
        return self::document(
            'Contraseña correcta',
            $body,
            '<meta http-equiv="refresh" content="0;url='.self::escape($target).'">',
        );
    }

    /**
     * Un aviso: el enlace no existe, caducó, está pausado, bloqueado o agotado.
     *
     * Sin enlaces de salida, y es deliberado: esta página se sirve también bajo
     * el dominio corto, donde `/r/*` es lo único con ruta servida —un enlace a
     * `/status` o al panel aquí sería un callejón disfrazado de ayuda—. Lo que
     * sí cabe es decirle al visitante qué puede pedir y a quién.
     */
    public static function notice(string $title, string $body, int $status = 404): string
    {
        $code = $status >= 400 ? (string) $status : null;
        $chip = $status >= 500 ? 'Incidencia del servicio' : ($status >= 400 ? 'Enlace no disponible' : 'Aviso del enlace');

        $plate = '<main class="plate">'
            .'<p class="brand">'.self::escape(self::BRAND).'</p>'
            .'<p class="chip">'.self::icon('info').self::escape($chip).'</p>'
            .($code !== null ? '<p class="ghost" aria-hidden="true">'.$code.'</p>' : '')
            .'<h1'.($code !== null ? ' class="tight"' : '').'>'.self::escape($title).'</h1>'
            .'<p class="lede">'.self::escape($body).'</p>'
            .'<p class="foot">Puedes pedir un enlace nuevo a quien te lo compartió.</p>'
            .'</main>';

        return self::document($title, $plate);
    }

    private static function document(string $title, string $body, string $head = ''): string
    {
        // El título y el cuerpo se escapan por separado: `<title>` es texto
        // crudo, así que interpolar ahí sin escapar sería una inyección aunque
        // el cuerpo ya viniera escapado.
        return '<!doctype html><html lang="es"><head><meta charset="utf-8">'
            .'<meta name="viewport" content="width=device-width,initial-scale=1">'
            .'<meta name="color-scheme" content="light dark">'
            .'<meta name="robots" content="noindex">'
            .$head
            .'<title>'.self::escape($title).' · UVH</title>'
            .'<style>'.self::styles().'</style></head><body>'.$body.'</body></html>';
    }

    /**
     * Los tokens del sistema de diseño (`frontend/src/app/core/_identity-tokens.scss`)
     * congelados aquí: esta página no comparte hoja de estilos con el panel, y
     * una paleta propia es exactamente como se perdió la identidad la última vez.
     * El par acento/tinta-sobre-acento está medido en `docs/design-system.md`.
     */
    private static function styles(): string
    {
        return <<<'CSS'
        :root{
          color-scheme:light dark;
          --paper:#f5f2e9; --raised:#fffcf5; --ink:#262821; --muted:#626357;
          --line:#cecec0; --soft:#eae7dd; --accent:#b53c20; --accent-ink:#fffaf0;
          --danger:#b12e30; --danger-soft:#f9e6df;
        }
        @media (prefers-color-scheme:dark){
          :root{--paper:#21241f; --raised:#2c3028; --ink:#f4f0e4; --muted:#b9bbae;
                --line:#4d5145; --soft:#30352b; --accent:#f79573; --accent-ink:#25251e;
                --danger:#ffb0aa; --danger-soft:#492d2a}
        }
        *,*::before,*::after{box-sizing:border-box}
        body{margin:0;min-height:100vh;display:grid;place-items:center;padding:clamp(16px,5vw,28px);
             background:var(--paper);color:var(--ink);
             font-family:Manrope,"Segoe UI",Arial,sans-serif;font-size:16px;line-height:1.6}
        .plate{width:100%;max-width:26rem;padding:28px;border:1px solid var(--line);border-radius:3px;background:var(--raised)}
        .brand{margin:0 0 20px;padding-bottom:14px;border-bottom:1px solid var(--line);color:var(--muted);
               font-family:"Courier New",monospace;font-size:10px;letter-spacing:.1em;text-transform:uppercase}
        h1{margin:0 0 8px;font-size:20px;font-weight:800;letter-spacing:-.03em}
        .lede{margin:0 0 22px;color:var(--muted);font-size:13.5px}
        label{display:block;margin-bottom:6px;color:var(--muted);font-family:"Courier New",monospace;
              font-size:10px;letter-spacing:.06em;text-transform:uppercase}
        input[type=password]{width:100%;padding:12px 14px;border:1px solid var(--line);border-radius:3px;
              background:var(--soft);color:var(--ink);font:inherit;font-size:16px}
        input[type=password]:focus{outline:2px solid var(--accent);outline-offset:1px;border-color:var(--accent)}
        .hint{margin:8px 0 0;color:var(--muted);font-size:11.5px}
        .note{margin:10px 0 0;padding:10px 12px;border-left:3px solid var(--danger);border-radius:3px;
              background:var(--danger-soft);color:var(--danger);font-size:13px}
        /* El último bloque de una placa —un aviso, que no lleva formulario— no
           deja detrás el margen de un hermano que no existe. */
        .plate > :last-child{margin-bottom:0}
        button{width:100%;min-height:48px;margin-top:20px;padding:14px 16px;border:1px solid var(--accent);
               border-radius:3px;background:var(--accent);color:var(--accent-ink);font:inherit;font-size:15px;
               font-weight:700;cursor:pointer}
        button:focus-visible{outline:2px solid var(--ink);outline-offset:2px}
        button:active{background:color-mix(in srgb,var(--accent) 88%,var(--ink))}
        .pending{display:none}
        button:active .label{display:none}
        button:active .pending{display:inline}
        .foot{margin:20px 0 0;padding-top:14px;border-top:1px solid var(--line);color:var(--muted);font-size:11.5px}
        a{color:var(--accent);text-decoration:underline;text-underline-offset:2px}
        a:focus-visible{outline:2px solid var(--accent);outline-offset:2px}
        .handoff{margin:0;font-size:13.5px}
        /* Retícula editorial compartida con las páginas de estado del panel:
           chip de estado, código fantasma decorativo y marco de acento de 3px. */
        .plate{border-top:3px solid var(--accent)}
        .chip{display:inline-flex;align-items:center;gap:8px;margin:0 0 16px;padding:5px 10px;
              border:1px solid var(--line);border-radius:3px;color:var(--muted);
              font-family:"Courier New",monospace;font-size:9.5px;letter-spacing:.12em;text-transform:uppercase}
        .ico{width:13px;height:13px;flex:0 0 auto;stroke:currentColor;fill:none;
             stroke-width:2;stroke-linecap:round;stroke-linejoin:round}
        .ghost{margin:0 0 2px;font-size:56px;line-height:.9;font-weight:800;letter-spacing:-.05em;
               color:color-mix(in srgb,var(--ink) 12%,transparent);user-select:none}
        h1.tight{margin-top:-2px}
        @media (max-width:360px){.plate{padding:20px}}
        CSS;
    }

    /**
     * Iconos en línea: esta página no carga recursos de ningún origen y un
     * icono es dibujo, no script — cabe en el documento sin abrir una petición.
     */
    private static function icon(string $name): string
    {
        $paths = [
            'lock' => '<path d="M7 10V7a5 5 0 0 1 10 0v3"/><rect x="5" y="10" width="14" height="10" rx="2"/>',
            'info' => '<circle cx="12" cy="12" r="9"/><path d="M12 7.5v5.5"/><path d="M12 16.5h.01"/>',
        ];

        return '<svg class="ico" viewBox="0 0 24 24" aria-hidden="true">'.($paths[$name] ?? '').'</svg>';
    }

    private static function escape(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES, 'UTF-8');
    }
}
