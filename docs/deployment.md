# UVH — Despliegue y operación

Documento de despliegue del stack actual: Laravel 13 + PostgreSQL 16 (local en contenedores Docker) + Angular 22.

## 1. Arquitectura de despliegue

| Componente     | Tecnología                                   | Entorno                 |
| -------------- | -------------------------------------------- | ----------------------- |
| API            | Laravel 13 (PHP 8.4)                         | Contenedor `app` (artisan serve) local |
| Base de datos  | PostgreSQL 16 (`postgres:16-alpine`)         | Contenedor `postgres` local, solo `127.0.0.1` |
| Cola           | `QUEUE_CONNECTION=database` (tabla `jobs`)   | Contenedor `queue` (`php artisan queue:work`) |
| Scheduler      | `php artisan schedule:work`                  | Contenedor `schedule`   |
| Frontend       | Angular 22 SPA (`dist/uvh`)                  | `ng serve` en desarrollo; estáticos en producción |
| Email          | Resend                                       | Variable `RESEND_API_KEY` |

## 2. Ejecución local / preview

```bash
# 1. Infraestructura
cp .env.docker.local.example .env.docker.local
docker compose -f docker-compose.local.yml --env-file .env.docker.local up -d postgres

# 2. App completa (Laravel + worker + scheduler) en 127.0.0.1:8000
docker compose -f docker-compose.local.yml --env-file .env.docker.local --profile laravel up -d

# 3. Frontend (Angular dev server con proxy /api y /r)
cd frontend && npm install && npm start
```

El proxy de `ng serve` (`src/proxy.conf.js`) reenvía `/api` y `/r` a `BACKEND_URL` (por defecto `http://127.0.0.1:8000`).

### Preview de Freebuff

La preview la gestiona `freebuff-preview`. El backend Laravel debe escuchar en `0.0.0.0` (lo hace `php artisan serve --host=0.0.0.0`) y la SPA se sirve como build estático o dev server según la configuración guardada con:

```bash
freebuff-preview set-install "<comando>"
freebuff-preview set "<comando>" <puerto>
freebuff-preview set-build "<comando>"
freebuff-preview start        # o restart
```

## 3. Backend Laravel local (contenedores)

- **PostgreSQL 16** → BD `uvh_local`, solo en `127.0.0.1:5432` (no expuesto fuera de localhost).
- **Imagen `uvh-php:8.4`** (PHP 8.4 + Composer + `pdo_pgsql`/`pgsql`) → contenedor `php` para `composer`/`artisan` one-off y servicios `app`, `queue` y `schedule` bajo el perfil `laravel`.

```bash
cd uvh-link-manager
cp .env.docker.local.example .env.docker.local
docker compose -f docker-compose.local.yml --env-file .env.docker.local up -d postgres
# App completa (app + queue + schedule):
docker compose -f docker-compose.local.yml --env-file .env.docker.local --profile laravel up -d
```

### Migraciones y pruebas

```bash
docker compose -f docker-compose.local.yml --env-file .env.docker.local \
  run --rm php php artisan migrate
docker compose -f docker-compose.local.yml --env-file .env.docker.local \
  run --rm php php artisan test        # suite PHPUnit (uvh_test)
```

## 4. Despliegue de producción

La SPA Angular (`frontend/dist/uvh`) se sirve como estáticos y la API Laravel detrás del proxy de aplicación:

- **Build frontend**: `cd frontend && npm run build` (emite `dist/uvh/browser`).
- **Backend**: servidor PHP con PHP 8.4+ y extensiones `pdo_pgsql`/`pgsql`, `php artisan migrate --force` antes del primer arranque.
- **Procesos persistentes**: `php artisan serve` (o PHP-FPM) + `php artisan queue:work` + cron con `php artisan schedule:run` cada minuto.
- La resolución `uvh.es/{alias}` y la API `/api/v1` deben enrutarse al backend; el panel (`app.uvh.es`) sirve la SPA.

### Variables de entorno en producción

Claves requeridas: `APP_KEY` (generada con `php artisan key:generate`), `APP_SECRET` (obligatorio; el proceso **no arranca** si falta o usa el valor de desarrollo), `RESEND_API_KEY` (para email), `APP_URL`/`APP_HOST` (host real del panel, `app.uvh.es`), `PUBLIC_HOST=uvh.es`, `DB_*` (PostgreSQL). Mantener `COOKIE_DOMAIN` vacío. `COOKIE_SECURE` ya es `true` por defecto en producción (solo override para tests).

Opcionales: `TRUST_COUNTRY_HEADER=1` **solo** si hay un proxy de confianza que inyecte `COUNTRY_HEADER` (por defecto `cf-ipcountry`; sin esto la analítica por país ignora la cabecera y no se puede falsear). Retención: `SESSION_PURGE_DAYS` (30), `TOKEN_PURGE_DAYS` (7), `DELIVERY_PURGE_DAYS` (90), `AUDIT_PURGE_DAYS` (365), `ANALYTICS_RETENTION_DAYS` (180). Scheduler: `HOUSEKEEPING_INTERVAL_MINUTES` (60) controla cada cuánto corre la pasada pesada de purga; `API_TOKEN_LIMIT` (600/min) es la capa de rate limit agregada **por token**; `LINK_CREATE_LIMIT` (30/min) limita la creación de enlaces por IP. Fuera de producción, si `APP_SECRET` no está definido se genera un secreto efímero aleatorio en cada arranque (las sesiones no sobreviven a reinicios; nunca se usa una constante conocida).

En producción el backend aplica **separación por host** (`app/Http/Middleware/UvhHostGuard.php`): `/api/v1`, `/auth` y `/app` solo responden en `APP_HOST`; la landing, legales, sitemap/robots y la resolución de enlaces solo en `PUBLIC_HOST` o dominios personalizados.

> ⚠️ **Trust proxy / rate limits por IP**: el rate limiting por IP depende de la IP efectiva del cliente. El backend debe ser alcanzable **solo** a través del proxy esperado (firewall/red privada). La capa por token (`API_TOKEN_LIMIT`) mitiga esto para endpoints de API token.

## 5. Base de datos (PostgreSQL)

- **PRAGMAs/lock**: el equivalente de las garantías de SQLite (WAL, transacciones atómicas) se consigue con PostgreSQL: transacciones + `lockForUpdate()` en las operaciones con carrera (consumo de tokens one-time, cuota de enlaces por workspace, clics single-use/máx. clics).
- **Backups**: `pg_dump` del volumen `uvh-postgres-data`; restaurar con `pg_restore`. El volumen no debe borrarse ni modificarse durante backups.
- **Índices**: ver migraciones `database/migrations/2026_08_18_000007_add_postgres_indexes.php`.

## 6. Limitaciones conocidas

1. **Rate limits y challenges MFA en memoria/caché por proceso**: en despliegues multi-instancia requieren un store compartido (Redis). Documentado en `docs/security-audit-2026-08-19.md`.
2. **Webhooks**: la entrega es asíncrona vía cola `database`; el worker `queue:work` debe estar corriendo (contenedor `queue` del Compose).
3. **Scheduler**: `schedule:work` (local) o cron `php artisan schedule:run` (producción); sin cron, las transiciones de estado y purgas no se ejecutan.
4. **`TRUST_COUNTRY_HEADER`** desactivado por defecto; si se activa, el país se toma del header configurado y debe provenir de un proxy de confianza.
