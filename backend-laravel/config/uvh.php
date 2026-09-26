<?php

use App\Support\AccountExportDocument;

return [
    'metrics' => [
        'bearer_token' => env('METRICS_BEARER_TOKEN', ''),
    ],
    // Secreto de firma de sesión y cifrado at-rest. En producción es obligatorio.
    'secret' => env('APP_SECRET'),
    // Claves anteriores, separadas por comas, disponibles únicamente durante
    // una rotación controlada. Nunca se usan para cifrar datos nuevos.
    'secret_previous' => array_values(array_filter(array_map(
        'trim',
        explode(',', (string) env('APP_SECRET_PREVIOUS', '')),
    ))),
    // Deadline ISO-8601 obligatorio mientras exista una clave anterior. El
    // gate de producción impide conservar indefinidamente un keyring ampliado.
    'secret_rotation_until' => env('APP_SECRET_ROTATION_UNTIL', ''),
    'public_host' => env('PUBLIC_HOST', 'uvh.es'),
    // Full origin used only to generate default short URLs. Production's
    // startup gate requires its exact PUBLIC_HOST over HTTPS.
    'public_origin' => env('PUBLIC_ORIGIN', 'https://'.env('PUBLIC_HOST', 'uvh.es')),
    'queue_pool' => env('UVH_QUEUE_POOL', ''),
    'legal' => [
        // Public legal identity. Production refuses to boot while any required
        // value is absent or still a placeholder; never guess these values.
        'name' => env('LEGAL_ENTITY_NAME'),
        'tax_id' => env('LEGAL_TAX_ID'),
        'address' => env('LEGAL_ADDRESS'),
        'registry' => env('LEGAL_REGISTRY_DETAILS'),
        'hosting_provider' => env('LEGAL_HOSTING_PROVIDER'),
        'hosting_region' => env('LEGAL_HOSTING_REGION'),
    ],
    'app_host' => env('APP_HOST', parse_url((string) env('APP_URL', 'http://localhost:8000'), PHP_URL_HOST) ?: 'app.uvh.es'),
    'session_cookie' => env('SESSION_COOKIE', 'uvh_session'),
    'csrf_cookie' => env('CSRF_COOKIE', 'uvh_csrf'),
    // Handoff bearers (an invitation link, a link prepared before signing in)
    // are parked in HttpOnly cookies instead of localStorage. Same naming rules
    // as the session cookie: host-only, `__Host-` in production, and never a
    // shared parent domain.
    'invitation_cookie' => env('PENDING_INVITATION_COOKIE', 'uvh_pending_invitation'),
    'intent_cookie' => env('PENDING_INTENT_COOKIE', 'uvh_pending_intent'),
    // El secreto de edición de un registro sin verificar: acredita que quien
    // corrige la dirección es el navegador que la registró. La contraseña de la
    // inscripción no sirve para eso —cualquier registro anónimo escribe una—, así
    // que la corrección necesita un testigo que el navegador no pueda fabricar.
    'registration_edit_cookie' => env('REGISTRATION_EDIT_COOKIE', 'uvh_registration_edit'),
    // Vida del secreto y techo de su cookie. Nunca más que el bearer de
    // verificación que el registro emite a la vez (un día).
    'registration_edit_ttl_hours' => (int) env('REGISTRATION_EDIT_TTL_HOURS', 24),
    // Piso de duración, en milisegundos, de toda respuesta `ok` del reenvío
    // público de verificación. La rama que conoce el registro hace trabajo real
    // (transacción, token, outbox) y la que no contesta de inmediato: sin este
    // piso, la latencia es un oráculo de «¿tiene registro pendiente?». Todas
    // las ramas se amortiguan hasta el mismo suelo, y el valor no es superficie
    // de operador: bajarlo reabriría el oráculo que existe para cerrar.
    'resend_verification_min_duration_ms' => (int) env('RESEND_VERIFICATION_MIN_DURATION_MS', 250),
    // Techo operativo del documento de una exportación automática, en bytes de
    // texto plano. No es un límite de producto —la generación por bloques no
    // tiene el tope de filas ni el de 12 MiB de antes—: protege el volumen
    // privado y el worker compartido de un documento desmedido. Se clampa hacia
    // arriba y hacia abajo: un valor por debajo de 1 KiB no es una configuración
    // sino un error, y el máximo absoluto es el que la capa de documento trae.
    // El defecto va como literal (268435456 = 256 MiB) para que el contrato de
    // la plantilla pueda compararlo sin evaluar PHP.
    'export_max_plaintext_bytes' => min(
        AccountExportDocument::MAX_PLAINTEXT_BYTES,
        max(1024, (int) env('EXPORT_MAX_PLAINTEXT_BYTES', 268435456)),
    ),
    'trusted_proxies' => env('TRUSTED_PROXIES', ''),
    'session_ttl_days' => (int) env('SESSION_TTL_DAYS', 30),
    // Vida de una invitación, y techo de la cookie que la aparca: el aparcadero
    // nunca dura más que la credencial que transporta. El mismo valor que usa
    // el controlador al crear la invitación.
    'invitation_ttl_days' => (int) env('INVITATION_TTL_DAYS', 7),
    // Vida de un link intent en el servidor, y techo de su cookie.
    'intent_ttl_hours' => (int) env('INTENT_TTL_HOURS', 24),
    // Privileged administration requires a recently presented second factor,
    // independently of the longer-lived authenticated session cookie.
    'admin_mfa_fresh_minutes' => (int) env('ADMIN_MFA_FRESH_MINUTES', 15),
    'hcaptcha' => [
        // Opt-in local convenience only; HCaptcha also checks the environment,
        // debug mode and loopback hosts on every request. Never enable in a deployment.
        'dev_fallback' => filter_var(env('HCAPTCHA_DEV_FALLBACK', false), FILTER_VALIDATE_BOOLEAN),
        'site_key' => env('HCAPTCHA_SITE_KEY'),
        'secret' => env('HCAPTCHA_SECRET'),
        // Tests may point at an isolated deterministic verifier. HCaptcha
        // rejects every override outside APP_ENV=testing before requesting it.
        'verify_url' => env('HCAPTCHA_VERIFY_URL', 'https://api.hcaptcha.com/siteverify'),
        // Sitekey independiente para formularios antiabuso del host público.
        'public_site_key' => env('HCAPTCHA_PUBLIC_SITE_KEY'),
        'public_secret' => env('HCAPTCHA_PUBLIC_SECRET'),
        'connect_timeout_seconds' => (int) env('HCAPTCHA_CONNECT_TIMEOUT', 2),
        'timeout_seconds' => (int) env('HCAPTCHA_TIMEOUT', 5),
    ],
    'cookie_secure' => env('COOKIE_SECURE') !== null
        ? filter_var(env('COOKIE_SECURE'), FILTER_VALIDATE_BOOLEAN)
        : (env('APP_ENV') === 'production'),
    // Regla de seguridad crítica: sin dominio compartido; nunca ".uvh.es".
    'cookie_domain' => env('COOKIE_DOMAIN'),
    'verified_required_to_create' => filter_var(env('VERIFIED_REQUIRED_TO_CREATE', 'true'), FILTER_VALIDATE_BOOLEAN),
    'hsts_enabled' => filter_var(env('HSTS_ENABLED', 'false'), FILTER_VALIDATE_BOOLEAN),
    'trust_country_header' => filter_var(env('TRUST_COUNTRY_HEADER', 'false'), FILTER_VALIDATE_BOOLEAN),
    'country_header' => env('COUNTRY_HEADER', 'cf-ipcountry'),
    // Reputación de destinos. El adaptador es opcional y su ausencia se
    // publica como capacidad no verificada; nunca como destino "seguro".
    // El bloqueo automático está desactivado por defecto: un veredicto que este
    // despliegue no ha recibido no puede bloquear a nadie.
    'reputation' => [
        'provider_url' => env('REPUTATION_PROVIDER_URL'),
        'provider_token' => env('REPUTATION_PROVIDER_TOKEN'),
        // Timeout duro de la consulta. También es el de conexión: el transporte
        // endurecido usa el mismo valor para ambos y nunca reintenta.
        'timeout_seconds' => (int) env('REPUTATION_TIMEOUT_SECONDS', 5),
        'max_body_bytes' => (int) env('REPUTATION_MAX_BODY_BYTES', 65536),
        // Cuánto vale un veredicto antes de volver a preguntar. El proveedor
        // puede acortarlo en su respuesta, nunca alargarlo.
        'cache_ttl_hours' => (int) env('REPUTATION_CACHE_TTL_HOURS', 24),
        // Reanálisis por ciclo del scheduler. Acotado: es un barrido de fondo,
        // no un recorrido de todos los enlaces.
        'recheck_batch' => (int) env('REPUTATION_RECHECK_BATCH', 50),
        // Enlaces autobloqueados que se re-evalúan por ciclo para retirar un
        // bloqueo cuya causa desapareció (entrada retirada o caducada). Es el
        // mismo barrido acotado que `recheck_batch`, en la dirección contraria.
        'release_batch' => (int) env('REPUTATION_RELEASE_BATCH', 50),
        // Enlaces que un bloqueo de destino nuevo reanaliza de una vez. Acotado
        // en el código entre 1 y 2000; la respuesta del endpoint dice si el
        // barrido llegó al tope, en vez de presentar un bloqueo parcial como
        // uno completo.
        'reanalysis_budget' => (int) env('REPUTATION_REANALYSIS_BUDGET', 500),
        'auto_block' => filter_var(env('REPUTATION_AUTO_BLOCK', false), FILTER_VALIDATE_BOOLEAN),
        'domain_monitor' => filter_var(env('REPUTATION_DOMAIN_MONITOR', true), FILTER_VALIDATE_BOOLEAN),
    ],
    'analytics' => [
        // Valores distintos conservados por dimensión y día en el rollup. Es un
        // tope necesario (`referrers` lo controla quien visita, con cualquier
        // cabecera Referer) y se aplica al recortar por frecuencia, no por orden
        // de llegada. Acotado en el código entre 10 y 5000.
        'max_map_keys' => (int) env('ANALYTICS_MAX_MAP_KEYS', 200),
    ],
    'public_status' => [
        // This must point to a monitor outside the UVH deployment. The API
        // never derives public health from its own /health endpoint.
        'feed_url' => env('PUBLIC_STATUS_FEED_URL'),
        'feed_bearer' => env('PUBLIC_STATUS_FEED_BEARER'),
        'connect_timeout_seconds' => (int) env('PUBLIC_STATUS_CONNECT_TIMEOUT_SECONDS', 2),
        'timeout_seconds' => (int) env('PUBLIC_STATUS_TIMEOUT_SECONDS', 4),
        'max_age_seconds' => (int) env('PUBLIC_STATUS_MAX_AGE_SECONDS', 300),
    ],
    'custom_domains' => [
        'cname_target' => env('CUSTOM_DOMAIN_CNAME_TARGET'),
        'edge_ask_secret' => env('EDGE_ASK_SECRET'),
        'acme_email' => env('ACME_EMAIL'),
        'edge_internal_host' => env('EDGE_INTERNAL_HOST', 'edge'),
        'edge_internal_cidrs' => array_values(array_filter(array_map(
            'trim',
            explode(',', (string) env('EDGE_INTERNAL_CIDRS', '')),
        ))),
        // A verified-but-not-active domain must prove ownership again after
        // this window before it may enter the redirect surface.
        'verification_fresh_hours' => (int) env('DOMAIN_VERIFICATION_FRESH_HOURS', 24),
        'revalidation_hours' => (int) env('DOMAIN_REVALIDATION_HOURS', 24),
        'failure_retry_hours' => (int) env('DOMAIN_FAILURE_RETRY_HOURS', 1),
        'failure_grace_hours' => (int) env('DOMAIN_FAILURE_GRACE_HOURS', 2),
        'max_failures' => (int) env('DOMAIN_MAX_FAILURES', 3),
    ],
    'housekeeping' => [
        'interval_minutes' => (int) env('HOUSEKEEPING_INTERVAL_MINUTES', 60),
        'session_purge_days' => (int) env('SESSION_PURGE_DAYS', 30),
        'link_trash_days' => (int) env('LINK_TRASH_DAYS', 30),
        'token_purge_days' => (int) env('TOKEN_PURGE_DAYS', 7),
        'api_token_purge_days' => (int) env('API_TOKEN_PURGE_DAYS', 30),
        'delivery_purge_days' => (int) env('DELIVERY_PURGE_DAYS', 90),
        'failed_job_purge_days' => (int) env('FAILED_JOB_PURGE_DAYS', 30),
        'mail_outbox_purge_days' => (int) env('MAIL_OUTBOX_PURGE_DAYS', 30),
        'account_recovery_purge_days' => (int) env('ACCOUNT_RECOVERY_PURGE_DAYS', 90),
        'operational_metrics_purge_days' => (int) env('OPERATIONAL_METRICS_PURGE_DAYS', 30),
        'privacy_request_purge_days' => (int) env('PRIVACY_REQUEST_PURGE_DAYS', 1095),
        'export_purge_days' => (int) env('EXPORT_PURGE_DAYS', 7),
        'audit_purge_days' => (int) env('AUDIT_PURGE_DAYS', 365),
        'analytics_retention_days' => (int) env('ANALYTICS_RETENTION_DAYS', 180),
    ],
    // Initial admission allowances; windows last 24h from first admission,
    // except recipient_cooldown (60s). Never set to 0 to disable protection.
    'invitation_mail_budget' => [
        'actor_day' => (int) env('INVITATION_MAIL_ACTOR_DAY', 100),
        'workspace_day' => (int) env('INVITATION_MAIL_WORKSPACE_DAY', 200),
        'recipient_day' => (int) env('INVITATION_MAIL_RECIPIENT_DAY', 5),
        'ip_day' => (int) env('INVITATION_MAIL_IP_DAY', 200),
        'global_day' => (int) env('INVITATION_MAIL_GLOBAL_DAY', 2000),
        'recipient_cooldown' => 1,
    ],
    'rate_limits' => [
        'auth' => (int) env('AUTH_LIMIT', 10),
        'register' => (int) env('REGISTER_LIMIT', 10),
        'link_create' => (int) env('LINK_CREATE_LIMIT', 30),
        'resolve' => (int) env('RESOLVE_LIMIT', 600),
        'pending' => (int) env('PENDING_LIMIT', 20),
        'pending_read' => (int) env('PENDING_READ_LIMIT', 120),
        'api_token' => (int) env('API_TOKEN_LIMIT', 600),
    ],
];
