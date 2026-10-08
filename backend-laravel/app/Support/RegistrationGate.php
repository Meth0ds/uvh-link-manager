<?php

namespace App\Support;

use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\DB;

/**
 * Pausa temporal de registros nuevos, operable desde administración.
 *
 * El flag vive en `operational_settings` (clave `registration_paused`) para
 * no requerir despliegue; la lectura se cachea unos segundos y la escritura
 * la invalida en el mismo commit. Sin fila, el registro está abierto.
 * No toca el flujo de registro: solo expone el estado y su cambio auditado.
 */
final class RegistrationGate
{
    public const KEY = 'registration_paused';

    private const CACHE_KEY = 'operational:registration_paused';

    public static function cacheTtlSeconds(): int
    {
        return min(300, max(5, (int) config('uvh.operational_settings_cache_seconds', 30)));
    }

    public static function isPaused(): bool
    {
        return (bool) Cache::remember(
            self::CACHE_KEY,
            self::cacheTtlSeconds(),
            static fn (): bool => (bool) DB::table('operational_settings')->where('key', self::KEY)->value('value_bool'),
        );
    }

    /**
     * Cambia la pausa de forma atómica y auditada.
     *
     * Serializa escritores concurrentes con `lockForUpdate`, escribe la
     * auditoría en la misma transacción (sin commit no hay cambio visible) e
     * invalida la caché dentro y después del commit para que la lectura
     * posterior no sirva el valor anterior.
     */
    public static function setPaused(bool $paused, ?int $actorId, ?string $ip): bool
    {
        DB::transaction(static function () use ($paused, $actorId, $ip): void {
            $row = DB::table('operational_settings')->where('key', self::KEY)->lockForUpdate()->first();
            $now = now();
            if ($row) {
                DB::table('operational_settings')->where('key', self::KEY)->update([
                    'value_bool' => $paused,
                    'updated_by' => $actorId,
                    'updated_at' => $now,
                ]);
            } else {
                DB::table('operational_settings')->insert([
                    'key' => self::KEY,
                    'value_bool' => $paused,
                    'updated_by' => $actorId,
                    'created_at' => $now,
                    'updated_at' => $now,
                ]);
            }

            Audit::write($actorId, 'admin.registration_pause', 'operational_setting', self::KEY, ['paused' => $paused], $ip);

            Cache::forget(self::CACHE_KEY);
            DB::afterCommit(static fn (): mixed => Cache::forget(self::CACHE_KEY));
        });

        return $paused;
    }
}
