<?php

namespace App\Support;

use Illuminate\Mail\Message;
use Illuminate\Mail\SentMessage;
use Illuminate\Support\Facades\DB;
use Illuminate\Support\Facades\Log;
use Illuminate\Support\Facades\Mail;
use Illuminate\Support\HtmlString;

class UvhMail
{
    /**
     * Admit an encrypted transactional email into the durable DB outbox. When
     * called inside a transaction, the row commits atomically with the state
     * that requires the message; queue publication is recoverable afterwards.
     */
    private static function send(
        string $kind,
        string $to,
        string $subject,
        string $html,
        string $text,
        ?string $resourceType = null,
        int|string|null $resourceId = null,
        ?string $resourceGeneration = null,
    ): bool
    {
        try {
            $envelope = UvhCrypto::encryptAtRest(json_encode([
                'to' => $to,
                'subject' => $subject,
                'html' => $html,
                'text' => $text,
            ], JSON_THROW_ON_ERROR));
            $idempotencyKey = self::idempotencyKey($kind, $resourceType, $resourceId, $resourceGeneration);
            DB::table('mail_outbox')->insertOrIgnore([
                'idempotency_key' => $idempotencyKey,
                'encrypted_envelope' => $envelope,
                'kind' => $kind,
                'resource_type' => $resourceType,
                'resource_id' => $resourceId !== null ? (string) $resourceId : null,
                'resource_generation' => $resourceGeneration,
                'status' => 'pending',
                'attempts' => 0,
                'available_at' => now(),
                'created_at' => now(),
                'updated_at' => now(),
            ]);
            $outboxId = DB::table('mail_outbox')->where('idempotency_key', $idempotencyKey)->value('id');
            if (! is_int($outboxId) && ! (is_string($outboxId) && ctype_digit($outboxId))) {
                throw new \RuntimeException('Mail outbox admission did not persist');
            }
            $outboxId = (int) $outboxId;

            // Queue publication is an optimisation. A process crash after the
            // commit still leaves a pending row for housekeeping to recover.
            try {
                DB::afterCommit(static fn () => MailOutboxDispatcher::enqueue($outboxId));
            } catch (\Throwable $dispatchError) {
                Log::error('[mail] outbox after-commit scheduling failed', [
                    'outbox_id' => $outboxId,
                    'exception' => $dispatchError::class,
                ]);
            }

            return true;
        } catch (\Throwable $e) {
            Log::error('[mail] outbox admission failed', ['exception' => $e::class]);

            return false;
        }
    }

    /** Execute one attempt. Called only by the legacy or outbox delivery job. */
    public static function sendNow(string $to, string $subject, string $html, string $text): bool
    {
        $mailConfig = config('mail');
        if (! app()->environment('production') && MailTransportPolicy::isDevelopment($mailConfig)) {
            // Development transports intentionally report success without
            // recording recipients, subjects or bearer URLs in application logs.
            Log::info('[mail] development transport accepted message');
            return true;
        }

        // A composite mailer is only as reliable as its weakest branch. The
        // default smtp -> log fallback would leak bearer URLs and report a
        // successful send during an outage; reject it before any transport runs.
        if (MailTransportPolicy::deliveryLeaves($mailConfig) === null) {
            Log::error('[mail] delivery transport configuration rejected');
            return false;
        }

        try {
            $sent = Mail::send(
                ['html' => new HtmlString($html), 'raw' => $text],
                [],
                static fn (Message $message) => $message->to($to)->subject($subject),
            );
            // Laravel returns null when a MessageSending listener cancels the
            // send or the transport supplies no receipt. The outbox must retain
            // its envelope and retry instead of treating that as acceptance.
            if (! $sent instanceof SentMessage) {
                Log::warning('[mail] transport did not confirm acceptance');
                return false;
            }
            return true;
        } catch (\Throwable $e) {
            // A delivery outage must be visible to monitoring, but email
            // addresses, message subjects and token-bearing URLs are PII/secrets.
            Log::error('[mail] send failed', ['exception' => $e::class]);
            return false;
        }
    }

    public static function verification(string $to, string $url, string $tokenHash): bool
    {
        $link = '<a href="'.self::esc($url).'" style="display:inline-block;background:#2457F5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Verificar email</a>';
        return self::send(
            'verification',
            $to,
            'Verifica tu email en UVH',
            self::layout('Verifica tu cuenta', '<p>Haz clic para confirmar tu dirección de correo y activar tu cuenta.</p><p style="margin:18px 0">'.$link.'</p><p style="word-break:break-all;font-size:12px;color:#8A94A6">'.self::esc($url).'</p>'),
            "Verifica tu cuenta en UVH: {$url}",
            'email_token',
            $tokenHash,
            $tokenHash,
        );
    }

    public static function resetPassword(string $to, string $url, string $tokenHash): bool
    {
        $link = '<a href="'.self::esc($url).'" style="display:inline-block;background:#2457F5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Restablecer contraseña</a>';
        return self::send(
            'password_reset',
            $to,
            'Restablece tu contraseña en UVH',
            self::layout('Restablecer contraseña', '<p>Recibimos una solicitud para restablecer tu contraseña. El enlace caduca en 60 minutos.</p><p style="margin:18px 0">'.$link.'</p>'),
            "Restablece tu contraseña en UVH: {$url}",
            'email_token',
            $tokenHash,
            $tokenHash,
        );
    }

    public static function passwordChanged(string $to, string $incidentUrl, string $tokenHash): bool
    {
        $link = '<a href="'.self::esc($incidentUrl).'" style="display:inline-block;background:#B42318;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Cerrar accesos de emergencia</a>';
        return self::send(
            'password_changed',
            $to,
            'Contraseña actualizada en UVH',
            self::layout('Contraseña actualizada', '<p>La contraseña de tu cuenta se ha actualizado y el resto de sesiones han quedado cerradas.</p><p>Si no reconoces esta acción, usa el control de emergencia durante las próximas 24 horas. Revocará sesiones, tokens API y cambios pendientes, pero no iniciará sesión ni desactivará MFA.</p><p style="margin:18px 0">'.$link.'</p>'),
            "La contraseña de tu cuenta UVH se ha actualizado. Si no reconoces la acción, revoca los accesos durante las próximas 24 horas: {$incidentUrl}",
            'email_token',
            $tokenHash,
            $tokenHash,
        );
    }

    public static function accountRecoveryConfirmation(string $to, string $url, int $requestId, string $generationHash): bool
    {
        $link = '<a href="'.self::esc($url).'" style="display:inline-block;background:#2457F5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Confirmar solicitud</a>';
        return self::send(
            'account_recovery_confirmation',
            $to,
            'Confirma tu solicitud de recuperación UVH',
            self::layout('Recuperación reforzada', '<p>Se ha solicitado recuperar una cuenta sin acceso al autenticador ni a sus códigos de recuperación.</p><p>Confirmar el email sólo abre un expediente: no inicia sesión ni desactiva MFA. Dos administradores distintos deberán verificar la identidad por el procedimiento de soporte.</p><p style="margin:18px 0">'.$link.'</p>'),
            "Confirma la solicitud de recuperación reforzada UVH durante la próxima hora: {$url}",
            'account_recovery',
            $requestId,
            $generationHash,
        );
    }

    public static function accountRecoveryApproved(string $to, string $url, int $requestId, string $generationHash): bool
    {
        $link = '<a href="'.self::esc($url).'" style="display:inline-block;background:#2457F5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Finalizar recuperación</a>';
        return self::send(
            'account_recovery_approved',
            $to,
            'Tu recuperación reforzada UVH ha sido aprobada',
            self::layout('Recuperación aprobada', '<p>Dos administradores distintos han aprobado el expediente después de verificar la identidad por el procedimiento de soporte.</p><p>El enlace caduca en 30 minutos, funciona una sola vez y exige establecer una contraseña nueva. Al completarlo se cerrarán accesos y se retirará el MFA perdido.</p><p style="margin:18px 0">'.$link.'</p>'),
            "Finaliza la recuperación reforzada UVH durante los próximos 30 minutos: {$url}",
            'account_recovery',
            $requestId,
            $generationHash,
        );
    }

    public static function accountRecoveryRejected(string $to): bool
    {
        return self::send(
            'account_recovery_rejected',
            $to,
            'La solicitud de recuperación UVH no ha sido aprobada',
            self::layout('Solicitud no aprobada', '<p>El expediente de recuperación reforzada se ha cerrado porque no pudo completarse la verificación de identidad.</p><p>Si necesitas continuar, contacta con soporte y abre una solicitud nueva. El acceso y MFA de la cuenta no se han modificado.</p>'),
            'La solicitud de recuperación reforzada UVH no ha sido aprobada. El acceso y MFA no se han modificado.',
        );
    }

    public static function emailChangeVerification(string $to, string $url, string $tokenHash): bool
    {
        $link = '<a href="'.self::esc($url).'" style="display:inline-block;background:#2457F5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Confirmar nuevo email</a>';
        return self::send(
            'email_change_verification',
            $to,
            'Confirma tu nuevo email en UVH',
            self::layout('Confirma tu nuevo email', '<p>Se ha solicitado usar esta dirección en una cuenta de UVH. Confírmala durante la próxima hora para completar el cambio.</p><p style="margin:18px 0">'.$link.'</p><p style="word-break:break-all;font-size:12px;color:#8A94A6">'.self::esc($url).'</p>'),
            "Confirma tu nuevo email en UVH durante la próxima hora: {$url}",
            'email_change',
            $tokenHash,
            $tokenHash,
        );
    }

    public static function emailChangeRequested(string $to): bool
    {
        return self::send(
            'email_change_requested',
            $to,
            'Solicitud de cambio de email en UVH',
            self::layout('Solicitud de cambio de email', '<p>Se ha solicitado cambiar la dirección de correo de tu cuenta. El cambio no se completará hasta confirmar el nuevo buzón.</p><p>Si no reconoces esta acción, cambia tu contraseña, revisa tus sesiones y contacta con soporte.</p>'),
            'Se ha solicitado cambiar el email de tu cuenta UVH. Si no fuiste tú, cambia tu contraseña, revisa tus sesiones y contacta con soporte.',
        );
    }

    public static function emailChanged(string $to): bool
    {
        return self::send(
            'email_changed',
            $to,
            'Email de acceso actualizado en UVH',
            self::layout('Email actualizado', '<p>La dirección de acceso de tu cuenta se ha actualizado correctamente. Todas las sesiones anteriores se han cerrado.</p><p>Si no reconoces esta acción, contacta con soporte de inmediato.</p>'),
            'El email de acceso de tu cuenta UVH se ha actualizado y todas las sesiones anteriores se han cerrado. Si no reconoces esta acción, contacta con soporte.',
        );
    }

    public static function dataExportConfirmation(string $to, string $url, int $requestId, string $generationHash): bool
    {
        $link = '<a href="'.self::esc($url).'" style="display:inline-block;background:#2457F5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Confirmar exportación</a>';
        return self::send(
            'data_export_confirmation',
            $to,
            'Confirma tu exportación de datos en UVH',
            self::layout('Confirma la exportación', '<p>Hemos recibido una solicitud para preparar una copia estructurada de tus datos. Confírmala durante la próxima hora.</p><p style="margin:18px 0">'.$link.'</p><p>Prepararemos el archivo en segundo plano y te enviaremos otro enlace cuando esté listo.</p>'),
            "Confirma tu exportación de datos UVH durante la próxima hora: {$url}",
            'data_export',
            $requestId,
            $generationHash,
        );
    }

    public static function dataExportReady(string $to, string $url, int $requestId, string $generationHash): bool
    {
        $link = '<a href="'.self::esc($url).'" style="display:inline-block;background:#00A99D;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Descargar mis datos</a>';
        return self::send(
            'data_export_ready',
            $to,
            'Tu exportación de datos UVH está lista',
            self::layout('Exportación lista', '<p>Tu archivo cifrado ya está preparado. El enlace funciona una sola vez y caduca en 24 horas.</p><p style="margin:18px 0">'.$link.'</p><p>No reenvíes este correo: el enlace permite descargar información de tu cuenta.</p>'),
            "Tu exportación UVH está lista. El enlace funciona una sola vez y caduca en 24 horas: {$url}",
            'data_export',
            $requestId,
            $generationHash,
        );
    }

    public static function accountDeletionConfirmation(string $to, string $url, int $requestId, string $generationHash): bool
    {
        $link = '<a href="'.self::esc($url).'" style="display:inline-block;background:#B42318;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Revisar eliminación</a>';
        return self::send(
            'account_deletion_confirmation',
            $to,
            'Confirma la eliminación de tu cuenta UVH',
            self::layout('Solicitud de eliminación', '<p>Se ha solicitado eliminar tu cuenta. Abre el enlace durante la próxima hora y confirma de nuevo para programar la eliminación.</p><p style="margin:18px 0">'.$link.'</p><p>No se borrará nada si no completas ese segundo paso.</p>'),
            "Revisa y confirma la eliminación de tu cuenta UVH durante la próxima hora: {$url}",
            'account_deletion',
            $requestId,
            $generationHash,
        );
    }

    public static function accountDeletionScheduled(string $to, string $cancelUrl, string $executeAt, int $requestId, string $generationHash): bool
    {
        $link = '<a href="'.self::esc($cancelUrl).'" style="display:inline-block;background:#2457F5;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Cancelar eliminación</a>';
        return self::send(
            'account_deletion_scheduled',
            $to,
            'Tu cuenta UVH está programada para eliminación',
            self::layout('Eliminación programada', '<p>El acceso se ha cerrado y la cuenta se anonimizará a partir de <strong>'.self::esc($executeAt).'</strong>.</p><p style="margin:18px 0">'.$link.'</p><p>El enlace de cancelación funciona hasta que empiece la ejecución.</p>'),
            "Tu cuenta UVH se eliminará a partir de {$executeAt}. Puedes cancelarlo antes desde: {$cancelUrl}",
            'account_deletion',
            $requestId,
            $generationHash,
        );
    }

    public static function accountDeletionCancelled(string $to): bool
    {
        return self::send(
            'account_deletion_cancelled',
            $to,
            'Eliminación de cuenta cancelada en UVH',
            self::layout('Eliminación cancelada', '<p>La cuenta vuelve a estar activa. Por seguridad, tendrás que iniciar sesión de nuevo y los tokens API revocados no se restaurarán.</p>'),
            'La eliminación de tu cuenta UVH se ha cancelado. Inicia sesión de nuevo; los tokens API revocados no se restaurarán.',
        );
    }

    public static function privacyRequestReceived(string $to, int $requestId, string $generationHash): bool
    {
        return self::send(
            'privacy_request_received',
            $to,
            'Solicitud de privacidad registrada en UVH',
            self::layout('Solicitud registrada', '<p>Hemos registrado tu solicitud de ejercicio de derechos. Puedes consultar su estado y responder a peticiones de información desde Ajustes.</p><p>El plazo ordinario de respuesta es de un mes. Si la complejidad exige ampliarlo, recibirás una notificación motivada.</p>'),
            'Tu solicitud de ejercicio de derechos se ha registrado en UVH. Puedes seguirla desde Ajustes.',
            'privacy_right',
            $requestId,
            $generationHash,
        );
    }

    public static function privacyRequestUpdated(string $to, int $requestId, string $status, string $generationHash): bool
    {
        $copy = match ($status) {
            'in_progress' => ['Solicitud en revisión', 'Tu solicitud ha entrado en revisión.'],
            'waiting_user' => ['Necesitamos información', 'Hay una petición de información en tu expediente. Revísala y responde desde Ajustes.'],
            'completed' => ['Solicitud resuelta', 'Tu solicitud ha sido resuelta. La respuesta está disponible en Ajustes.'],
            'rejected' => ['Solicitud cerrada', 'La solicitud se ha cerrado con una respuesta motivada disponible en Ajustes.'],
            'cancelled' => ['Solicitud cancelada', 'La cancelación de tu solicitud ha quedado registrada.'],
            'extended' => ['Plazo ampliado', 'El plazo de respuesta se ha ampliado por complejidad o volumen. La motivación y la nueva fecha están disponibles en Ajustes.'],
            default => ['Solicitud actualizada', 'El estado de tu solicitud de privacidad ha cambiado.'],
        };

        return self::send(
            'privacy_request_updated',
            $to,
            'Solicitud de privacidad actualizada en UVH',
            self::layout($copy[0], '<p>'.self::esc($copy[1]).'</p><p>No respondas a este correo con documentación personal; utiliza el expediente dentro de UVH.</p>'),
            $copy[1].' Consulta el expediente desde Ajustes de UVH.',
            'privacy_right',
            $requestId,
            $generationHash,
        );
    }

    public static function workspaceOwnershipTransferred(string $to, string $workspace): bool
    {
        return self::send(
            'workspace_ownership_transfer',
            $to,
            'Propiedad de workspace actualizada en UVH',
            self::layout('Propiedad actualizada', '<p>La propiedad del workspace <strong>'.self::esc($workspace).'</strong> ha cambiado. Revisa los miembros y accesos si no reconoces esta operación.</p>'),
            "La propiedad del workspace {$workspace} ha cambiado en UVH. Revisa los miembros y accesos si no reconoces esta operación.",
        );
    }

    public static function mfaEnabled(string $to, bool $reconfigured): bool
    {
        $title = $reconfigured ? 'Autenticador sustituido' : 'Verificación en dos pasos activada';
        $body = $reconfigured
            ? '<p>La aplicación autenticadora de tu cuenta se ha sustituido y los códigos de recuperación anteriores ya no son válidos.</p>'
            : '<p>La verificación en dos pasos ya está activa. Los próximos accesos requerirán tu aplicación autenticadora o un código de recuperación.</p>';

        return self::send(
            $reconfigured ? 'mfa_reconfigured' : 'mfa_enabled',
            $to,
            $reconfigured ? 'Autenticador MFA actualizado en UVH' : 'MFA activado en UVH',
            self::layout($title, $body.'<p>Si no reconoces este cambio, inicia una recuperación de cuenta y contacta con soporte.</p>'),
            $reconfigured
                ? 'La aplicación autenticadora de tu cuenta UVH se ha sustituido. Si no reconoces el cambio, recupera la cuenta y contacta con soporte.'
                : 'La verificación en dos pasos se ha activado en tu cuenta UVH. Si no reconoces el cambio, recupera la cuenta y contacta con soporte.',
        );
    }

    public static function mfaRecoveryCodesRegenerated(string $to): bool
    {
        return self::send(
            'mfa_recovery_codes_regenerated',
            $to,
            'Códigos de recuperación MFA renovados en UVH',
            self::layout('Códigos de recuperación renovados', '<p>Se ha generado un nuevo juego de códigos de recuperación. Todos los anteriores han dejado de funcionar y las demás sesiones se han cerrado.</p><p>Si no reconoces este cambio, inicia una recuperación de cuenta y contacta con soporte.</p>'),
            'Los códigos de recuperación MFA de tu cuenta UVH se han renovado y los anteriores ya no funcionan. Si no reconoces el cambio, recupera la cuenta y contacta con soporte.',
        );
    }

    public static function mfaDisabled(string $to): bool
    {
        return self::send(
            'mfa_disabled',
            $to,
            'MFA desactivado en UVH',
            self::layout('Verificación en dos pasos desactivada', '<p>La verificación en dos pasos se ha desactivado y las demás sesiones se han cerrado.</p><p>Si no reconoces este cambio, cambia tu contraseña y contacta con soporte de inmediato.</p>'),
            'La verificación en dos pasos se ha desactivado en tu cuenta UVH. Si no reconoces el cambio, cambia tu contraseña y contacta con soporte.',
        );
    }

    public static function apiTokenCreated(string $to, string $name): bool
    {
        return self::send(
            'api_token_created',
            $to,
            'Nuevo token API creado en UVH',
            self::layout('Nuevo token API', '<p>Se ha creado la credencial <strong>'.self::esc($name).'</strong>. El valor secreto no se incluye en este correo.</p><p>Si no reconoces esta operación, revoca el token y revisa tus sesiones.</p>'),
            "Se ha creado el token API {$name} en UVH. Si no reconoces la operación, revócalo y revisa tus sesiones.",
        );
    }

    public static function workspaceDeleted(string $to, string $workspace): bool
    {
        return self::send(
            'workspace_deleted',
            $to,
            'Workspace eliminado en UVH',
            self::layout('Workspace eliminado', '<p>El workspace <strong>'.self::esc($workspace).'</strong> y sus recursos asociados se han eliminado.</p><p>Si no reconoces esta operación, contacta con soporte de inmediato.</p>'),
            "El workspace {$workspace} se ha eliminado en UVH. Si no reconoces la operación, contacta con soporte de inmediato.",
        );
    }

    public static function invitation(
        string $to,
        string $url,
        string $workspace,
        string $role,
        int $invitationId,
        string $generationHash,
    ): bool
    {
        $link = '<a href="'.self::esc($url).'" style="display:inline-block;background:#00A99D;color:#fff;text-decoration:none;padding:12px 20px;border-radius:8px;font-weight:600">Aceptar invitación</a>';
        return self::send(
            'invitation',
            $to,
            'Tienes una invitación de equipo en UVH',
            self::layout('Invitación de equipo', '<p>Has sido invitado a <strong>'.self::esc($workspace).'</strong> con rol <strong>'.self::esc($role).'</strong>.</p><p style="margin:18px 0">'.$link.'</p>'),
            "Te invitaron a {$workspace} (rol {$role}) en UVH: {$url}",
            'invitation',
            $invitationId,
            $generationHash,
        );
    }

    private static function layout(string $title, string $body): string
    {
        return '<!doctype html><html><body style="font-family:Manrope,Segoe UI,Arial,sans-serif;background:#F6F8FC;padding:24px">'
            .'<div style="max-width:560px;margin:0 auto;background:#fff;border:1px solid #E3E8F0;border-radius:14px;padding:28px">'
            .'<p style="font-weight:800;color:#07111F;font-size:18px;margin:0 0 4px">UVH <span style="color:#2457F5">·</span> <span style="color:#00A99D">Enlaces cortos. Control total.</span></p>'
            .'<h1 style="color:#07111F;font-size:20px;margin:18px 0 8px">'.$title.'</h1>'
            .'<div style="color:#33415C;line-height:1.6">'.$body.'</div>'
            .'<p style="color:#667085;font-size:12px;margin-top:24px">Si no reconoces esta actividad, revisa la seguridad de tu cuenta antes de continuar.</p>'
            .'</div></body></html>';
    }

    private static function esc(string $v): string
    {
        return htmlspecialchars($v, ENT_QUOTES | ENT_SUBSTITUTE, 'UTF-8');
    }

    private static function idempotencyKey(
        string $kind,
        ?string $resourceType,
        int|string|null $resourceId,
        ?string $resourceGeneration,
    ): string {
        if ($resourceType !== null && $resourceId !== null) {
            return hash('sha256', json_encode([
                'kind' => $kind,
                'resource_type' => $resourceType,
                'resource_id' => (string) $resourceId,
                'resource_generation' => $resourceGeneration,
            ], JSON_THROW_ON_ERROR));
        }

        // Notifications without a lifecycle resource are distinct events.
        return Ids::sha256Hex(Ids::randomToken(32));
    }
}
