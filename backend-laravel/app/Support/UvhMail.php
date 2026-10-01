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
    ): bool {
        try {
            $envelope = UvhCrypto::encryptAtRest(json_encode([
                'to' => $to,
                'subject' => $subject,
                'html' => $html,
                'text' => $text,
                'correlation_id' => RequestTrace::current(),
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
        $link = self::action($url, 'Verificar mi email');

        return self::send(
            'verification',
            $to,
            'Verifica tu email en UVH',
            self::layout('Verifica tu cuenta', '<p>Confirma tu dirección de correo para continuar con tu cuenta en UVH.</p>'.$link.self::fallbackUrl($url)),
            "Verifica tu cuenta en UVH: {$url}",
            'email_token',
            $tokenHash,
            $tokenHash,
        );
    }

    public static function resetPassword(string $to, string $url, string $tokenHash): bool
    {
        $link = self::action($url, 'Restablecer contraseña');

        return self::send(
            'password_reset',
            $to,
            'Restablece tu contraseña en UVH',
            self::layout('Restablecer contraseña', '<p>Recibimos una solicitud para restablecer tu contraseña. El enlace caduca en 60 minutos.</p>'.$link),
            "Restablece tu contraseña en UVH: {$url}",
            'email_token',
            $tokenHash,
            $tokenHash,
        );
    }

    public static function passwordChanged(string $to, string $incidentUrl, string $tokenHash): bool
    {
        $link = self::action($incidentUrl, 'Cerrar accesos de emergencia', true);

        return self::send(
            'password_changed',
            $to,
            'Contraseña actualizada en UVH',
            self::layout('Contraseña actualizada', '<p>La contraseña de tu cuenta se ha actualizado y el resto de sesiones han quedado cerradas.</p><p>Si no reconoces esta acción, usa el control de emergencia durante las próximas 24 horas. Revocará sesiones, tokens API y cambios pendientes, pero no iniciará sesión ni desactivará MFA.</p>'.$link),
            "La contraseña de tu cuenta UVH se ha actualizado. Si no reconoces la acción, revoca los accesos durante las próximas 24 horas: {$incidentUrl}",
            'email_token',
            $tokenHash,
            $tokenHash,
        );
    }

    /**
     * Cierre masivo de sesiones. Comparte el portador de incidente del cambio
     * de contraseña: si no reconoces el cierre, el mismo control de emergencia
     * sigue disponible durante las próximas 24 horas.
     */
    public static function sessionRevoked(string $to, string $incidentUrl, string $tokenHash): bool
    {
        $body = '<p>Se ha revocado el acceso de un dispositivo a tu cuenta.</p><p>Si no reconoces esta acción, revisa tus sesiones y utiliza el control de emergencia.</p>';

        return self::send('session_revoked', $to, 'Sesión revocada en UVH',
            self::layout('Sesión revocada', $body.self::action($incidentUrl, 'Revisar el incidente', true)),
            'Se ha revocado una sesión de tu cuenta UVH. Control de emergencia: '.$incidentUrl,
            'email_token', $tokenHash, $tokenHash);
    }

    public static function operationalNotice(string $to, string $kind, string $subject): bool
    {
        $title = NotificationKinds::all()[$kind]['title'];

        return self::send($kind, $to, $title.' · UVH',
            self::layout($title, '<p>'.self::esc($subject).'</p><p>Entra en UVH para revisar este aviso.</p>'),
            $title.'. '.$subject.'. Entra en UVH para revisar este aviso.');
    }

    public static function sessionsRevoked(string $to, string $incidentUrl, string $tokenHash, bool $all): bool
    {
        $link = self::action($incidentUrl, 'Cerrar accesos de emergencia', true);
        $body = $all
            ? '<p>Se han cerrado todas las sesiones abiertas de tu cuenta, incluida la desde la que se realizó la acción. Tendrás que iniciar sesión de nuevo en cada dispositivo.</p>'
            : '<p>Se han cerrado las demás sesiones abiertas de tu cuenta. La sesión desde la que se realizó la acción permanece activa.</p>';

        return self::send(
            $all ? 'sessions_revoked_all' : 'sessions_revoked_others',
            $to,
            $all ? 'Todas las sesiones cerradas en UVH' : 'Sesiones cerradas en UVH',
            self::layout(
                $all ? 'Todas las sesiones cerradas' : 'Sesiones cerradas',
                $body.'<p>Si no reconoces esta acción, usa el control de emergencia durante las próximas 24 horas. Revocará sesiones, tokens API y cambios pendientes, pero no iniciará sesión ni desactivará MFA.</p>'.$link,
            ),
            ($all ? 'Se han cerrado todas las sesiones de tu cuenta UVH.' : 'Se han cerrado las demás sesiones abiertas de tu cuenta UVH.')
                .' Si no reconoces la acción, revoca los accesos durante las próximas 24 horas: '.$incidentUrl,
            'email_token',
            $tokenHash,
            $tokenHash,
        );
    }

    public static function accountRecoveryConfirmation(string $to, string $url, int $requestId, string $generationHash): bool
    {
        $link = self::action($url, 'Confirmar solicitud');

        return self::send(
            'account_recovery_confirmation',
            $to,
            'Confirma tu solicitud de recuperación UVH',
            self::layout('Recuperación reforzada', '<p>Se ha solicitado recuperar una cuenta sin acceso al autenticador ni a sus códigos de recuperación.</p><p>Confirmar el email sólo abre un expediente: no inicia sesión ni desactiva MFA. Dos administradores distintos deberán verificar la identidad por el procedimiento de soporte.</p>'.$link),
            "Confirma la solicitud de recuperación reforzada UVH durante la próxima hora: {$url}",
            'account_recovery',
            $requestId,
            $generationHash,
        );
    }

    public static function accountRecoveryApproved(string $to, string $url, int $requestId, string $generationHash): bool
    {
        $link = self::action($url, 'Finalizar recuperación');

        return self::send(
            'account_recovery_approved',
            $to,
            'Tu recuperación reforzada UVH ha sido aprobada',
            self::layout('Recuperación aprobada', '<p>Dos administradores distintos han aprobado el expediente después de verificar la identidad por el procedimiento de soporte.</p><p>El enlace caduca en 30 minutos, funciona una sola vez y exige establecer una contraseña nueva. Al completarlo se cerrarán accesos y se retirará el MFA perdido.</p>'.$link),
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
        $link = self::action($url, 'Confirmar nuevo email');

        return self::send(
            'email_change_verification',
            $to,
            'Confirma tu nuevo email en UVH',
            self::layout('Confirma tu nuevo email', '<p>Se ha solicitado usar esta dirección en una cuenta de UVH. Confírmala durante la próxima hora para completar el cambio.</p>'.$link.self::fallbackUrl($url)),
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

    /**
     * Aviso, no portador: la descarga se autoriza con la sesión y un step-up
     * reciente, así que este enlace sólo navega hasta la sección de
     * exportaciones. `$generationHash` identifica la generación anunciada para
     * que el outbox descarte avisos de una exportación que ya no está viva.
     */
    public static function dataExportReady(string $to, string $url, string $expiresOn, int $requestId, string $generationHash): bool
    {
        $link = self::action($url, 'Ir a mis exportaciones');

        return self::send(
            'data_export_ready',
            $to,
            'Tu exportación de datos UVH está lista',
            self::layout('Exportación lista', '<p>Tu archivo cifrado ya está preparado en tu sección de exportaciones.</p>'.$link.'<p>Descárgalo antes del '.self::esc($expiresOn).'; después el archivo se elimina automáticamente. Al descargarlo te pediremos la contraseña de la cuenta y, si está activo, el segundo factor.</p>'),
            "Tu exportación UVH está lista. Abre {$url} e inicia sesión para descargarla antes del {$expiresOn}.",
            'data_export',
            $requestId,
            $generationHash,
        );
    }

    public static function accountDeletionConfirmation(string $to, string $url, int $requestId, string $generationHash): bool
    {
        $link = self::action($url, 'Revisar eliminación', true);

        return self::send(
            'account_deletion_confirmation',
            $to,
            'Confirma la eliminación de tu cuenta UVH',
            self::layout('Solicitud de eliminación', '<p>Se ha solicitado eliminar tu cuenta. Abre el enlace durante la próxima hora y confirma de nuevo para programar la eliminación.</p>'.$link.'<p>No se borrará nada si no completas ese segundo paso.</p>'),
            "Revisa y confirma la eliminación de tu cuenta UVH durante la próxima hora: {$url}",
            'account_deletion',
            $requestId,
            $generationHash,
        );
    }

    public static function accountDeletionScheduled(string $to, string $cancelUrl, string $executeAt, int $requestId, string $generationHash): bool
    {
        $link = self::action($cancelUrl, 'Cancelar eliminación');

        return self::send(
            'account_deletion_scheduled',
            $to,
            'Tu cuenta UVH está programada para eliminación',
            self::layout('Eliminación programada', '<p>El acceso se ha cerrado y la cuenta se anonimizará a partir de <strong>'.self::esc($executeAt).'</strong>.</p>'.$link.'<p>El enlace de cancelación funciona hasta que empiece la ejecución.</p>'),
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

    /**
     * Un aviso de salud de dominio para una persona concreta. La preferencia
     * de notificaciones del destinatario decide si esto se ejecuta (`immediate`
     * y los kinds obligatorios); es un mensaje por persona y evento, con
     * identidad (usuario, evento) para que una reentrega del outbox jamás
     * pueda duplicar el correo.
     */
    public static function domainNotice(
        string $to,
        string $kind,
        string $domain,
        int $domainId,
        string $reason,
        int $userId,
        string $eventGeneration,
    ): bool {
        [$subject, $title, $body, $text] = match ($kind) {
            'domain_offline' => [
                'Tu dominio '.$domain.' dejó de servir enlaces en UVH',
                'Dominio fuera de servicio',
                '<p>El dominio <strong>'.self::esc($domain).'</strong> ha dejado de servir sus enlaces.</p><p>Motivo: '.self::esc($reason).'</p><p>Los enlaces no se han eliminado: revisa la configuración DNS del dominio y vuelve a activarlo desde el panel.</p>',
                "El dominio {$domain} ha dejado de servir enlaces en UVH ({$reason}). Los enlaces siguen existiendo; revisa la configuración DNS y vuelve a activarlo desde el panel.",
            ],
            'domain_dns_degraded' => [
                'La configuración DNS de '.$domain.' está fallando',
                'Dominio degradado',
                '<p>La comprobación periódica del dominio <strong>'.self::esc($domain).'</strong> ha fallado.</p><p>Motivo: '.self::esc($reason).'</p><p>El dominio sigue sirviendo durante un periodo de gracia. Corrige la configuración DNS para evitar que deje de servir enlaces.</p>',
                "La comprobación del dominio {$domain} ha fallado ({$reason}). El dominio sigue sirviendo durante un periodo de gracia; corrige la configuración DNS.",
            ],
            'domain_recovered' => [
                'Tu dominio '.$domain.' se recuperó',
                'Dominio recuperado',
                '<p>El dominio <strong>'.self::esc($domain).'</strong> vuelve a servir sus enlaces con normalidad.</p>',
                "El dominio {$domain} vuelve a servir sus enlaces con normalidad.",
            ],
            'domain_tls_failed' => [
                'No se pudo preparar el HTTPS de '.$domain,
                'HTTPS no disponible',
                '<p>No pudimos mantener el certificado HTTPS del dominio <strong>'.self::esc($domain).'</strong>.</p><p>Motivo: '.self::esc($reason).'</p><p>El dominio deja de servir enlaces hasta que el certificado vuelva a estar disponible.</p>',
                "No pudimos mantener el certificado HTTPS del dominio {$domain} ({$reason}). El dominio deja de servir enlaces hasta que el certificado vuelva a estar disponible.",
            ],
            'domain_tls_expiring' => [
                'El certificado de '.$domain.' está por caducar',
                'Certificado por caducar',
                '<p>El certificado HTTPS del dominio <strong>'.self::esc($domain).'</strong> está cerca de caducar.</p><p>UVH renueva los certificados automáticamente; si este mensaje se repite, revisa la configuración DNS y los registros CAA del dominio.</p>',
                "El certificado HTTPS del dominio {$domain} está cerca de caducar. La renovación es automática; si este mensaje se repite, revisa la configuración DNS y los registros CAA.",
            ],
            'domain_claim_transferred' => [
                'La propiedad de '.$domain.' cambió de workspace',
                'Propiedad de dominio transferida',
                '<p>Otro workspace ha probado el control del dominio <strong>'.self::esc($domain).'</strong> y ahora le pertenece.</p><p>Motivo: '.self::esc($reason).'</p><p>El dominio queda desactivado en tu workspace; los enlaces que usaban ese dominio dejan de responder hasta que los asignes a otro.</p>',
                "Otro workspace ha probado el control del dominio {$domain} y ahora le pertenece ({$reason}). El dominio queda desactivado en tu workspace.",
            ],
            default => [
                'Aviso de dominio en UVH',
                'Aviso de dominio',
                '<p>Hay una novedad sobre el dominio <strong>'.self::esc($domain).'</strong>.</p>',
                "Hay una novedad sobre el dominio {$domain}.",
            ],
        };

        return self::send(
            $kind,
            $to,
            $subject,
            self::layout($title, $body),
            $text,
            'domain',
            $domainId,
            $userId.':'.$eventGeneration,
        );
    }

    /**
     * El resumen diario del centro de notificaciones. Sin recurso asociado: es
     * un aviso de la propia cuenta, siempre vigente, que sólo lista títulos y
     * rutas internas — nunca secretos, URLs bearer ni contenido ajeno.
     */
    public static function notificationDigest(string $to, string $summaryHtml, string $summaryText, int $userId, string $generation): bool
    {
        // Identidad de lifecycle determinista (cuenta + claim exacto): el mismo
        // resumen reintentado tras un crash choca en la misma clave del outbox
        // y se descarta en vez de duplicar el correo.
        return self::send(
            'notification_digest',
            $to,
            'Tu resumen de notificaciones de UVH',
            self::layout('Resumen de notificaciones', $summaryHtml),
            $summaryText,
            'notification',
            $userId,
            $generation,
        );
    }

    public static function invitation(
        string $to,
        string $url,
        string $workspace,
        string $role,
        int $invitationId,
        string $generationHash,
    ): bool {
        $link = self::action($url, 'Aceptar invitación');

        return self::send(
            'invitation',
            $to,
            'Tienes una invitación de equipo en UVH',
            self::layout('Invitación de equipo', '<p>Has sido invitado a <strong>'.self::esc($workspace).'</strong> con rol <strong>'.self::esc($role).'</strong>.</p>'.$link),
            "Te invitaron a {$workspace} (rol {$role}) en UVH: {$url}",
            'invitation',
            $invitationId,
            $generationHash,
        );
    }

    private static function layout(string $title, string $body): string
    {
        $safeTitle = self::esc($title);
        $helpUrl = self::esc(FrontendUrl::base().'/help');

        // Tables and inline styles keep the hierarchy intact in Gmail, Apple
        // Mail and Outlook. No remote fonts or images are needed to read it.
        return <<<HTML
            <!doctype html>
            <html lang="es">
            <head>
              <meta charset="utf-8">
              <meta name="viewport" content="width=device-width, initial-scale=1">
              <meta name="color-scheme" content="light">
              <title>{$safeTitle} · UVH</title>
              <style>
                @media only screen and (max-width: 480px) {
                  .uvh-mail-outer { padding: 20px 12px !important; }
                  .uvh-mail-content { padding: 31px 24px 29px !important; }
                  .uvh-mail-title { font-size: 27px !important; }
                  .uvh-mail-footer { padding: 22px 24px !important; }
                }
                .uvh-mail-copy p { margin: 0 0 18px; }
                .uvh-mail-copy p:last-child { margin-bottom: 0; }
              </style>
            </head>
            <body style="margin:0;padding:0;background-color:#f5f2e9;color:#262821;font-family:Manrope,Arial,Helvetica,sans-serif;">
              <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" bgcolor="#f5f2e9" style="border-collapse:collapse;background-color:#f5f2e9;">
                <tr><td align="center" class="uvh-mail-outer" style="padding:34px 20px 42px;">
                  <!--[if mso]><table role="presentation" align="center" cellpadding="0" cellspacing="0" border="0" width="600"><tr><td><![endif]-->
                  <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;max-width:600px;border-collapse:collapse;">
                    <tr><td style="padding:0 2px 22px;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
                        <tr>
                          <td valign="bottom" style="color:#262821;font-family:Manrope,Arial,Helvetica,sans-serif;font-size:35px;line-height:1;font-weight:800;letter-spacing:-2.5px;">uvh<span style="color:#b53c20;">.</span></td>
                          <td align="right" valign="bottom" style="color:#626357;font-family:Georgia,serif;font-size:13px;font-style:italic;line-height:1.4;">Enlaces con recorrido.</td>
                        </tr>
                      </table>
                    </td></tr>
                    <tr><td bgcolor="#fffcf5" style="background-color:#fffcf5;border:1px solid #cecec0;border-top:3px solid #262821;">
                      <table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="border-collapse:collapse;">
                        <tr><td class="uvh-mail-content" style="padding:43px 42px 39px;">
                          <h1 class="uvh-mail-title" style="margin:0;color:#262821;font-family:Manrope,Arial,Helvetica,sans-serif;font-size:32px;line-height:1.16;font-weight:800;letter-spacing:-1.2px;">{$safeTitle}</h1>
                          <table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:25px 0 26px;border-collapse:collapse;"><tr><td bgcolor="#b53c20" width="52" height="3" style="width:52px;height:3px;background-color:#b53c20;font-size:1px;line-height:1px;">&nbsp;</td></tr></table>
                          <div class="uvh-mail-copy" style="color:#44483e;font-family:Manrope,Arial,Helvetica,sans-serif;font-size:15px;line-height:1.7;">{$body}</div>
                        </td></tr>
                        <tr><td class="uvh-mail-footer" style="padding:22px 42px 25px;border-top:1px solid #cecec0;color:#626357;font-family:Manrope,Arial,Helvetica,sans-serif;font-size:12px;line-height:1.6;">
                          Este correo se envió por una acción relacionada con UVH. Si necesitas ayuda, visita <a href="{$helpUrl}" style="color:#b53c20;text-decoration:underline;">el centro de ayuda</a>.
                        </td></tr>
                      </table>
                    </td></tr>
                    <tr><td style="padding:20px 2px 0;color:#626357;font-family:Manrope,Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;">UVH / Enlaces con recorrido.</td></tr>
                  </table>
                  <!--[if mso]></td></tr></table><![endif]-->
                </td></tr>
              </table>
            </body>
            </html>
            HTML;
    }

    private static function action(string $url, string $label, bool $destructive = false): string
    {
        $color = $destructive ? '#b12e30' : '#b53c20';

        return '<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="border-collapse:collapse;">'
            .'<tr><td height="20" style="height:20px;font-size:1px;line-height:20px;">&nbsp;</td></tr>'
            .'<tr><td bgcolor="'.$color.'" style="background-color:'.$color.';border-radius:3px;padding:14px 20px;">'
            .'<a href="'.self::esc($url).'" style="color:#fffcf5;font-family:Manrope,Arial,Helvetica,sans-serif;font-size:14px;line-height:1.35;font-weight:700;text-decoration:none;">'.self::esc($label).'</a>'
            .'</td></tr>'
            .'<tr><td height="20" style="height:20px;font-size:1px;line-height:20px;">&nbsp;</td></tr>'
            .'</table>';
    }

    private static function fallbackUrl(string $url): string
    {
        $safeUrl = self::esc($url);

        return '<p style="margin:0;color:#626357;font-size:12px;line-height:1.6;">Si el botón no funciona, copia este enlace:<br><a href="'.$safeUrl.'" style="color:#b53c20;text-decoration:underline;overflow-wrap:anywhere;word-break:break-all;">'.$safeUrl.'</a></p>';
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
