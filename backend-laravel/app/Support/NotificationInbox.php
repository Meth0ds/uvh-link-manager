<?php

namespace App\Support;

use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;

/**
 * La bandeja durable del centro de notificaciones: un registro por evento,
 * deduplicado por identidad lógica y gobernado por las preferencias del
 * usuario.
 *
 * `record()` decide y registra; no envía nada. Devuelve la entrega decidida
 * para que el productor sepa si además debe mandar su email en el momento,
 * aplazarlo al resumen diario o no mandar nada. Un kind desconocido se
 * rechaza en silencio administrativo (quedan métrica y log): prefiere no
 * registrar antes que inventar un aviso que ninguna pantalla presentaría.
 */
final class NotificationInbox
{
    /**
     * Registra un evento en la bandeja de una cuenta.
     *
     * @param  int  $userId  la cuenta cuya bandeja recibe el aviso
     * @param  string  $kind  un kind del catálogo
     * @param  ?int  $workspaceId  el workspace implicado, si el kind lo es
     * @param  ?string  $subject  nombre visible capturado en el momento (workspace,
     *                            alias), nunca secretos, URLs bearer ni contenido de correo
     * @param  ?string  $dedupeKey  identidad lógica del evento; null = evento
     *                              singular. Con clave, el registro es idempotente por cuenta.
     * @param  ?string  $route  ruta interna del panel; null = la del catálogo
     * @return ?string la entrega decidida (`immediate|daily_digest|in_app_only`)
     *                 o null si el evento no se registra (kind desconocido u operativo
     *                 desactivado).
     */
    public static function record(
        int $userId,
        string $kind,
        ?int $workspaceId = null,
        ?string $subject = null,
        ?string $dedupeKey = null,
        ?string $route = null,
    ): ?string {
        if (! NotificationKinds::exists($kind)) {
            Log::warning('[notifications] unknown kind rejected', ['kind' => $kind]);

            return null;
        }

        if ($workspaceId !== null && ! NotificationKinds::isWorkspaceScoped($kind)) {
            Log::warning('[notifications] workspace scope rejected for account kind', ['kind' => $kind]);

            return null;
        }

        $delivery = NotificationPreferences::deliveryFor($userId, $kind);
        if ($delivery === NotificationPreferences::DELIVERY_DISABLED) {
            return null;
        }

        $digestible = $delivery === NotificationPreferences::DELIVERY_DAILY_DIGEST;

        DB::table('notifications')->insertOrIgnore([
            'user_id' => $userId,
            'workspace_id' => $workspaceId,
            'kind' => $kind,
            'subject' => $subject !== null ? mb_substr($subject, 0, 120) : null,
            'dedupe_key' => $dedupeKey !== null ? mb_substr($dedupeKey, 0, 160) : null,
            'route' => $route ?? NotificationKinds::route($kind),
            'created_at' => now(),
            'read_at' => null,
            // Lo que no es candidato a resumen se sella ya: el comando de
            // resumen mira sólo lo nulo y no puede arrastrar entregas viejas.
            'digested_at' => $digestible ? null : now(),
        ]);

        return $delivery;
    }

    /** Cuántos avisos sin leer tiene la cuenta. */
    public static function unreadCount(int $userId): int
    {
        return (int) DB::table('notifications')
            ->where('user_id', $userId)
            ->whereNull('read_at')
            ->count();
    }
}
