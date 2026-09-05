#!/bin/sh
set -eu

load_secret_file() {
    secret_name="$1"
    eval "secret_file=\${${secret_name}_FILE:-}"
    if [ -z "$secret_file" ]; then
        return
    fi
    if [ ! -r "$secret_file" ]; then
        echo "Secret file for ${secret_name} is not readable" >&2
        exit 1
    fi
    secret_value="$(cat "$secret_file")"
    if [ -z "$secret_value" ]; then
        echo "Secret file for ${secret_name} is empty" >&2
        exit 1
    fi
    export "${secret_name}=${secret_value}"
    unset secret_value
}

for secret_name in \
    APP_KEY APP_SECRET APP_SECRET_PREVIOUS DB_PASSWORD HCAPTCHA_SECRET HCAPTCHA_PUBLIC_SECRET \
    RESEND_API_KEY EDGE_ASK_SECRET METRICS_BEARER_TOKEN
do
    load_secret_file "$secret_name"
done
unset secret_name secret_file

# Fail before framework boot if a custom/rebuilt image omitted a runtime
# capability on which authentication, SSRF controls or PostgreSQL depend.
php -r '$required=["curl","intl","mbstring","openssl","pcntl","pdo_pgsql"]; $missing=array_values(array_filter($required, fn($ext) => !extension_loaded($ext))); if ($missing !== []) { fwrite(STDERR, "Missing required PHP extensions: ".implode(",", $missing).PHP_EOL); exit(1); }'

# Build configuration from runtime secrets on every fresh container. The
# command boots the application, so ProductionSecurity aborts startup before a
# worker can serve traffic when an invariant is missing or unsafe.
if [ "${APP_ENV:-}" = "production" ]; then
    php artisan config:cache --no-ansi --no-interaction
    # Gate only long-lived runtime commands, not migrate/config/diagnostic tools:
    # an empty schema must still be repairable with the explicit migration job.
    # This check never applies migrations, seeds tables or modifies local data.
    case "${1:-}" in
        php-fpm*)
            php artisan uvh:release-check --no-ansi --no-interaction
            ;;
        php)
            if [ "${2:-}" = "artisan" ]; then
                case "${3:-}" in
                    queue:work|queue:listen|schedule:work|schedule:run)
                        php artisan uvh:release-check --no-ansi --no-interaction
                        ;;
                esac
            fi
            ;;
    esac
fi

exec "$@"
