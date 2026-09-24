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
 * Lo que se sella es una *afirmación* (`uid` + `security_version`), no un
 * bearer con fila detrás. La fila ya existe: es el `User` pendiente, y el
 * testigo sólo tiene que decir cuál y acreditar que sigue siendo el mismo. Por
 * eso no hay tabla nueva ni `email_tokens`: la validez se comprueba contra el
 * estado vivo de la cuenta (`email_verified_at` nulo y la versión de seguridad
 * que el claim reclama), y rotar esa versión en cada corrección convierte el
 * secreto gastado en texto inservible sin necesidad de revocarlo.
 *
 * La afirmación va **cifrada con cifrado autenticado** (`SealedToken`), y eso
 * no es un detalle: la primera versión firmaba sin cifrar, y un payload
 * legible convertía la cookie en un oráculo de enumeración. El uid real de un
 * registro pendiente es pequeño y secuencial mientras que el de un señuelo era
 * un aleatorio enorme; un cliente HTTP propio decodificaba el `Set-Cookie` y
 * distinguía estadísticamente destinos libres de ocupados, exactamente lo que
 * el cuerpo idéntico de `register` evita. `HttpOnly` no ayuda frente a ese
 * atacante: sólo impide que JavaScript de la página lea la cookie.
 *
 * Tres decisiones que parecen detalles y no lo son:
 *
 *  - **Opacidad total.** Ni uid, ni versión, ni expiración, ni siquiera la
 *    rama real/señuelo son observables: externamente sólo hay un blob base64url
 *    de longitud fija. No hace falta fabricar uid falsos «más realistas» porque
 *    no se ve ninguno.
 *  - **Ancho fijo.** El claim se escribe con anchos fijos (`uid` diez dígitos,
 *    `sv` tres, expiración trece) para que un registro real y un señuelo
 *    sellen textos planos del mismo largo y produzcan ciphertexts
 *    indistinguibles incluso midiendo bytes.
 *  - **Señuelo para el desenlace sin fila.** La cookie se emite en TODOS los
 *    desenlaces de `register`, con la misma forma y los mismos atributos. En
 *    los que no hay cuenta que acreditar lleva una afirmación que no autoriza
 *    nada (`decoy()`): un `Set-Cookie` que sólo aparece cuando el destino
 *    estaba libre sería el oráculo que el cuerpo idéntico de la respuesta ya
 *    cierra.
 *
 * Y una obligación del llamante que este sello no puede imponer: la afirmación
 * sólo vale **revalidada contra la fila bloqueada**, dentro de la sección
 * crítica que rota la versión de seguridad. Validar antes del lock deja la
 * ventana clásica de TOCTOU —dos peticiones con el mismo secreto gastándolo
 * dos veces— y `changeRegistrationEmail` lo hace así.
 *
 * Una sola definición de la cookie: los atributos salen de `HostOnlyCookie`, la
 * misma que aparca un bearer de invitación.
 */
final class RegistrationEdit
{
    /** Identifica la forma del claim, para que un cambio futuro sea explícito. */
    private const PAYLOAD_VERSION = 1;

    /**
     * Forma del claim: `{"e":<13>,"v":1,"uid":"<10>","sv":"<3>"}`. Los anchos
     * fijos son la definición de la forma: lo que no case no es un secreto de
     * este despliegue, y no hay razón para intentar interpretarlo. (La
     * autenticación ya la garantiza el sello; el patrón documenta la forma y
     * acota el trabajo de parseo.)
     */
    private const CLAIM_PATTERN = '/^\{"e":[0-9]{13},"v":1,"uid":"[0-9]{10}","sv":"[0-9]{3}"\}$/D';

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
     * Longitud idéntica a uno real y atributos idénticos; lo único distinto es
     * que no autoriza nada, porque no hay fila pendiente con ese id y esa
     * versión. Sus valores son indistinguibles de los reales porque ninguno de
     * los dos es legible fuera del servidor.
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
     * deployment's keyring, another account's id, a version the row no longer
     * has— returns the same false, so the caller cannot tell them apart either.
     *
     * OJO con el sitio desde el que se llama: esta comprobación debe repetirse
     * contra la fila YA BLOQUEADA, dentro de la transacción que rota la
     * versión. Vale como rechazo temprano barato; la autoridad es la del lock.
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
        // equivocada. Hoy la versión avanza de uno en uno desde 1. La
        // expiración vive dentro del claim —y por tanto dentro de la tag de
        // autenticación— con trece dígitos de milisegundos, que alcanzan hasta
        // el año 2286.
        $claim = sprintf(
            '{"e":%013d,"v":%d,"uid":"%010d","sv":"%03d"}',
            (int) (microtime(true) * 1000) + ($ttl * 1000),
            self::PAYLOAD_VERSION,
            $userId,
            min(999, max(0, $securityVersion)),
        );

        return HostOnlyCookie::make(
            self::cookieName(),
            SealedToken::seal($claim),
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

        $plain = SealedToken::open($value);
        if ($plain === null || preg_match(self::CLAIM_PATTERN, $plain) !== 1) {
            return null;
        }
        $decoded = json_decode($plain, true);
        if (! is_array($decoded) || ! is_int($decoded['e'] ?? null) || ! is_string($decoded['uid'] ?? null) || ! is_string($decoded['sv'] ?? null)) {
            return null;
        }
        if ($decoded['e'] < (int) (microtime(true) * 1000)) {
            return null;
        }

        return ['uid' => (int) $decoded['uid'], 'sv' => (int) $decoded['sv']];
    }
}
