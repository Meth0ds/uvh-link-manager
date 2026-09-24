<?php

namespace App\Support;

use App\Models\User;
use Illuminate\Http\Request;
use Symfony\Component\HttpFoundation\Cookie;

/**
 * El secreto que acredita la autoría de un registro sin verificar.
 *
 * Un `register` anónimo crea una fila pendiente y deja una contraseña que
 * `verifyEmail` ya no acepta como credencial activa: la decide quien abre el
 * buzón. Esa contraseña, sin embargo, seguía siendo la única prueba que
 * `changeRegistrationEmail` pedía para mover el registro a otra dirección —y
 * cualquier anónimo puede fabricar una registrándose—, de modo que un tercero
 * podía apuntar una inscripción ajena a su propio buzón. Este secreto sustituye
 * esa prueba: se emite al navegador que creó la fila, no viaja a ninguna otra
 * parte, y no se deduce de nada que el atacante pueda escribir.
 *
 * Lo que se firma es una *afirmación* (`uid` + `security_version`), no un bearer
 * con fila detrás. La fila ya existe: es el `User` pendiente, y el testigo sólo
 * tiene que decir cuál y acreditar que sigue siendo el mismo. Por eso no hay
 * tabla nueva ni `email_tokens`: la validez se comprueba contra el estado vivo
 * de la cuenta (`email_verified_at` nulo y la versión de seguridad que el
 * payload reclama), y rotar esa versión en cada corrección convierte el secreto
 * gastado en texto inservible sin necesidad de revocarlo.
 *
 * Tres decisiones que parecen detalles y no lo son:
 *
 *  - **Ancho fijo.** El payload se firma, pero no se cifra: cualquiera puede
 *    leerlo. Por eso `uid` y `sv` se escriben con ancho fijo — si el tamaño de
 *    la cookie dependiera del id, la respuesta de un registro real y la de una
 *    dirección ocupada se distinguirían midiendo, que es la enumeración que todo
 *    `register` evita.
 *  - **Señuelo para el desenlace sin fila.** La cookie se emite en TODOS los
 *    desenlaces de `register`, con la misma forma y los mismos atributos. En los
 *    que no hay cuenta que acreditar lleva una afirmación que no autoriza nada
 *    (`decoy()`), con valores del mismo rango que los reales: un `Set-Cookie`
 *    que sólo aparece cuando el destino estaba libre sería el oráculo que el
 *    cuerpo idéntico de la respuesta ya cierra.
 *  - **Una sola definición de la cookie.** Los atributos salen de
 *    `HostOnlyCookie`, la misma que aparca un bearer de invitación.
 */
final class RegistrationEdit
{
    /** Identifica la forma del payload, para que un cambio futuro sea explícito. */
    private const PAYLOAD_VERSION = 1;

    /**
     * `uid` con diez dígitos y `sv` con tres, siempre. El patrón es la
     * definición de la forma: lo que no case no es un secreto de este
     * despliegue, y no hay razón para intentar interpretarlo.
     */
    private const CLAIM_PATTERN = '/^\{"v":1,"uid":"[0-9]{10}","sv":"[0-9]{3}"\}$/D';

    public static function cookieName(): string
    {
        return (string) config('uvh.registration_edit_cookie');
    }

    public static function ttlSeconds(): int
    {
        return max(60, (int) config('uvh.registration_edit_ttl_hours') * 3600);
    }

    /**
     * The secret of one account at one credential generation.
     *
     * A fresh registration and a correction that rotated the row both come
     * through here: the generation is the argument, never something this class
     * guesses, so a caller cannot seal a stale version by accident.
     */
    public static function secret(int $userId, int $securityVersion): Cookie
    {
        return self::seal($userId, $securityVersion);
    }

    /**
     * El secreto de un desenlace que no creó ninguna cuenta.
     *
     * Mismo tamaño, mismos atributos y valores del mismo orden de magnitud que
     * uno real; lo único distinto es que no autoriza nada, porque no hay fila
     * pendiente con ese id y esa versión.
     */
    public static function decoy(): Cookie
    {
        return self::seal(random_int(1, 999_999_999), 1);
    }

    /** El secreto ya gastado, para no dejar al navegador sosteniendo algo inútil. */
    public static function clearCookie(): Cookie
    {
        return HostOnlyCookie::make(self::cookieName(), '', time() - 3600);
    }

    /**
     * Whether this request may edit THIS pending registration.
     *
     * Every way of being wrong —absent, empty, tampered, expired, another
     * deployment's payload, another account's id, a version the row no longer
     * has— returns the same false, so the caller cannot tell them apart either.
     */
    public static function authorizes(Request $request, User $user): bool
    {
        $claim = self::claim($request);

        return $claim !== null
            && $claim['uid'] === (int) $user->id
            && $claim['sv'] === (int) $user->security_version;
    }

    private static function seal(int $userId, int $securityVersion): Cookie
    {
        $ttl = self::ttlSeconds();
        // `sv` se trunca a tres dígitos y no se recorta hacia arriba en la
        // lectura: si alguna vez llegara a cuatro, el patrón rechaza el secreto
        // (la corrección deja de autorizarse) en vez de autorizar la versión
        // equivocada. Hoy la versión avanza de uno en uno desde 1.
        $payload = sprintf(
            '{"v":%d,"uid":"%010d","sv":"%03d"}',
            self::PAYLOAD_VERSION,
            $userId,
            min(999, max(0, $securityVersion)),
        );

        return HostOnlyCookie::make(
            self::cookieName(),
            SignedToken::sign($payload, $ttl * 1000),
            time() + $ttl,
        );
    }

    /** @return array{uid: int, sv: int}|null */
    private static function claim(Request $request): ?array
    {
        $value = $request->cookies->get(self::cookieName());
        if (! is_string($value) || $value === '') {
            return null;
        }

        $claim = SignedToken::verify($value, function (string $payload): ?array {
            if (preg_match(self::CLAIM_PATTERN, $payload) !== 1) {
                return null;
            }
            $decoded = json_decode($payload, true);
            if (! is_array($decoded) || ! is_string($decoded['uid'] ?? null) || ! is_string($decoded['sv'] ?? null)) {
                return null;
            }

            return ['uid' => (int) $decoded['uid'], 'sv' => (int) $decoded['sv']];
        });

        if (! is_array($claim) || ! is_int($claim['uid'] ?? null) || ! is_int($claim['sv'] ?? null)) {
            return null;
        }

        return ['uid' => $claim['uid'], 'sv' => $claim['sv']];
    }
}
