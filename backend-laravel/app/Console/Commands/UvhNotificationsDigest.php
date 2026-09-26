<?php

namespace App\Console\Commands;

use App\Support\IsoDate;
use App\Support\NotificationKinds;
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
 * La admisión del correo manda: sólo se sella lo que quedó admitido en el
 * outbox; lo demás se reintenta en la próxima pasada. Un fallo de transporte
 * posterior lo resuelve el reintento del propio outbox.
 */
class UvhNotificationsDigest extends Command
{
    protected $signature = 'uvh:notifications-digest';

    protected $description = 'Envía el resumen diario de notificaciones operativas pendientes';

    /** Un resumen acota: nunca la bandeja entera en un correo. */
    private const MAX_ITEMS_PER_USER = 20;

    /** Y una pasada acota el trabajo; lo que quede va a la siguiente. */
    private const MAX_USERS_PER_RUN = 200;

    public function handle(): int
    {
        $pending = DB::table('notifications')
            ->whereNull('digested_at')
            ->orderBy('user_id')->orderBy('id')
            ->get(['id', 'user_id', 'kind', 'subject', 'created_at']);

        $sent = 0;
        foreach ($pending->groupBy('user_id')->take(self::MAX_USERS_PER_RUN) as $userId => $rows) {
            $email = DB::table('users')->where('id', (int) $userId)->value('email');
            if (! is_string($email) || $email === '') {
                continue;
            }

            $ids = $rows->map(fn (object $row): int => (int) $row->id)->all();
            $shown = $rows->take(self::MAX_ITEMS_PER_USER)->values()->all();
            $hidden = $rows->count() - count($shown);
            [$html, $text] = $this->render($shown, $hidden);
            if (! UvhMail::notificationDigest($email, $html, $text)) {
                // Queda pendiente, intacta, para la próxima pasada.
                continue;
            }
            DB::table('notifications')->whereIn('id', $ids)->whereNull('digested_at')
                ->update(['digested_at' => now()]);
            $sent++;
        }

        $this->info('resúmenes enviados: '.$sent);

        return self::SUCCESS;
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
