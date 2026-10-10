#!/bin/sh
# Executed only during first initialization, never an upgrade or a restore.
set -eu

read_password() {
    path="/run/secrets/$1"
    test -r "$path" || { echo "Missing database role secret: $1" >&2; exit 1; }
    value=$(cat "$path")
    # Generated Base64URL values cannot inject newlines or psql commands.
    case "$value" in ''|*[!A-Za-z0-9_-]*) echo "Invalid database role secret: $1" >&2; exit 1 ;; esac
    test "${#value}" -ge 43 || { echo "Database role secret is too short: $1" >&2; exit 1; }
    export "$2=$value"
    unset value
}

test "${POSTGRES_USER:-postgres}" = postgres
test "${POSTGRES_DB:-}" = uvh
read_password uvh_db_password UVH_INIT_APP_PASSWORD
read_password uvh_db_migration_password UVH_INIT_MIGRATION_PASSWORD
read_password uvh_db_backup_password UVH_INIT_BACKUP_PASSWORD
if [ "$UVH_INIT_APP_PASSWORD" = "$UVH_INIT_MIGRATION_PASSWORD" ] \
    || [ "$UVH_INIT_APP_PASSWORD" = "$UVH_INIT_BACKUP_PASSWORD" ] \
    || [ "$UVH_INIT_MIGRATION_PASSWORD" = "$UVH_INIT_BACKUP_PASSWORD" ]; then
    echo 'Database roles require independent passwords' >&2
    exit 1
fi

# \getenv keeps passwords out of argv and shell-generated SQL. :'var' quotes
# values as SQL literals. ON_ERROR_STOP prevents a partially granted schema
# from being mistaken for a successfully initialized database.
psql --no-psqlrc --username postgres --dbname uvh --set ON_ERROR_STOP=1 <<'SQL'
\getenv app_password UVH_INIT_APP_PASSWORD
\getenv migration_password UVH_INIT_MIGRATION_PASSWORD
\getenv backup_password UVH_INIT_BACKUP_PASSWORD
BEGIN;
CREATE ROLE uvh_migrator LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'migration_password';
CREATE ROLE uvh_app LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'app_password';
CREATE ROLE uvh_backup LOGIN NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS PASSWORD :'backup_password';
ALTER DATABASE uvh OWNER TO uvh_migrator;
REVOKE ALL ON DATABASE uvh FROM PUBLIC;
GRANT CONNECT ON DATABASE uvh TO uvh_app, uvh_backup;
ALTER SCHEMA public OWNER TO uvh_migrator;
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO uvh_app, uvh_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE uvh_migrator IN SCHEMA public GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO uvh_app;
ALTER DEFAULT PRIVILEGES FOR ROLE uvh_migrator IN SCHEMA public GRANT USAGE, SELECT ON SEQUENCES TO uvh_app;
ALTER DEFAULT PRIVILEGES FOR ROLE uvh_migrator IN SCHEMA public GRANT SELECT ON TABLES TO uvh_backup;
ALTER DEFAULT PRIVILEGES FOR ROLE uvh_migrator IN SCHEMA public GRANT SELECT ON SEQUENCES TO uvh_backup;
ALTER ROLE uvh_backup SET default_transaction_read_only = on;
COMMIT;
SQL
unset UVH_INIT_APP_PASSWORD UVH_INIT_MIGRATION_PASSWORD UVH_INIT_BACKUP_PASSWORD
