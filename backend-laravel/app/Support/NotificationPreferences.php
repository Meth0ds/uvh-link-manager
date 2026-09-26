<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;

/**
 * Preferencias de aviso del centro de notificaciones.
 *
 * Sólo los kinds operativos son configurables; los obligatorios —credenciales,
 * MFA, email, exportación y eliminación de cuenta— ignoran cualquier
 * preferencia y no aceptan cambios: un usuario no puede silenciar un aviso
 * crítico de su propia cuenta.
 *
 * Las entregas posibles para un kind operativo:
 *  - `immediate` — a la bandeja y por email en el momento.
 *  - `daily_digest` — a la bandeja ya; por email, en el resumen diario.
 *  - `in_app_only` — sólo a la bandeja («Solo UVH»).
 *  - `disabled` — nada: ni fila ni email.
 *
 * La ausencia de fila es `immediate`: el producto sin preferencias expresa el
 * comportamiento de siempre.
 */
final class NotificationPreferences
{
    public const DELIVERY_IMMEDIATE = 'immediate';

    public const DELIVERY_DAILY_DIGEST = 'daily_digest';

    public const DELIVERY_IN_APP_ONLY = 'in_app_only';

    public const DELIVERY_DISABLED = 'disabled';

    public const DELIVERIES = [
        self::DELIVERY_IMMEDIATE,
        self::DELIVERY_DAILY_DIGEST,
        self::DELIVERY_IN_APP_ONLY,
        self::DELIVERY_DISABLED,
    ];

    /** La entrega efectiva de un kind para una cuenta. */
    public static function deliveryFor(int $userId, string $kind): string
    {
        if (NotificationKinds::isMandatory($kind)) {
            return self::DELIVERY_IMMEDIATE;
        }

        $stored = DB::table('notification_preferences')
            ->where('user_id', $userId)
            ->where('kind', $kind)
            ->value('delivery');

        return is_string($stored) && in_array($stored, self::DELIVERIES, true)
            ? $stored
            : self::DELIVERY_IMMEDIATE;
    }

    /**
     * ¿Sale también email en el momento para este kind?
     *
     * Los obligatorios siempre; los operativos sólo con entrega `immediate`.
     * El resumen diario y «Solo UVH» aplazan o suprimen el correo, pero nunca
     * la fila de la bandeja.
     */
    public static function wantsMail(int $userId, string $kind): bool
    {
        return self::deliveryFor($userId, $kind) === self::DELIVERY_IMMEDIATE;
    }

    /**
     * Aplica cambios de preferencia, validando el lote entero antes de
     * escribir nada: o cambia lo pedido o no cambia nada.
     *     * El lote llega de la red y se trata como no confiable: cada clave y cada
     * valor se validan en runtime aunque los tipos digan string.
     *
     * @param  array<array-key, mixed>  $changes  kind => delivery
     * @return array<string, string> los cambios aplicados
     *
     * @throws \InvalidArgumentException ante kind desconocido, kind obligatorio
     *                                   o entrega fuera del catálogo.
     */
    public static function update(int $userId, array $changes, ?string $ip = null): array
    {
        $applied = [];
        foreach ($changes as $kind => $delivery) {
            if (! is_string($kind) || ! NotificationKinds::exists($kind)) {
                throw new \InvalidArgumentException('kind desconocido');
            }
            if (NotificationKinds::isMandatory($kind)) {
                throw new \InvalidArgumentException('un aviso obligatorio no es configurable');
            }
            if (! is_string($delivery) || ! in_array($delivery, self::DELIVERIES, true)) {
                throw new \InvalidArgumentException('entrega inválida');
            }
            $applied[$kind] = $delivery;
        }

        foreach ($applied as $kind => $delivery) {
            DB::table('notification_preferences')->updateOrInsert(
                ['user_id' => $userId, 'kind' => $kind],
                ['delivery' => $delivery, 'updated_at' => now()],
            );
            // Cambiar de idea retira del resumen lo pendiente del kind: sólo
            // puede ir al correo del resumen lo que hoy sigue siendo
            // `daily_digest`. Lo ya mandado no se toca; lo futuro obedece la
            // entrega nueva.
            if ($delivery !== self::DELIVERY_DAILY_DIGEST) {
                DB::table('notifications')
                    ->where('user_id', $userId)
                    ->where('kind', $kind)
                    ->whereNull('digested_at')
                    ->update(['digested_at' => now()]);
            }
        }

        if ($applied !== []) {
            Audit::write($userId, 'account.notification_preferences_updated', 'account', $userId, [
                'kinds' => array_keys($applied),
            ], $ip);
        }

        return $applied;
    }
}
