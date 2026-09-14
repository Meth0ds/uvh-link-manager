# UVH — Despliegue y operación

Documento de despliegue del stack actual: Laravel 13 + PostgreSQL 16 (local en contenedores Docker) + Angular 22.

## 1. Arquitectura de despliegue

| Componente     | Tecnología                                   | Entorno                 |
| -------------- | -------------------------------------------- | ----------------------- |
| API            | Laravel 13 (PHP 8.4)                         | Servidor PHP integrado local; PHP-FPM en producción |
| Base de datos  | PostgreSQL 16 (`postgres:16-alpine`)         | Contenedor `postgres` local, solo `127.0.0.1` |
| Colas          | `QUEUE_CONNECTION=redis` (broker dedicado)   | Workers `queue-mail`, `queue-webhooks`, `queue-domains`, `queue-exports`, `queue-analytics` y drenaje `queue-legacy` |
| Caché y límites | `CACHE_STORE=redis`, limitador `failover` (Redis → PostgreSQL) | Redis sin puerto publicado, dentro de `uvh-internal` |
| Scheduler      | `php artisan schedule:work`                  | Contenedor `scheduler`  |
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

La preview la gestiona `freebuff-preview`. El backend Laravel debe escuchar en `0.0.0.0` (el servicio local usa `php -S 0.0.0.0:8000 -t public public/index.php`) y la SPA se sirve como build estático o dev server según la configuración guardada con:

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
  run --rm -e DB_DATABASE=uvh_test php php artisan test
```

El override `-e DB_DATABASE=uvh_test` es deliberado: el servicio local apunta a
`uvh_local` para la aplicación y Compose tiene prioridad sobre `phpunit.xml`.
La salvaguarda de `tests/TestCase.php` aborta antes de migrar si el nombre de la
base no termina en `_test`.

## 4. Despliegue de producción

La producción reproducible del repositorio usa `docker-compose.production.yml`: Nginx no privilegiado sirve la SPA y envía la API/redirecciones a PHP-FPM. La base de datos es PostgreSQL gestionado o externo y no forma parte del Compose de producción.

- **Build frontend**: `cd frontend && npm run build` (emite `dist/uvh/browser`).
- **Backend**: PHP-FPM 8.4 con extensiones `pdo_pgsql`/`pgsql`; `php artisan serve` no es un servidor de producción.
- **Procesos persistentes**: `app` (PHP-FPM), los seis workers de cola y
  `scheduler` (`schedule:work`). Cada worker consume una cola y publica su
  propio heartbeat; `queue-legacy` sólo drena la cola histórica `default`.
- La resolución `uvh.es/{alias}` y la API `/api/v1` deben enrutarse al backend; el panel (`app.uvh.es`) sirve la SPA.

Secuencia de release recomendada:

```bash
# Construir una imagen inmutable y comprobar que la configuración puede arrancar.
docker compose -f docker-compose.production.yml build --pull

# Ejecutar las migraciones como tarea única antes de sustituir los procesos.
docker compose -f docker-compose.production.yml --profile tools run --rm migrate

# Arrancar/recrear servicios y comprobar el health check HTTP.
docker compose -f docker-compose.production.yml up -d --remove-orphans
docker compose -f docker-compose.production.yml ps
```

### Contrato de arranque

Antes de desplegar, `npm run release:boot` (desde `frontend/`) construye la imagen
de producción y la arranca como lo hace producción —`APP_ENV=production` y todas
las invariantes de `ProductionSecurity` satisfechas— y después comprueba que cada
invariante rota **detiene** el contenedor con un mensaje diagnosticable y sin
otros motivos:

- arranque válido: `config:cache` y `uvh:release-check` se ejecutan y PHP-FPM
  queda sirviendo;
- `APP_SECRET` ausente, `COOKIE_SECURE` desactivado, `COOKIE_DOMAIN` compartido,
  `TRUSTED_PROXIES` con comodines, `APP_DEBUG=true`, respaldo de captcha de
  pruebas, TLS de base de datos degradado o coste bcrypt fuera de rango: no
  arranca;
- Redis sin contraseña, apuntando a loopback, con un `CACHE_LIMITER` que no sea
  compartido, o con una ventana de reintento de cola por debajo de 200 s: no
  arranca. La última es la trampa que más cuesta ver: el driver de Redis **no**
  hereda `DB_QUEUE_RETRY_AFTER`, así que sin `REDIS_QUEUE_RETRY_AFTER` toma el
  valor del framework (90 s) y un worker podría reclamar un job que otro todavía
  está ejecutando;
- la plantilla de producción (`backend-laravel/.env.production.example`) declara
  la misma topología de stores que el entorno que se arranca. Se compara antes de
  levantar ningún contenedor: una plantilla desviada describe un despliegue que
  ninguna prueba ejercita;
- esquema vacío o por detrás de la imagen: no arrancan PHP-FPM, queue ni
  scheduler, mientras el job `migrate` sigue disponible para repararlo.

El smoke de navegador (`npm run release:e2e`) no acredita nada de esto: corre con
`APP_ENV=testing` y por tanto nunca entra en la rama de producción del entrypoint.

Dos reglas operativas que se derivan de ese arranque:

- No envuelvas el `command` del servicio `app` en un shell. El entrypoint decide
  por `$1`, así que un `sh -lc '...'` deja de coincidir con `php-fpm` y omite
  `uvh:release-check` sin ningún síntoma visible.
- La migración es una tarea única previa. Con un esquema vacío ese job debe seguir
  funcionando; las comprobaciones de `uvh:release-check` sólo gatean los procesos
  de larga vida.

### Primer administrador

No existe un usuario administrador ni una contraseña predeterminada. Después de
registrar una cuenta, verificar su email y activar MFA, un operador con acceso al
host debe promocionarla mediante el contenedor de aplicación:

```bash
docker compose -f docker-compose.production.yml exec app \
  php artisan uvh:admin:promote operador@ejemplo.com
```

El comando es idempotente, bloquea la fila durante la promoción, rechaza cuentas
bloqueadas/no verificadas/sin MFA y registra `system.admin_promote` en la
auditoría. Las promociones posteriores pueden realizarse desde la consola admin.

El puerto del contenedor Nginx queda ligado a `127.0.0.1` deliberadamente. Un proxy TLS externo debe ser el único punto de entrada, sobrescribir `X-Forwarded-For`/`X-Forwarded-Proto` y conectarse desde las IP/CIDR declaradas en `TRUSTED_PROXIES`. No se debe publicar PHP-FPM ni PostgreSQL a Internet.

### Variables de entorno en producción

El transporte de correo se valida por su configuración efectiva, incluidos alias,
`MAIL_URL` y ramas de failover: no se admite un respaldo `log/array` que registre
contenido o aparente entrega. El procedimiento para estados, recuperación,
reintentos, conservación y alertas está en
[`docs/mail-outbox-runbook.md`](mail-outbox-runbook.md); su ensayo sigue pendiente.

Partir de `backend-laravel/.env.production.example`, almacenarlo fuera del repositorio y limitar su lectura a la cuenta de despliegue. Claves requeridas: `APP_KEY` (generada con `php artisan key:generate`), `APP_SECRET` independiente y aleatorio, credenciales PostgreSQL, claves reales de hCaptcha, `RESEND_API_KEY`, hosts públicos y proxies concretos. También son obligatorios titular legal, identificador fiscal, domicilio, datos registrales, proveedor de alojamiento y región reales; el proceso **rechaza el arranque** si falta una invariante crítica o se conserva un marcador de ejemplo. Mantener `COOKIE_DOMAIN` vacío. La ceremonia de cambio de `APP_SECRET`, su keyring temporal y rollback están en [`docs/app-secret-rotation-runbook.md`](app-secret-rotation-runbook.md); tener el archivo no acredita que se haya ensayado.

**Redis** es el store compartido de caché, rate limits, locks y colas
(`CACHE_STORE=redis`, `QUEUE_CONNECTION=redis`). Su contraseña se entrega como
secreto (`UVH_REDIS_PASSWORD_FILE` → `REDIS_PASSWORD_FILE`), nunca como valor
literal del `.env`, y el arranque rechaza un host de loopback o una credencial
ausente o de ejemplo. `CACHE_LIMITER=failover` con
`CACHE_FAILOVER_STORES=redis,database` es lo que mantiene servida la superficie
pública si Redis no responde; los locks no usan ese store y fallan cerrado. Si
prefieres una instancia gestionada, apunta `REDIS_URL` (admite `rediss://`)
en lugar de `REDIS_HOST`/`REDIS_PORT`; el gate acepta ambos. `database` sigue
siendo un valor válido para `CACHE_STORE`/`QUEUE_CONNECTION` en un despliegue de
un solo nodo.

En `docker-compose.production.yml` estas claves están fijadas además en el bloque
`environment` compartido, que prevalece sobre `env_file`: ese fichero es el que
declara el servicio `redis` y exige su secreto, así que la topología no puede
quedar en manos de un `.env.production` que no la mencione. Para usar una
instancia gestionada hay que editar ese bloque, no sólo el `.env`.

`backend-laravel/.env.production.example` describe esos mismos valores, y
`npm run release:boot` compara ambos ficheros **antes** de arrancar nada: una
plantilla que apunte caché, rate limits, locks o colas a otro sitio —o que se
deje el `REDIS_QUEUE_RETRY_AFTER`— falla el contrato en lugar de descubrirse en el
primer despliegue. La plantilla de desarrollo (`.env.example`) sigue apuntando a
PostgreSQL, que es el comportamiento correcto para un solo proceso local.

Opcionales: `TRUST_COUNTRY_HEADER=1` **solo** si hay un proxy de confianza que inyecte `COUNTRY_HEADER` (por defecto `cf-ipcountry`; sin esto la analítica por país ignora la cabecera y no se puede falsear). Retención: `SESSION_PURGE_DAYS` (30), `TOKEN_PURGE_DAYS` (7), `DELIVERY_PURGE_DAYS` (90), `AUDIT_PURGE_DAYS` (365), `ANALYTICS_RETENTION_DAYS` (180). Scheduler: `HOUSEKEEPING_INTERVAL_MINUTES` (60) controla cada cuánto corre la pasada pesada de purga; `API_TOKEN_LIMIT` (600/min) es la capa de rate limit agregada **por token**; `LINK_CREATE_LIMIT` (30/min) limita la creación de enlaces por IP. Fuera de producción, si `APP_SECRET` no está definido se genera un secreto efímero aleatorio en cada arranque (las sesiones no sobreviven a reinicios; nunca se usa una constante conocida).

En producción el backend aplica **separación por host** (`app/Http/Middleware/UvhHostGuard.php`): `/api/v1`, `/auth` y `/app` solo responden en `APP_HOST`; la landing, legales, sitemap/robots y la resolución de enlaces solo en `PUBLIC_HOST` o dominios personalizados.

> ⚠️ **Trust proxy / rate limits por IP**: el rate limiting por IP depende de la IP efectiva del cliente. El backend debe ser alcanzable **solo** a través del proxy esperado (firewall/red privada). La capa por token (`API_TOKEN_LIMIT`) mitiga esto para endpoints de API token.

### Proxy TLS y cabeceras

- Terminar TLS con un certificado válido para `uvh.es` y `app.uvh.es`; redirigir HTTP a HTTPS antes de Nginx.
- Sobrescribir, no concatenar desde el cliente, `X-Forwarded-For` y `X-Forwarded-Proto` en el proxy perimetral.
- Configurar `TRUSTED_PROXIES` con sus IP/CIDR exactos y verificar en staging la IP efectiva que recibe Laravel.
- El CSP del host de aplicación permite enmarcar únicamente el wrapper hCaptcha del mismo origen. El wrapper tiene una CSP independiente limitada a `hcaptcha.com`.

### Dominios personalizados

El bloque `default_server` de Nginx permite que Laravel reciba un `Host` de
cliente y resuelva únicamente dominios locales en estado `active`, pero **no
emite ni renueva certificados**. Un wildcard de `uvh.es` no cubre dominios de
clientes. Antes de ofrecer esta función en producción debe existir un edge TLS
capaz de aprovisionar custom hostnames, preservar SNI/`Host`, bloquear hosts no
registrados y retirar certificados/routeos al dar de baja un dominio.

La prueba TXT usa `_uvh-verification.<dominio>`; se consulta también el nombre
antiguo durante la transición. Esta prueba acredita control DNS, pero no acredita
que el CNAME/A/AAAA apunte al edge ni que HTTPS esté listo. El estado actual de
la aplicación no modela todavía esas dos condiciones, por lo que la activación
de dominios personalizados permanece bloqueada para lanzamiento hasta completar
los P0 de [`todos.md`](todos.md).

El proxy perimetral debe sobrescribir `X-Forwarded-*`, pasar un `Host` validado,
rechazar acceso directo al puerto interno y no aplicar HSTS con
`includeSubDomains` a un dominio de cliente sin consentimiento y control de sus
subdominios.

## 5. Base de datos (PostgreSQL)

- **PRAGMAs/lock**: el equivalente de las garantías de SQLite (WAL, transacciones atómicas) se consigue con PostgreSQL: transacciones + `lockForUpdate()` en las operaciones con carrera (consumo de tokens one-time, cuota de enlaces por workspace, clics single-use/máx. clics).
- **Backups**: `docker/backup/backup.sh` implementa `pg_dump --format=custom` cifrado (clave en volumen independiente), manifiesto con digests, retención por número y hook de alerta; `docker/backup/restore.sh` verifica la integridad del cifrado y del volcado antes de escribir una sola fila. No basta con ejecutar backups: `npm run e2e:backup` destruye una base a propósito, restaura la copia en una instancia aislada, rechaza una copia manipulada y deja RPO/RTO medidos. Procedimiento y contrato en `docs/backup-and-restore.md`.
- **Índices**: ver migraciones `database/migrations/2026_08_18_000007_add_postgres_indexes.php`.

## 6. Observabilidad y respuesta operativa

- Monitorizar externamente `/health` con `Host: app.uvh.es`; valida proceso web y conexión a base de datos.
- Alertar por reinicios de `app`, cada worker `queue-*` y `scheduler`, además de
  profundidad, antigüedad y heartbeat de `mail`, `webhooks`, `domains`,
  `exports`, `analytics` y `legacy`. Vigilar también `failed_jobs` y entregas
  webhook fallidas o bloqueadas.
- La pestaña **Administración → Sistema** es una ayuda para operadores autenticados, no un sustituto de alertas externas.
- Centralizar `stderr`, aplicar redacción de datos y alertar por tasas anómalas de `4xx`, `5xx`, login, hCaptcha y rate limiting.
- Definir responsable, canal y procedimiento para incidentes, bloqueo de enlaces, denuncias y recuperación desde backup.

## 7. Limitaciones conocidas

1. **Estado compartido**: rate limits, locks y colas viven en Redis. El rate limiter usa un store de tipo *failover* (Redis → PostgreSQL), así que una caída de Redis degrada a contar intentos en la base de datos y sigue sirviendo tráfico público, con el coste de escribir en PostgreSQL mientras dure; los locks fallan cerrado. Nunca usar `array` ni `file` en producción. Detalle en [`docs/redis-operations.md`](redis-operations.md).
2. **Colas**: la entrega es asíncrona y el broker es Redis (`QUEUE_CONNECTION=redis`). Los workers `queue-*` deben estar saludables; correo, dominios, exportaciones y analítica no deben usarse como sustitutos de ese heartbeat. La profundidad y la antigüedad que se monitorizan salen del **broker configurado**, no de la tabla `jobs` (que sólo usa el driver `database`); si el broker no se puede leer, la muestra se cuenta en `queue.metrics_unavailable` en lugar de publicarse como cero.
3. **Scheduler**: `schedule:work` (local) o cron `php artisan schedule:run` (producción); sin cron, las transiciones de estado y purgas no se ejecutan.
4. **`TRUST_COUNTRY_HEADER`** desactivado por defecto; si se activa, el país se toma del header configurado y debe provenir de un proxy de confianza.
5. **Dependencias externas**: email, DNS, hCaptcha, TLS, proxy, backups y alertas deben validarse con credenciales e infraestructura reales; las pruebas locales no demuestran su funcionamiento en producción.

La lista verificable de salida está en [`production-readiness.md`](production-readiness.md).
