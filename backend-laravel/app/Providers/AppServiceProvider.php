<?php

namespace App\Providers;

use App\Support\OperationalMetrics;
use App\Support\ProductionSecurity;
use App\Support\UvhRequest;
use Illuminate\Cache\RateLimiting\Limit;
use Illuminate\Http\Request;
use Illuminate\Support\Facades\Cache;
use Illuminate\Support\Facades\Queue;
use Illuminate\Support\Facades\RateLimiter;
use Illuminate\Support\ServiceProvider;

class AppServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        //
    }

    public function boot(): void
    {
        $this->assertProductionSecurityConfiguration();

        // A throttled shared heartbeat proves that a real queue worker is
        // looping, even when the queue is empty. It contains no job payload or
        // account identifier and avoids writing to a database cache each loop.
        Queue::looping(function (): void {
            static $lastHeartbeat = 0;
            if (time() - $lastHeartbeat < 30) {
                return;
            }
            try {
                if (Cache::put('uvh:health:queue', time(), now()->addMinutes(10)) !== true) {
                    throw new \RuntimeException('Queue heartbeat cache write failed');
                }
                $lastHeartbeat = time();
            } catch (\Throwable) {
                OperationalMetrics::increment('lock.unavailable');
            }
        });

        RateLimiter::for('uvh-login', function (Request $request) {
            $identity = hash('sha256', strtolower(trim(UvhRequest::inputString($request, 'email'))));
            $response = fn ($request, $headers) => response()->json(['error' => 'Demasiados intentos. Espera unos minutos.'], 429)->withHeaders($headers);

            return [
                Limit::perMinutes(15, 60)->by('login-ip:'.$request->ip())->response($response),
                Limit::perMinutes(15, (int) config('uvh.rate_limits.auth'))->by('login-account:'.$identity)->response($response),
            ];
        });

        RateLimiter::for('uvh-mfa', function (Request $request) {
            $challenge = hash('sha256', UvhRequest::inputString($request, 'challenge'));
            $response = fn ($request, $headers) => response()->json(['error' => 'Demasiados intentos MFA. Espera unos minutos.'], 429)->withHeaders($headers);

            return [
                Limit::perMinutes(15, 30)->by('mfa-ip:'.$request->ip())->response($response),
                Limit::perMinutes(15, (int) config('uvh.rate_limits.auth'))->by('mfa-challenge:'.$challenge)->response($response),
            ];
        });

        RateLimiter::for('uvh-email-verify', function (Request $request) {
            // Token consumption has no email field. Keying every such request
            // by an empty email would create a global ten-request bucket and
            // let normal traffic deny verification for every account.
            $identity = $request->is('api/v1/auth/verify-email')
                || $request->is('api/v1/auth/confirm-email-change')
                || $request->is('api/v1/auth/data-export/confirm')
                || $request->is('api/v1/auth/data-export/download')
                || $request->is('api/v1/auth/account-deletion/confirm')
                || $request->is('api/v1/auth/account-deletion/cancel')
                ? 'token:'.hash('sha256', UvhRequest::inputString($request, 'token'))
                : 'account:'.hash('sha256', strtolower(trim(UvhRequest::inputString($request, 'email'))));
            $response = fn ($request, $headers) => response()->json(['error' => 'Demasiados intentos de verificación. Espera unos minutos.'], 429)->withHeaders($headers);

            return [
                Limit::perMinutes(15, 30)->by('verify-ip:'.$request->ip())->response($response),
                Limit::perMinutes(15, (int) config('uvh.rate_limits.auth'))->by('verify-account:'.$identity)->response($response),
            ];
        });

        RateLimiter::for('uvh-password-reset', function (Request $request) {
            // The request-email operation is limited by account; the bearer
            // consumption operation is limited by its own opaque token. This
            // avoids both a global empty-email bucket and user-controlled
            // extra fields being used to select another limiter key.
            $identity = $request->is('api/v1/auth/reset-password')
                ? 'token:'.hash('sha256', UvhRequest::inputString($request, 'token'))
                : 'account:'.hash('sha256', strtolower(trim(UvhRequest::inputString($request, 'email'))));
            $response = fn ($request, $headers) => response()->json(['error' => 'Demasiados intentos de recuperación. Espera unos minutos.'], 429)->withHeaders($headers);

            return [
                Limit::perMinutes(15, 30)->by('reset-ip:'.$request->ip())->response($response),
                Limit::perMinutes(15, (int) config('uvh.rate_limits.auth'))->by('reset-account:'.$identity)->response($response),
            ];
        });

        RateLimiter::for('uvh-security-incident', function (Request $request) {
            $token = hash('sha256', UvhRequest::inputString($request, 'token'));
            $response = fn ($request, $headers) => response()->json(['error' => 'Demasiados intentos. Espera unos minutos.'], 429)->withHeaders($headers);

            return [
                Limit::perMinutes(15, 30)->by('incident-ip:'.$request->ip())->response($response),
                Limit::perMinutes(15, 5)->by('incident-token:'.$token)->response($response),
            ];
        });

        RateLimiter::for('uvh-account-recovery', function (Request $request) {
            $requestPath = $request->path();
            $identity = str_ends_with($requestPath, '/request')
                ? 'account:'.hash('sha256', strtolower(trim(UvhRequest::inputString($request, 'email'))))
                : 'token:'.hash('sha256', UvhRequest::inputString($request, 'token'));
            $response = fn ($request, $headers) => response()->json(['error' => 'Demasiados intentos de recuperación. Espera unos minutos.'], 429)->withHeaders($headers);

            return [
                Limit::perMinutes(60, 20)->by('account-recovery-ip:'.$request->ip())->response($response),
                Limit::perMinutes(60, 5)->by('account-recovery:'.$identity)->response($response),
            ];
        });

        RateLimiter::for('uvh-credential', function (Request $request) {
            $session = UvhRequest::sessionId($request);

            return Limit::perMinutes(15, 10)
                ->by('credential:'.($session ?? $request->ip()).'|'.$request->ip())
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiados intentos de seguridad. Espera unos minutos.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-register', function (Request $request) {
            return Limit::perMinutes(60, (int) config('uvh.rate_limits.register'))
                ->by($request->ip())
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiados registros desde esta IP.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-link-create', function (Request $request) {
            return Limit::perMinute((int) config('uvh.rate_limits.link_create'))
                ->by($request->ip())
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiados enlaces en poco tiempo.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-resolve', function (Request $request) {
            return Limit::perMinute((int) config('uvh.rate_limits.resolve'))
                ->by($request->ip())
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiadas resoluciones de enlaces.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-report', function (Request $request) {
            return Limit::perMinute(10)
                ->by($request->ip())
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiadas denuncias.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-status', function (Request $request) {
            return Limit::perMinute(60)
                ->by($request->ip())
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiadas consultas de estado.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-health', function (Request $request) {
            return Limit::perMinute(120)
                ->by('health:'.$request->ip())
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiadas comprobaciones.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-api', function (Request $request) {
            return Limit::perMinute(120)
                ->by($request->ip())
                ->response(fn ($request, $headers) => response()->json(['error' => 'Rate limit de API excedido.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-activity', function (Request $request) {
            // One account allowance across workspaces and rotating sessions;
            // the existing independent IP limiter also applies to this route.
            $actor = UvhRequest::user($request);

            return Limit::perMinute(60)->by($actor ? 'user:'.$actor->id : 'ip:'.$request->ip())
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiadas consultas de actividad.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-usage', function (Request $request) {
            // Bound repeated aggregate scans across workspaces and sessions.
            $actor = UvhRequest::user($request);

            return Limit::perMinute(30)->by($actor ? 'user:'.$actor->id : 'ip:'.$request->ip())
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiadas consultas de uso.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-admin', function (Request $request) {
            return Limit::perMinute(60)
                ->by($request->ip())
                ->response(fn ($request, $headers) => response()->json(['error' => 'Rate limit administrativo.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-mail-retry', function (Request $request) {
            $session = UvhRequest::sessionId($request) ?? $request->ip();

            return Limit::perHour(10)
                ->by('mail-retry:'.$session.'|'.$request->ip())
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiados reintentos manuales de correo.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-privacy', function (Request $request) {
            $session = UvhRequest::sessionId($request) ?? $request->ip();

            return [
                Limit::perMinutes(60, 20)->by('privacy-session:'.$session)->response(
                    fn ($request, $headers) => response()->json(['error' => 'Demasiadas operaciones sobre solicitudes de privacidad.'], 429)->withHeaders($headers),
                ),
                Limit::perMinutes(60, 40)->by('privacy-ip:'.$request->ip()),
            ];
        });

        RateLimiter::for('uvh-privacy-admin', function (Request $request) {
            $session = UvhRequest::sessionId($request) ?? $request->ip();

            return Limit::perMinutes(60, 60)->by('privacy-admin:'.$session.'|'.$request->ip())
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiadas operaciones administrativas de privacidad.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-analytics', function (Request $request) {
            $session = UvhRequest::sessionId($request) ?? $request->ip();
            $workspace = (string) (UvhRequest::workspaceId($request) ?? 'none');

            return Limit::perMinute(60)
                ->by('analytics:'.$session.'|'.$workspace)
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiadas consultas de analítica. Espera un minuto.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-api-token', function (Request $request) {
            $token = $request->attributes->get('uvh.api_token');
            $key = $token ? 'token:'.$token['token_id'] : 'ip:'.$request->ip();

            return Limit::perMinute((int) config('uvh.rate_limits.api_token'))
                ->by($key)
                ->response(fn ($request, $headers) => response()->json(['error' => 'Rate limit de API excedido para este token.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-unlock', function (Request $request) {
            // The same alias may legitimately exist on many custom domains.
            // Include the normalized host so one NATed client cannot consume
            // another domain's password budget by collision alone.
            $key = $request->ip().'|'.strtolower($request->getHost()).'|'.($request->route('alias') ?? '');

            return Limit::perMinute(10)
                ->by($key)
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiados intentos para este enlace.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-domain-dns', function (Request $request) {
            $session = UvhRequest::sessionId($request) ?? $request->ip();
            $domainId = (string) ($request->route('id') ?? 'new');

            return Limit::perMinute(6)
                ->by('domain-dns:'.$session.'|'.$domainId)
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiadas comprobaciones DNS. Espera un minuto antes de reintentar.'], 429)->withHeaders($headers));
        });

        RateLimiter::for('uvh-invitation', function (Request $request) {
            // Sessions rotate on login and cannot define an account's budget.
            // Both routes receive the SAME actor/workspace key; neither a new
            // cookie nor another invitation ID provides another allowance.
            $actor = UvhRequest::user($request);
            $identity = $actor ? 'user:'.$actor->id : 'ip:'.$request->ip();
            // The controller receives an integer, but route parameters are raw
            // strings: /1 and /01 must not split the same workspace's budget.
            $workspace = ltrim((string) ($request->route('id') ?? '0'), '0') ?: '0';

            return Limit::perMinutes(15, 20)
                ->by('invitation:'.$identity.'|workspace:'.$workspace)
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiadas invitaciones o reenvíos. Espera unos minutos.'], 429)->withHeaders($headers));
        });

        // Las pruebas y reintentos disparan trabajo de red asíncrono. Se
        // limitan por sesión y workspace para que una cuenta con permisos de
        // edición no pueda llenar la cola con pings o reenvíos manuales.
        RateLimiter::for('uvh-webhook-action', function (Request $request) {
            $session = UvhRequest::sessionId($request) ?? $request->ip();
            $workspace = (string) (UvhRequest::workspaceId($request) ?? 'none');

            return Limit::perMinutes(15, 30)
                ->by('webhook-action:'.$session.'|'.$workspace)
                ->response(fn ($request, $headers) => response()->json(['error' => 'Demasiadas pruebas o reenvíos de webhooks. Espera unos minutos.'], 429)->withHeaders($headers));
        });
    }

    private function assertProductionSecurityConfiguration(): void
    {
        if (! app()->environment('production')) {
            return;
        }

        $errors = ProductionSecurity::errors([
            'app_key' => config('app.key'),
            'cipher' => config('app.cipher'),
            'app_secret' => config('uvh.secret'),
            'app_secret_previous' => config('uvh.secret_previous'),
            'app_secret_rotation_until' => config('uvh.secret_rotation_until'),
            'debug' => config('app.debug'),
            'app_url' => config('app.url'),
            'metrics_bearer_token' => config('uvh.metrics.bearer_token'),
            'app_host' => config('uvh.app_host'),
            'public_host' => config('uvh.public_host'),
            'cookie_secure' => config('uvh.cookie_secure'),
            'cookie_domain' => config('uvh.cookie_domain'),
            'session_cookie' => config('uvh.session_cookie'),
            'csrf_cookie' => config('uvh.csrf_cookie'),
            'hsts_enabled' => config('uvh.hsts_enabled'),
            'session_ttl_days' => config('uvh.session_ttl_days'),
            'admin_mfa_fresh_minutes' => config('uvh.admin_mfa_fresh_minutes'),
            'bcrypt_rounds' => config('hashing.bcrypt.rounds'),
            'hcaptcha_site_key' => config('uvh.hcaptcha.site_key'),
            'hcaptcha_secret' => config('uvh.hcaptcha.secret'),
            'hcaptcha_public_site_key' => config('uvh.hcaptcha.public_site_key'),
            'hcaptcha_public_secret' => config('uvh.hcaptcha.public_secret'),
            'hcaptcha_connect_timeout' => config('uvh.hcaptcha.connect_timeout_seconds'),
            'hcaptcha_timeout' => config('uvh.hcaptcha.timeout_seconds'),
            'auth_limit' => config('uvh.rate_limits.auth'),
            'register_limit' => config('uvh.rate_limits.register'),
            'link_create_limit' => config('uvh.rate_limits.link_create'),
            'resolve_limit' => config('uvh.rate_limits.resolve'),
            'api_token_limit' => config('uvh.rate_limits.api_token'),
            'trusted_proxies' => config('uvh.trusted_proxies'),
            'db_connection' => config('database.default'),
            'db_sslmode' => config('database.connections.pgsql.sslmode'),
            'db_sslrootcert' => config('database.connections.pgsql.sslrootcert'),
            'db_sslrootcert_readable' => is_readable((string) config('database.connections.pgsql.sslrootcert')),
            'db_username' => config('database.connections.pgsql.username'),
            'db_password' => config('database.connections.pgsql.password'),
            'cache_store' => config('cache.default'),
            'queue_connection' => config('queue.default'),
            'queue_retry_after' => config('queue.connections.'.config('queue.default').'.retry_after'),
            'queue_failed_driver' => config('queue.failed.driver'),
            'custom_domain_cname_target' => config('uvh.custom_domains.cname_target'),
            'edge_ask_secret' => config('uvh.custom_domains.edge_ask_secret'),
            'acme_email' => config('uvh.custom_domains.acme_email'),
            'edge_internal_host' => config('uvh.custom_domains.edge_internal_host'),
            'edge_internal_cidrs' => config('uvh.custom_domains.edge_internal_cidrs'),
            'domain_verification_fresh_hours' => config('uvh.custom_domains.verification_fresh_hours'),
            'domain_revalidation_hours' => config('uvh.custom_domains.revalidation_hours'),
            'domain_failure_retry_hours' => config('uvh.custom_domains.failure_retry_hours'),
            'domain_failure_grace_hours' => config('uvh.custom_domains.failure_grace_hours'),
            'domain_max_failures' => config('uvh.custom_domains.max_failures'),
            'mail_config' => config('mail'),
            'resend_key' => config('services.resend.key'),
            'mail_from_address' => config('mail.from.address'),
            'housekeeping_interval_minutes' => config('uvh.housekeeping.interval_minutes'),
            'session_purge_days' => config('uvh.housekeeping.session_purge_days'),
            'token_purge_days' => config('uvh.housekeeping.token_purge_days'),
            'api_token_purge_days' => config('uvh.housekeeping.api_token_purge_days'),
            'delivery_purge_days' => config('uvh.housekeeping.delivery_purge_days'),
            'failed_job_purge_days' => config('uvh.housekeeping.failed_job_purge_days'),
            'mail_outbox_purge_days' => config('uvh.housekeeping.mail_outbox_purge_days'),
            'account_recovery_purge_days' => config('uvh.housekeeping.account_recovery_purge_days'),
            'operational_metrics_purge_days' => config('uvh.housekeeping.operational_metrics_purge_days'),
            'privacy_request_purge_days' => config('uvh.housekeeping.privacy_request_purge_days'),
            'export_purge_days' => config('uvh.housekeeping.export_purge_days'),
            'audit_purge_days' => config('uvh.housekeeping.audit_purge_days'),
            'analytics_retention_days' => config('uvh.housekeeping.analytics_retention_days'),
        ]);

        if ($errors !== []) {
            throw new \RuntimeException('Configuración de seguridad de producción inválida: '.implode('; ', $errors));
        }
    }
}
