<?php

namespace App\Support;

use Symfony\Component\HttpFoundation\Cookie;

/**
 * La política de cookie de un valor que sólo sirve en el origen que lo emite.
 *
 * Existe para que esa política tenga un solo dueño. Un bearer aparcado
 * (`PendingHandoff`) y el secreto que acredita la autoría de un registro
 * (`RegistrationEdit`) son cosas distintas, pero la cookie que los lleva tiene
 * que ser la misma cosa: host-only, `HttpOnly`, `SameSite=Lax`, `Path=/` y
 * `Secure` según el despliegue. Escribir esos cinco argumentos dos veces es cómo
 * una de las dos copias se queda sin `HttpOnly` el día que alguien toca la otra.
 *
 * Lo que esta política NO es: la de la cookie de sesión. Aquella puede llevar
 * `cookie_domain` porque su alcance lo decide el despliegue; estos valores sólo
 * valen para el host que los emitió y por eso nunca lo llevan. Host-only no es
 * una preferencia estética: una cookie que un host hermano puede leer o falsear
 * es una cookie que un host hermano puede usar.
 */
final class HostOnlyCookie
{
    public static function make(string $name, string $value, int $expires): Cookie
    {
        return new Cookie(
            $name,
            $value,
            $expires,
            '/',
            // Host-only por construcción: la ausencia de `Domain` es la regla.
            null,
            (bool) config('uvh.cookie_secure'),
            true,       // httpOnly: el valor nunca es asunto del script
            false,      // raw
            'lax',
        );
    }
}
