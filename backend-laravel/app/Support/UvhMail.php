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
                'language' => Language::current(),
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

    public static function verification(string $to, string $url, string $tokenHash, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $url, $tokenHash): bool {
            $url = FrontendUrl::localiseExistingPage($url);
            $link = self::action($url, __('mail.bd86c8e460acaf'));

            return self::send(
                'verification',
                $to,
                __('mail.11d99283383ab7'),
                self::layout(__('mail.fb38b0e95c59d6'), __('mail.ebf5c152761273', ['value0' => $link, 'value1' => self::fallbackUrl($url)])),
                __('mail.ff2c064b5529d0', ['value0' => $url]),
                'email_token',
                $tokenHash,
                $tokenHash,
            );
        }, $language);
    }

    public static function resetPassword(string $to, string $url, string $tokenHash, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $url, $tokenHash): bool {
            $url = FrontendUrl::localiseExistingPage($url);
            $link = self::action($url, __('mail.eb82890e469c8e'));

            return self::send(
                'password_reset',
                $to,
                __('mail.61f18be46ba65c'),
                self::layout(__('mail.eb82890e469c8e'), __('mail.c958f6c265d939', ['value0' => $link])),
                __('mail.69872333831cce', ['value0' => $url]),
                'email_token',
                $tokenHash,
                $tokenHash,
            );
        }, $language);
    }

    public static function passwordChanged(string $to, string $incidentUrl, string $tokenHash, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $incidentUrl, $tokenHash): bool {
            $incidentUrl = FrontendUrl::localiseExistingPage($incidentUrl);
            $link = self::action($incidentUrl, __('mail.e41afec51f17a8'), true);

            return self::send(
                'password_changed',
                $to,
                __('mail.4574133828e2a9'),
                self::layout(__('mail.f29a5970a4ab27'), __('mail.b565385a34f726', ['value0' => $link])),
                __('mail.17638bd9e27c9a', ['value0' => $incidentUrl]),
                'email_token',
                $tokenHash,
                $tokenHash,
            );
        }, $language);
    }

    /**
     * Cierre masivo de sesiones. Comparte el portador de incidente del cambio
     * de contraseña: si no reconoces el cierre, el mismo control de emergencia
     * sigue disponible durante las próximas 24 horas.
     */
    public static function sessionRevoked(string $to, string $incidentUrl, string $tokenHash, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $incidentUrl, $tokenHash): bool {
            $incidentUrl = FrontendUrl::localiseExistingPage($incidentUrl);
            $body = __('mail.d96948311e4e36');

            return self::send('session_revoked', $to, __('mail.1c9a409e18d9db'),
                self::layout(__('mail.eef3d770790a42'), $body.self::action($incidentUrl, __('mail.4baad953428ea8'), true)),
                __('mail.3fd60c0c932664', ['value0' => $incidentUrl]),
                'email_token', $tokenHash, $tokenHash);
        }, $language);
    }

    public static function operationalNotice(string $to, string $kind, string $subject, ?string $linkUrl = null, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $kind, $subject, $linkUrl): bool {
            $linkUrl = $linkUrl !== null ? FrontendUrl::localiseExistingPage($linkUrl) : null;
            $title = NotificationKinds::all()[$kind]['title'];

            if ($linkUrl !== null && ! UrlUtil::validateDestination($linkUrl)['ok']) {
                throw new \InvalidArgumentException('Operational action URL must be HTTP/HTTPS.');
            }
            $action = $linkUrl !== null ? self::action($linkUrl, __('mail.9526f43fc9a3d4')).self::fallbackUrl($linkUrl) : __('mail.e33539abb6796c');
            $text = $linkUrl !== null ? __('mail.ef89117e39ea17', ['value0' => $linkUrl]) : __('mail.22b24cb6241352');

            return self::send($kind, $to, __('mail.b4aa6ccb87493f', ['value0' => $title]),
                self::layout($title, '<p>'.self::esc($subject).'</p>'.$action),
                $title.'. '.$subject.'.'.$text);
        }, $language);
    }

    public static function sessionsRevoked(string $to, string $incidentUrl, string $tokenHash, bool $all, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $incidentUrl, $tokenHash, $all): bool {
            $incidentUrl = FrontendUrl::localiseExistingPage($incidentUrl);
            $link = self::action($incidentUrl, __('mail.e41afec51f17a8'), true);
            $body = $all
                ? __('mail.c8f57c78673200')
                : __('mail.120af8c3965030');

            return self::send(
                $all ? 'sessions_revoked_all' : 'sessions_revoked_others',
                $to,
                $all ? __('mail.15a753cbed744f') : __('mail.6582ed0540836d'),
                self::layout(
                    $all ? __('mail.79abbc7f0fe148') : __('mail.18a8b6f741d954'),
                    __('mail.4d50412690a50f', ['value0' => $body, 'value1' => $link]),
                ),
                __('mail.1cf1b241f15370', ['value0' => $all ? __('mail.5c129c53fa9334') : __('mail.ef7cb61e928c5c'), 'value1' => $incidentUrl]),
                'email_token',
                $tokenHash,
                $tokenHash,
            );
        }, $language);
    }

    public static function accountRecoveryConfirmation(string $to, string $url, int $requestId, string $generationHash, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $url, $requestId, $generationHash): bool {
            $url = FrontendUrl::localiseExistingPage($url);
            $link = self::action($url, __('mail.59819917352318'));

            return self::send(
                'account_recovery_confirmation',
                $to,
                __('mail.23a62af0311141'),
                self::layout(__('mail.5e04be35224e3a'), __('mail.a6c260d5226cd3', ['value0' => $link])),
                __('mail.1767656536baf0', ['value0' => $url]),
                'account_recovery',
                $requestId,
                $generationHash,
            );
        }, $language);
    }

    public static function accountRecoveryApproved(string $to, string $url, int $requestId, string $generationHash, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $url, $requestId, $generationHash): bool {
            $url = FrontendUrl::localiseExistingPage($url);
            $link = self::action($url, __('mail.15f917088f1f12'));

            return self::send(
                'account_recovery_approved',
                $to,
                __('mail.d5b22c919fdfa9'),
                self::layout(__('mail.ffe678fe89a37e'), __('mail.e94dbd1b620e68', ['value0' => $link])),
                __('mail.f8d85239ff3672', ['value0' => $url]),
                'account_recovery',
                $requestId,
                $generationHash,
            );
        }, $language);
    }

    public static function accountRecoveryRejected(string $to, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to): bool {
            return self::send(
                'account_recovery_rejected',
                $to,
                __('mail.77603f74528737'),
                self::layout(__('mail.38cae3981dd477'), __('mail.1d3546469c1155')),
                __('mail.948f6fd7d93e58'),
            );
        }, $language);
    }

    public static function emailChangeVerification(string $to, string $url, string $tokenHash, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $url, $tokenHash): bool {
            $url = FrontendUrl::localiseExistingPage($url);
            $link = self::action($url, __('mail.f55fa997596b2c'));

            return self::send(
                'email_change_verification',
                $to,
                __('mail.c07d65bd598d0a'),
                self::layout(__('mail.b03dea5d65bc4f'), __('mail.883a3de43930f6', ['value0' => $link, 'value1' => self::fallbackUrl($url)])),
                __('mail.f6ee3e64fdc10d', ['value0' => $url]),
                'email_change',
                $tokenHash,
                $tokenHash,
            );
        }, $language);
    }

    public static function emailChangeRequested(string $to, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to): bool {
            return self::send(
                'email_change_requested',
                $to,
                __('mail.c61bc09d661b66'),
                self::layout(__('mail.9a841a4a6d15ca'), __('mail.070afb5b7038b8')),
                __('mail.2fc58aa9a9b258'),
            );
        }, $language);
    }

    public static function emailChanged(string $to, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to): bool {
            return self::send(
                'email_changed',
                $to,
                __('mail.eac698eb4b8ec9'),
                self::layout(__('mail.83c1c60c444173'), __('mail.df154033470cbf')),
                __('mail.37779bbe61e79d'),
            );
        }, $language);
    }

    /**
     * Aviso, no portador: la descarga se autoriza con la sesión y un step-up
     * reciente, así que este enlace sólo navega hasta la sección de
     * exportaciones. `$generationHash` identifica la generación anunciada para
     * que el outbox descarte avisos de una exportación que ya no está viva.
     */
    public static function dataExportReady(string $to, string $url, string $expiresOn, int $requestId, string $generationHash, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $url, $expiresOn, $requestId, $generationHash): bool {
            $url = FrontendUrl::localiseExistingPage($url);
            $link = self::action($url, __('mail.d3ad2c4ad7fe6e'));

            return self::send(
                'data_export_ready',
                $to,
                __('mail.f6d74f577ff3cf'),
                self::layout(__('mail.dc77749fc2ab7c'), __('mail.1098283fc4827e', ['value0' => $link, 'value1' => self::esc($expiresOn)])),
                __('mail.020e8c0eb33121', ['value0' => $url, 'value1' => $expiresOn]),
                'data_export',
                $requestId,
                $generationHash,
            );
        }, $language);
    }

    public static function accountDeletionConfirmation(string $to, string $url, int $requestId, string $generationHash, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $url, $requestId, $generationHash): bool {
            $url = FrontendUrl::localiseExistingPage($url);
            $link = self::action($url, __('mail.518476549fddc8'), true);

            return self::send(
                'account_deletion_confirmation',
                $to,
                __('mail.0b81e3d8c4eed8'),
                self::layout(__('mail.ced39e05c91ed7'), __('mail.bdaa091b7aa788', ['value0' => $link])),
                __('mail.aae9c0bbe67868', ['value0' => $url]),
                'account_deletion',
                $requestId,
                $generationHash,
            );
        }, $language);
    }

    public static function accountDeletionScheduled(string $to, string $cancelUrl, string $executeAt, int $requestId, string $generationHash, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $cancelUrl, $executeAt, $requestId, $generationHash): bool {
            $cancelUrl = FrontendUrl::localiseExistingPage($cancelUrl);
            $link = self::action($cancelUrl, __('mail.c5a8f91a675f5c'));

            return self::send(
                'account_deletion_scheduled',
                $to,
                __('mail.bde50519c1d670'),
                self::layout(__('mail.336f99f7165207'), __('mail.386ec9fa5a67a8', ['value0' => self::esc($executeAt), 'value1' => $link])),
                __('mail.67cdfe3f24e5a4', ['value0' => $executeAt, 'value1' => $cancelUrl]),
                'account_deletion',
                $requestId,
                $generationHash,
            );
        }, $language);
    }

    public static function accountDeletionCancelled(string $to, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to): bool {
            return self::send(
                'account_deletion_cancelled',
                $to,
                __('mail.0a3a9eaff1ccf3'),
                self::layout(__('mail.dc871d829e4a71'), __('mail.86a8d447e71543')),
                __('mail.c22e0532618fa8'),
            );
        }, $language);
    }

    public static function privacyRequestReceived(string $to, int $requestId, string $generationHash, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $requestId, $generationHash): bool {
            return self::send(
                'privacy_request_received',
                $to,
                __('mail.6c331346dbe491'),
                self::layout(__('mail.73685e69a162a2'), __('mail.6c57826a09b817')),
                __('mail.c191d2b8ba7790'),
                'privacy_right',
                $requestId,
                $generationHash,
            );
        }, $language);
    }

    public static function privacyRequestUpdated(string $to, int $requestId, string $status, string $generationHash, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $requestId, $status, $generationHash): bool {
            $copy = match ($status) {
                'in_progress' => [__('mail.485cf5e4b2d570'), __('mail.76df87bc3335c0')],
                'waiting_user' => [__('mail.54564ec8257a68'), __('mail.bce3b3f47adabb')],
                'completed' => [__('mail.d11bb343abe15d'), __('mail.44c469d372a0d0')],
                'rejected' => [__('mail.b43b6bc7f752d4'), __('mail.91f800c9f7e1ab')],
                'cancelled' => [__('mail.e075f56997a31c'), __('mail.3d9bb9204818a6')],
                'extended' => [__('mail.8a664f5866bb54'), __('mail.ff6e079c828c2a')],
                default => [__('mail.0ccc7f803e3d3f'), __('mail.f41f23c5ae5371')],
            };

            return self::send(
                'privacy_request_updated',
                $to,
                __('mail.3f5b6194c4165c'),
                self::layout($copy[0], __('mail.5684e9ddb485e6', ['value0' => self::esc($copy[1])])),
                __('mail.7a998618af243b', ['value0' => $copy[1]]),
                'privacy_right',
                $requestId,
                $generationHash,
            );
        }, $language);
    }

    public static function workspaceOwnershipTransferred(string $to, string $workspace, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $workspace): bool {
            return self::send(
                'workspace_ownership_transfer',
                $to,
                __('mail.3a40bee4075817'),
                self::layout(__('mail.267302ff0ad847'), __('mail.8fe322333c8973', ['value0' => self::esc($workspace)])),
                __('mail.5eba5472eed7dc', ['value0' => $workspace]),
            );
        }, $language);
    }

    public static function mfaEnabled(string $to, bool $reconfigured, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $reconfigured): bool {
            $title = $reconfigured ? __('mail.1192453cc0516f') : __('mail.a85a84667a9d34');
            $body = $reconfigured
                ? __('mail.0611521766cdf9')
                : __('mail.71a8124ccfba0f');

            return self::send(
                $reconfigured ? 'mfa_reconfigured' : 'mfa_enabled',
                $to,
                $reconfigured ? __('mail.4dae83809c3036') : __('mail.9df17d944f8c3d'),
                self::layout($title, __('mail.f30a72a4b41e32', ['value0' => $body])),
                $reconfigured
                    ? __('mail.68c8e23781dae3')
                    : __('mail.41b81f625dda2c'),
            );
        }, $language);
    }

    public static function mfaRecoveryCodesRegenerated(string $to, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to): bool {
            return self::send(
                'mfa_recovery_codes_regenerated',
                $to,
                __('mail.18b29580a38bcf'),
                self::layout(__('mail.57d7454459fc34'), __('mail.803cbe1e4307d6')),
                __('mail.cc0ec898b7e91f'),
            );
        }, $language);
    }

    public static function mfaDisabled(string $to, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to): bool {
            return self::send(
                'mfa_disabled',
                $to,
                __('mail.eae9b8e56bf305'),
                self::layout(__('mail.621729cd57ee73'), __('mail.b222de2b9f3bfb')),
                __('mail.e36e02a7553366'),
            );
        }, $language);
    }

    public static function apiTokenCreated(string $to, string $name, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $name): bool {
            return self::send(
                'api_token_created',
                $to,
                __('mail.13a644d0deead0'),
                self::layout(__('mail.9fa4142dbbb660'), __('mail.055e08669d0239', ['value0' => self::esc($name)])),
                __('mail.1d396be470de4f', ['value0' => $name]),
            );
        }, $language);
    }

    public static function workspaceDeleted(string $to, string $workspace, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $workspace): bool {
            return self::send(
                'workspace_deleted',
                $to,
                __('mail.411ea6531075c5'),
                self::layout(__('mail.126bbfe013a993'), __('mail.f8d0b288f8b3a1', ['value0' => self::esc($workspace)])),
                __('mail.8edc14194721ac', ['value0' => $workspace]),
            );
        }, $language);
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
        string $eventGeneration, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $kind, $domain, $domainId, $reason, $userId, $eventGeneration): bool {
            [$subject, $title, $body, $text] = match ($kind) {
                'domain_offline' => [
                    __('mail.db5c1455a7787d', ['value0' => $domain]),
                    __('mail.7650a8f8c6220f'),
                    __('mail.5cb9f509272edd', ['value0' => self::esc($domain), 'value1' => self::esc($reason)]),
                    __('mail.1caad5834accfb', ['value0' => $domain, 'value1' => $reason]),
                ],
                'domain_dns_degraded' => [
                    __('mail.9bce2752d9aca6', ['value0' => $domain]),
                    __('mail.db7894c61e9112'),
                    __('mail.5d5f89abf3e2e6', ['value0' => self::esc($domain), 'value1' => self::esc($reason)]),
                    __('mail.e48e301ed6712b', ['value0' => $domain, 'value1' => $reason]),
                ],
                'domain_recovered' => [
                    __('mail.cde46764a34283', ['value0' => $domain]),
                    __('mail.f1e87a40563426'),
                    __('mail.583d11573e2c56', ['value0' => self::esc($domain)]),
                    __('mail.a3ff902ee428ff', ['value0' => $domain]),
                ],
                'domain_tls_failed' => [
                    __('mail.568332979fef0c', ['value0' => $domain]),
                    __('mail.bdf3f906994c91'),
                    __('mail.799538bf210656', ['value0' => self::esc($domain), 'value1' => self::esc($reason)]),
                    __('mail.0f7504c016bb36', ['value0' => $domain, 'value1' => $reason]),
                ],
                'domain_tls_expiring' => [
                    __('mail.a4091b127bb368', ['value0' => $domain]),
                    __('mail.f06cec03c33d18'),
                    __('mail.e22ddc98535504', ['value0' => self::esc($domain)]),
                    __('mail.9a2ce6f1d44e26', ['value0' => $domain]),
                ],
                'domain_claim_transferred' => [
                    __('mail.fdc144158ff0f1', ['value0' => $domain]),
                    __('mail.50e3299d0fe024'),
                    __('mail.05e72d039bcde7', ['value0' => self::esc($domain), 'value1' => self::esc($reason)]),
                    __('mail.8059de355f1c58', ['value0' => $domain, 'value1' => $reason]),
                ],
                default => [
                    __('mail.4674994e3cfa13'),
                    __('mail.73dba5683a7590'),
                    __('mail.aedc75d9c9c0f1', ['value0' => self::esc($domain)]),
                    __('mail.4e67aa03e089a3', ['value0' => $domain]),
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
        }, $language);
    }

    /**
     * El resumen diario del centro de notificaciones. Sin recurso asociado: es
     * un aviso de la propia cuenta, siempre vigente, que sólo lista títulos y
     * rutas internas — nunca secretos, URLs bearer ni contenido ajeno.
     */
    public static function notificationDigest(string $to, string $summaryHtml, string $summaryText, int $userId, string $generation, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $summaryHtml, $summaryText, $userId, $generation): bool {
            // Identidad de lifecycle determinista (cuenta + claim exacto): el mismo
            // resumen reintentado tras un crash choca en la misma clave del outbox
            // y se descarta en vez de duplicar el correo.
            return self::send(
                'notification_digest',
                $to,
                __('mail.8964b11eccc7a5'),
                self::layout(__('mail.28bd330404f2f1'), $summaryHtml),
                $summaryText,
                'notification',
                $userId,
                $generation,
            );
        }, $language);
    }

    public static function invitation(
        string $to,
        string $url,
        string $workspace,
        string $role,
        int $invitationId,
        string $generationHash, ?string $language = null): bool
    {
        return MailLanguage::render($to, function () use ($to, $url, $workspace, $role, $invitationId, $generationHash): bool {
            $url = FrontendUrl::localiseExistingPage($url);
            $link = self::action($url, __('mail.fc34097a035972'));

            return self::send(
                'invitation',
                $to,
                __('mail.b6dcdb3919b17a'),
                self::layout(__('mail.5f18ddf367ff1a'), __('mail.8602d806c7283c', ['value0' => self::esc($workspace), 'value1' => self::esc($role), 'value2' => $link])),
                __('mail.07e928f19503bd', ['value0' => $workspace, 'value1' => $role, 'value2' => $url]),
                'invitation',
                $invitationId,
                $generationHash,
            );
        }, $language);
    }

    private static function layout(string $title, string $body): string
    {
        $safeTitle = self::esc($title);
        $helpUrl = self::esc(FrontendUrl::page('/help'));
        $language = Language::current() === 'en' ? 'en-GB' : 'es-ES';
        $tagline = self::esc(__('mail.layout_tagline'));
        $footer = self::esc(__('mail.layout_footer'));
        $helpLabel = self::esc(__('mail.layout_help'));

        // Tables and inline styles keep the hierarchy intact in Gmail, Apple
        // Mail and Outlook. No remote fonts or images are needed to read it.
        return <<<HTML
            <!doctype html>
            <html lang="{$language}">
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
                          <td align="right" valign="bottom" style="color:#626357;font-family:Georgia,serif;font-size:13px;font-style:italic;line-height:1.4;">{$tagline}</td>
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
                          {$footer} <a href="{$helpUrl}" style="color:#b53c20;text-decoration:underline;">{$helpLabel}</a>.
                        </td></tr>
                      </table>
                    </td></tr>
                    <tr><td style="padding:20px 2px 0;color:#626357;font-family:Manrope,Arial,Helvetica,sans-serif;font-size:11px;line-height:1.5;">UVH / {$tagline}</td></tr>
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

        return __('mail.dcc3dc0e2e794c', ['value0' => $safeUrl, 'value1' => $safeUrl]);
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
