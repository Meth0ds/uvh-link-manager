<?php

namespace App\Console\Commands;

use App\Support\IsoDate;
use App\Support\NotificationKinds;
use App\Support\NotificationPreferences;
use App\Support\UvhMail;
use Illuminate\Console\Command;
use Illuminate\Support\Facades\DB;

/**
 * El resumen diario de notificaciones: un solo correo por cuenta con los avisos
 * operativos que su autor eligió acumular («Resumen diario»).
 *
 * La bandeja ya tiene cada aviso desde el momento del evento; el resumen sólo
 * decide el canal de correo. Una fila pendiente de resumen (`digested_at`
 * nulo) es exactamente un aviso cuya entrega sigue siendo `daily_digest`:
 * cambiar de preferencia sella lo pendiente del kind, de modo que este comando
 * no puede mandar un correo que la cuenta ya pidió silenciar.
 *
 * Cada cuenta se procesa como un CLAIM TRANSACCIONAL, no como una lectura en
 * memoria que después decide qué mandar:
 *
 *  1. se bloquean (`FOR UPDATE`) los avisos candidatos de la cuenta y se
 *     revalidan bajo el lock —siguen sin digerir y su kind sigue pidiendo
 *     resumen—. Un cambio de preferencia concurrente o se sella antes de este
 *     claim (y el claim no lo ve) o espera al commit del claim (y el correo ya
 *     estaba admitido antes de que el cambio rigiera): la carrera no existe;
 *  2. el correo se admite en el outbox con identidad determinista (misma
 *     cuenta y mismos avisos = misma clave de outbox), y el sellado de
 *     `digested_at` compila con la admisión en LA MISMA transacción: un crash
 *     no puede dejar un correo admitido sin sellar ni duplicar el resumen en la
 *     siguiente pasada.
 *
 * La admisión del correo manda: si el outbox no admite, la transacción revierte
 * entera y lo pendiente queda intacto para la próxima pasada. Un fallo de
 * transporte posterior lo resuelve el reintento del propio outbox.
 */
class UvhNotificationsDigest extends Command
{
    protected $signature = 'uvh:notifications-digest';

    protected $description = 'Envía el resumen diario de notificaciones operativas pendientes';

    /** Un resumen acota: nunca la bandeja entera en un correo. */
    private const MAX_ITEMS_PER_USER = 20;

    /** Y una pasada acota el trabajo; lo que quede va a la siguiente. */
    private const MAX_USERS_PER_RUN = 200;

    /**
     * Un claim también se acota: más avisos de estos esperan a la próxima
     * pasada en vez de cargar la transacción entera de una cuenta.
     */
    private const MAX_ITEMS_PER_CLAIM = 500;

    public function handle(): int
    {
        // El tope es operacional, no lógico: primero se eligen los usuarios
        // candidatos de esta pasada —agregando, sin traer filas— y sólo después
        // se trabajan sus avisos. El backlog entero jamás entra en memoria.
        $userIds = DB::table('notifications')
            ->whereNull('digested_at')
            ->groupBy('user_id')
            ->orderBy('user_id')
            ->limit(self::MAX_USERS_PER_RUN)
            ->pluck('user_id');

        $sent = 0;
        foreach ($userIds as $userId) {
            try {
                if ($this->digestUser((int) $userId)) {
                    $sent++;
                }
            } catch (\Throwable) {
                // El claim de esta cuenta revirtió íntegro (el outbox no admitió
                // el correo): lo pendiente queda intacto para la próxima pasada.
                continue;
            }
        }

        $this->info('resúmenes enviados: '.$sent);

        return self::SUCCESS;
    }

    /**
     * Un resumen por cuenta, como claim transaccional (ver la clase).
     */
    private function digestUser(int $userId): bool
    {
        return DB::transaction(function () use ($userId): bool {
            // 1. Claim: candidatos bloqueados y revalidados bajo el lock.
            $rows = DB::table('notifications')
                ->where('user_id', $userId)
                ->whereNull('digested_at')
                ->orderBy('id')
                ->limit(self::MAX_ITEMS_PER_CLAIM)
                ->lockForUpdate()
                ->get(['id', 'kind', 'subject', 'created_at']);
            if ($rows->isEmpty()) {
                return false;
            }

            $digestibleKinds = $this->digestibleKinds($userId, $rows->pluck('kind')->unique()->all());
            $claim = $rows->filter(fn (object $row): bool => in_array((string) $row->kind, $digestibleKinds, true));
            $retired = $rows->reject(fn (object $row): bool => in_array((string) $row->kind, $digestibleKinds, true));
            if ($retired->isNotEmpty()) {
                // Lo que la preferencia ya no pide se sella sin correo, igual
                // que hace el propio cambio de preferencia.
                DB::table('notifications')->whereIn('id', $retired->pluck('id')->all())
                    ->update(['digested_at' => now()]);
            }
            if ($claim->isEmpty()) {
                return false;
            }

            $email = DB::table('users')->where('id', $userId)->value('email');
            if (! is_string($email) || $email === '') {
                return false;
            }

            $ids = $claim->pluck('id')->map(fn ($id): int => (int) $id)->all();
            $total = (int) DB::table('notifications')->where('user_id', $userId)->whereNull('digested_at')->count();
            $shown = $claim->take(self::MAX_ITEMS_PER_USER)->values()->all();
            $hidden = max(0, $total - count($shown));
            [$html, $text] = $this->render($shown, $hidden);

            // 2. Admisión con identidad determinista y sellado en la MISMA
            // transacción: mismo claim = misma clave de outbox (un reintento no
            // duplica), y admisión y sellado o compilan juntos o no existen.
            $generation = hash('sha256', json_encode([$userId, $ids], JSON_THROW_ON_ERROR));
            if (! UvhMail::notificationDigest($email, $html, $text, $userId, $generation)) {
                throw new \RuntimeException('Notification digest outbox admission failed');
            }
            DB::table('notifications')->whereIn('id', $ids)->whereNull('digested_at')
                ->update(['digested_at' => now()]);

            return true;
        });
    }

    /**
     * Los kinds del claim que siguen pidiendo resumen diario según la
     * preferencia vigente bajo lock. Los obligatorios nunca: su entrega es
     * inmediata y su fila no debió quedar pendiente de resumen.
     *
     * @param  list<string>  $kinds
     * @return list<string>
     */
    private function digestibleKinds(int $userId, array $kinds): array
    {
        $stored = DB::table('notification_preferences')
            ->where('user_id', $userId)
            ->whereIn('kind', $kinds)
            ->pluck('delivery', 'kind');

        $digestible = [];
        foreach ($kinds as $kind) {
            $delivery = $stored->get($kind);
            if (! NotificationKinds::isMandatory($kind) && $delivery === NotificationPreferences::DELIVERY_DAILY_DIGEST) {
                $digestible[] = $kind;
            }
        }

        return $digestible;
    }

    /**
     * @param  list<object>  $rows
     * @return array{0: string, 1: string} [html, text]
     */
    private function render(array $rows, int $hidden): array
    {
        $panelUrl = rtrim((string) config('app.url'), '/').'/app/notifications';
        $html = '';
        $text = [];
        foreach ($rows as $row) {
            $title = NotificationKinds::title((string) $row->kind) ?? 'Aviso de UVH';
            $subject = is_string($row->subject) && $row->subject !== '' ? ' — '.$row->subject : '';
            $when = IsoDate::format($row->created_at) ?? '';
            $html .= '<p><strong>'.$this->esc($title).'</strong>'.$this->esc($subject)
                .'<br><span style="color:#667085;font-size:12px">'.$this->esc($when).'</span></p>';
            $text[] = $title.$subject.' ('.$when.')';
        }
        if ($hidden > 0) {
            $html .= '<p>…y '.$hidden.' avisos más en tu bandeja.</p>';
            $text[] = '…y '.$hidden.' avisos más en tu bandeja.';
        }
        $html .= '<p><a href="'.$this->esc($panelUrl).'">Ver tu bandeja de notificaciones</a></p>';
        $text[] = 'Bandeja: '.$panelUrl;

        return [$html, implode("\n", $text)];
    }

    private function esc(string $value): string
    {
        return htmlspecialchars($value, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }
}
