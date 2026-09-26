<?php

namespace App\Support;

use Illuminate\Database\QueryException;
use Illuminate\Support\Facades\DB;

/**
 * Claves de idempotencia para las operaciones masivas (F7).
 *
 * Una operación masiva se dispara desde un navegador: el doble clic, un
 * reintento manual o una reconexión pueden repetir exactamente la misma
 * petición, y aplicarla dos veces duplicaría el efecto. La clave que trae la
 * cabecera `Idempotency-Key` identifica la intención: la primera petición
 * reserva la clave y ejecuta; una repetición con el mismo cuerpo recibe la
 * respuesta original sin volver a aplicar nada.
 *
 * Contrato deliberado:
 *  - La clave pertenece a la cuenta que la usó y a un `scope`, y el scope
 *    lleva el workspace (`links.bulk:42`): la intención se identifica por
 *    cuenta + workspace + operación + clave. La misma clave en otro workspace
 *    no colisiona nunca —repetir una intención del workspace A dentro del
 *    workspace B no puede recibir la respuesta de A—.
 *  - Repetir la clave con un cuerpo distinto es un error del cliente (409):
 *    nunca se devuelve una respuesta calculada sobre otros datos.
 *  - Mientras la operación está en curso —el arriendo de ejecución está vivo—,
 *    una repetición concurrente recibe 409 en vez de aplicarse en paralelo.
 *  - El arriendo (`lease_until`, minutos) está separado de la ventana de
 *    replay (`expires_at`, 24 h): si el proceso muere reservado, la clave se
 *    vuelve a tomar pasado el arriendo en vez de atascarse un día entero. El
 *    `lease_token` identifica cada reserva: el sellado o la liberación de un
 *    intento jamás tocan la reserva de un intento posterior.
 *  - Si la operación falla, la reserva se libera: la misma clave puede
 *    reintentarse con la misma petición. Sólo el éxito sella la respuesta.
 *  - Las filas caducan a las 24 horas; el excedente se purga al usarse, sin
 *    depender de ningún job para no dejar basura.
 */
final class Idempotency
{
    /** Clave visible y portátil: nada que un cliente no pueda generar. */
    public const KEY_PATTERN = '/^[A-Za-z0-9._:-]{8,64}$/D';

    /** Ventana de replay: cuánto vive la respuesta sellada. */
    public const TTL_HOURS = 24;

    /**
     * Arriendo de ejecución: cuánto puede durar la operación antes de que una
     * repetición pueda tomar la reserva. Las operaciones masivas son
     * transacciones de segundos; el arriendo es un seguro contra crashes, no
     * un permiso para ejecuciones largas.
     */
    public const LEASE_MINUTES = 5;

    /** @return array{ok: bool, error?: string} */
    public static function validateKey(mixed $key): array
    {
        if (! is_string($key) || preg_match(self::KEY_PATTERN, $key) !== 1) {
            return ['ok' => false, 'error' => 'Falta una Idempotency-Key válida (8-64 caracteres: letras, dígitos, . _ : -)'];
        }

        return ['ok' => true];
    }

    /** Identidad del cuerpo de la petición: misma clave exige mismo cuerpo. */
    public static function hash(string $rawBody): string
    {
        return hash('sha256', $rawBody);
    }

    /**
     * Reserva la clave antes de ejecutar. Sólo el estado `fresh` trae el
     * `lease` con el que después se sella (`commit`) o se libera (`release`).
     *
     * @return array{state: 'fresh'|'replay'|'in_progress'|'mismatch', lease?: string, status?: int, body?: array<string, mixed>}
     */
    public static function begin(int $userId, string $scope, string $key, string $requestHash): array
    {
        DB::table('idempotency_keys')->where('expires_at', '<', now())->delete();

        $lease = Ids::randomToken(24);
        try {
            DB::table('idempotency_keys')->insert([
                'user_id' => $userId,
                'scope' => $scope,
                'key' => $key,
                'request_hash' => $requestHash,
                'lease_until' => now()->addMinutes(self::LEASE_MINUTES),
                'lease_token' => $lease,
                'expires_at' => now()->addHours(self::TTL_HOURS),
                'created_at' => now(),
            ]);
        } catch (QueryException $e) {
            if (($e->errorInfo[0] ?? null) !== '23505') {
                throw $e;
            }
            $row = DB::table('idempotency_keys')
                ->where('user_id', $userId)->where('scope', $scope)->where('key', $key)
                ->first(['request_hash', 'response_status', 'response_body']);
            if ($row === null) {
                // La operación en curso falló y liberó su reserva entre el
                // conflicto y la lectura: la clave vuelve a estar libre.
                return self::begin($userId, $scope, $key, $requestHash);
            }
            if (! hash_equals((string) $row->request_hash, $requestHash)) {
                return ['state' => 'mismatch'];
            }
            if ($row->response_status !== null) {
                return [
                    'state' => 'replay',
                    'status' => (int) $row->response_status,
                    'body' => json_decode((string) $row->response_body, true) ?? [],
                ];
            }

            // Reserva sin sellar: si su arriendo sigue vivo es una operación en
            // curso; si venció —crash entre reservar y sellar— se toma prestada
            // con un token nuevo, condicionada en SQL para que dos intentos no
            // puedan tomarla a la vez.
            $taken = DB::table('idempotency_keys')
                ->where('user_id', $userId)->where('scope', $scope)->where('key', $key)
                ->whereNull('response_status')
                ->where(fn ($q) => $q->whereNull('lease_until')->orWhere('lease_until', '<=', now()))
                ->update([
                    'request_hash' => $requestHash,
                    'lease_until' => now()->addMinutes(self::LEASE_MINUTES),
                    'lease_token' => $lease,
                ]);
            if ($taken === 1) {
                return ['state' => 'fresh', 'lease' => $lease];
            }

            return ['state' => 'in_progress'];
        }

        return ['state' => 'fresh', 'lease' => $lease];
    }

    /**
     * Sella la respuesta de una operación completada: la repetición de la
     * misma petición la recibirá tal cual sin volver a aplicar nada. Sólo el
     * poseedor del arriendo actual sella: el sellado de un intento cuya
     * reserva fue tomada es un no-op, nunca una respuesta ajena.
     *
     * @param  array<string, mixed>  $body
     */
    public static function commit(int $userId, string $scope, string $key, string $requestHash, int $status, array $body, string $lease): void
    {
        DB::table('idempotency_keys')
            ->where('user_id', $userId)->where('scope', $scope)->where('key', $key)
            ->where('request_hash', $requestHash)
            ->where('lease_token', $lease)
            ->update(['response_status' => $status, 'response_body' => json_encode($body, JSON_UNESCAPED_UNICODE)]);
    }

    /**
     * Libera la reserva de una operación fallida para que la clave sea
     * reutilizable. Con el token del arriendo: un proceso viejo que despierta
     * tarde no puede liberar la reserva de otro intento en marcha.
     */
    public static function release(int $userId, string $scope, string $key, string $lease): void
    {
        DB::table('idempotency_keys')
            ->where('user_id', $userId)->where('scope', $scope)->where('key', $key)
            ->where('lease_token', $lease)
            ->whereNull('response_status')
            ->delete();
    }
}
