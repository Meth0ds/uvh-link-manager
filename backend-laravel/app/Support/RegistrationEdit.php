<?php

namespace App\Support;

use App\Models\PendingRegistration;
use App\Models\RegistrationAttempt;
use Illuminate\Http\Request;
use Illuminate\Support\Carbon;
use Symfony\Component\HttpFoundation\Cookie;

/**
 * Opaque browser authority for one registration attempt at one generation.
 * v4 names registration_attempts; v2/v3 name the legacy pending namespace.
 * Every registration outcome now receives a durable context, so subsequent
 * login/correction responses cannot distinguish mailbox occupancy. Neither
 * namespace proves mailbox ownership or grants account/session authority.
 * Always revalidate the claim against the locked context before mutation.
 */
final class RegistrationEdit
{
    /** Identifica la forma del claim, para que un cambio futuro sea explícito. */
    private const PAYLOAD_VERSION = 3;

    /**
     * Forma del claim: `{"e":<13>,"v":3,"pid":"<19>","sv":"<10>"}`. Los anchos
     * fijos son la definición de la forma: lo que no case no es un secreto de
     * este despliegue, y no hay razón para intentar interpretarlo. (La
     * autenticación ya la garantiza el sello; el patrón documenta la forma y
     * acota el trabajo de parseo.) La v1 nombraba la fila de usuario que el
     * modelo anterior creaba en el primer paso; la v2 nombra el registro
     * pendiente, que es lo único que existe antes del buzón. La v3 cubre los
     * rangos bigint/integer de la tabla sin recortar ID ni generación; la v2
     * previamente emitida sigue validándose hasta su caducidad original.
     */
    private const CLAIM_PATTERN = '/^\{"e":[0-9]{13},"v":[34],"pid":"[0-9]{19}","sv":"[0-9]{10}"\}$/D';

    private const PREVIOUS_CLAIM_PATTERN = '/^\{"e":[0-9]{13},"v":2,"pid":"[0-9]{10}","sv":"[0-9]{3}"\}$/D';

    public static function cookieName(): string
    {
        return (string) config('uvh.registration_edit_cookie');
    }

    public static function ttlSeconds(): int
    {
        return max(60, (int) config('uvh.registration_edit_ttl_hours') * 3600);
    }

    /** Legacy v3 issuer retained for compatibility fixtures; HTTP emits v4. */
    public static function secret(int $registrationId, int $securityVersion): Cookie
    {
        return self::seal($registrationId, $securityVersion);
    }

    /** Legacy decoy: no pending authority; upgraded to its own virtual context. */
    public static function decoy(): Cookie
    {
        return self::seal(0, 0);
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
     * deployment's keyring, another registration's id, a version the row no
     * longer has— returns the same false, so the caller cannot tell them apart
     * either.
     *
     * OJO con el sitio desde el que se llama: esta comprobación debe repetirse
     * contra la fila YA BLOQUEADA, dentro de la transacción que rota la
     * versión. Vale como rechazo temprano barato; la autoridad es la del lock.
     */
    public static function authorizes(Request $request, PendingRegistration $registration): bool
    {
        $claim = self::claim($request);

        return $claim !== null
            && $claim['v'] < 4
            && $claim['pid'] === (int) $registration->id
            && $claim['sv'] === (int) $registration->security_version;
    }

    /** Use the stored deadline, not a second independent clock sample. */
    public static function forAttempt(RegistrationAttempt $attempt): Cookie
    {
        $deadline = $attempt->expires_at->getTimestampMs();
        $plain = sprintf('{"e":%013d,"v":4,"pid":"%019d","sv":"%010d"}', $deadline, (int) $attempt->id, (int) $attempt->security_version);

        return HostOnlyCookie::make(self::cookieName(), SealedToken::seal($plain), intdiv($deadline, 1000));
    }

    public static function deadline(): Carbon
    {
        return Carbon::createFromTimestampMs((int) (microtime(true) * 1000) + self::ttlSeconds() * 1000);
    }

    public static function authorizesAttempt(Request $request, RegistrationAttempt $attempt): bool
    {
        $claim = self::claim($request);
        if ($claim === null || $attempt->expires_at->getTimestampMs() <= (int) (microtime(true) * 1000)) {
            return false;
        }
        if ($claim['v'] === 4) {
            return $claim['pid'] === (int) $attempt->id
                && $claim['sv'] === (int) $attempt->security_version
                && $claim['e'] === $attempt->expires_at->getTimestampMs();
        }
        if ($attempt->legacy_consumed_at !== null) {
            return false;
        }

        return $claim['pid'] > 0
            ? $claim['pid'] === $attempt->legacy_pending_id && $claim['sv'] === $attempt->legacy_security_version
            : $claim['sv'] === 0 && is_string($attempt->legacy_claim_hash) && hash_equals($attempt->legacy_claim_hash, $claim['digest']);
    }

    private static function seal(int $registrationId, int $securityVersion): Cookie
    {
        $ttl = self::ttlSeconds();
        // Los anchos cubren bigint e integer completos de PostgreSQL. No
        // recortar la generación: sellar 999 para una fila en 1000 deja al
        // navegador sin autoridad después de una corrección válida.
        // La expiración vive dentro del claim —y por tanto dentro de la tag de
        // autenticación— con trece dígitos de milisegundos, que alcanzan hasta
        // el año 2286.
        $claim = sprintf(
            '{"e":%013d,"v":%d,"pid":"%019d","sv":"%010d"}',
            (int) (microtime(true) * 1000) + ($ttl * 1000),
            self::PAYLOAD_VERSION,
            $registrationId,
            $securityVersion,
        );

        return HostOnlyCookie::make(
            self::cookieName(),
            SealedToken::seal($claim),
            time() + $ttl,
        );
    }

    /** @return array{pid: int, sv: int, v: int, e: int, digest: string}|null */
    public static function claim(Request $request): ?array
    {
        $value = $request->cookies->get(self::cookieName());
        if (! is_string($value) || $value === '') {
            return null;
        }

        $legacy = null;
        $plain = SealedToken::open($value, $legacy);
        if ($plain === null || (preg_match(self::CLAIM_PATTERN, $plain) !== 1
            && preg_match(self::PREVIOUS_CLAIM_PATTERN, $plain) !== 1)) {
            return null;
        }
        $decoded = json_decode($plain, true);
        if (! is_array($decoded) || ! is_int($decoded['e'] ?? null) || ! is_string($decoded['pid'] ?? null) || ! is_string($decoded['sv'] ?? null)) {
            return null;
        }
        if ($decoded['e'] <= (int) (microtime(true) * 1000)) {
            return null;
        }

        // Parsing a nineteen-digit string by cast can saturate at PHP_INT_MAX.
        // Refuse out-of-range authentic claims instead of binding them to a
        // different row. Strip only the fixed-width padding before validation.
        $pid = filter_var(ltrim($decoded['pid'], '0') ?: '0', FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => PHP_INT_MAX]]);
        $sv = filter_var(ltrim($decoded['sv'], '0') ?: '0', FILTER_VALIDATE_INT, ['options' => ['min_range' => 0, 'max_range' => 2_147_483_647]]);
        if (! is_int($pid) || ! is_int($sv)) {
            return null;
        }

        if ($legacy === true) {
            // Un sello legacy que además pasa la validación semántica del
            // claim (patrón y expiración): la prueba de que seguía vivo y
            // sirviendo, que es lo que mide la ventana de retirada del
            // fallback. Emitir al abrir contaría también sellos auténticos
            // caducados, que ya no autorizan nada.
            SealFormatTelemetry::legacyOpened('sealed');
        }

        return ['pid' => $pid, 'sv' => $sv, 'v' => (int) $decoded['v'], 'e' => $decoded['e'], 'digest' => hash('sha256', $value)];
    }
}
