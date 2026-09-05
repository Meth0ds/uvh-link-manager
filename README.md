# UVH — Enlaces cortos. Control total.

[![Frontend](https://img.shields.io/badge/frontend-Angular%2022-1976d2?logo=angular&logoColor=white)](https://angular.dev)
[![Backend](https://img.shields.io/badge/backend-Laravel%2013%20(PHP%208.4)-ff2d20?logo=laravel&logoColor=white)](https://laravel.com)
[![Base de datos](https://img.shields.io/badge/db-PostgreSQL%2016-4169e1?logo=postgresql&logoColor=white)](https://www.postgresql.org)
[![Infra](https://img.shields.io/badge/infra-Docker%20Compose-2496ed?logo=docker&logoColor=white)](https://docs.docker.com/compose/)
[![Tests](https://img.shields.io/badge/tests-PHPUnit%20%2B%20Karma-8bc34a)]()
[![Estado](https://img.shields.io/badge/estado-pre--lanzamiento-orange)](#estado-del-proyecto)

Plataforma profesional de acortamiento, administración y analítica de enlaces
con modelo multi-workspace, dominios personalizados, control de acceso por
roles, auditoría, webhooks, API pública y flujos de privacidad (RGPD).

- **`uvh.es` (host público)** — landing pública, resolución de enlaces cortos
  con redirección HTTP real (302/307 desde el backend), páginas legales y
  denuncia de abusos.
- **`app.uvh.es` (host de aplicación)** — SPA Angular autenticada. La API REST
  vive bajo `/api/v1`.

> 🔒 **Regla de seguridad crítica:** la cookie de sesión del panel pertenece
> **solo** a `app.uvh.es`. `COOKIE_DOMAIN` debe permanecer siempre vacío —
> nunca `".uvh.es"`. No debe existir una cookie compartida sobre el dominio
> raíz.

## Índice

- [Funcionalidades](#funcionalidades)
- [Stack tecnológico](#stack-tecnológico)
- [Estructura del repositorio](#estructura-del-repositorio)
- [Puesta en marcha](#puesta-en-marcha)
  - [1. Infraestructura (PostgreSQL + PHP)](#1-infraestructura-postgresql--php)
  - [2. Backend (Laravel)](#2-backend-laravel)
  - [3. Frontend (Angular)](#3-frontend-angular)
  - [Migraciones y pruebas](#migraciones-y-pruebas)
  - [Ayudante de Windows: UVH Control](#ayudante-de-windows-uvh-control)
- [Comandos y scripts](#comandos-y-scripts)
- [Resumen de la API](#resumen-de-la-api)
- [Modelo de seguridad](#modelo-de-seguridad)
- [Despliegue en producción](#despliegue-en-producción)
- [Estado del proyecto](#estado-del-proyecto)
- [Documentación](#documentación)
- [Licencia](#licencia)

## Funcionalidades

- **Enlaces cortos con redirección real** — HTTP 302/307 emitido por el backend
  (sin rebote por JavaScript). La redirección **no visita** el destino.
- **Reglas de redirección** — prioridad determinista por país, idioma,
  dispositivo, SO, franja horaria, referente y campaña.
- **Controles de enlace** — alias personalizado, etiquetas, UTM, programación
  (activación/caducidad), protección por contraseña, uso único y máximo de
  clics aplicados atómicamente bajo concurrencia, soft delete/restore y URL de
  fallback.
- **Analítica** — clics registrados de forma asíncrona (`click_events`),
  agregación diaria (`metric_rollups`), resúmenes por enlace y workspace
  (24h/7d/30d/90d) y retención configurable.
- **Dominios personalizados** — verificación de propiedad por DNS TXT,
  comprobación CNAME, aprovisionamiento TLS con Caddy On-Demand TLS (protegido
  por un endpoint `ask` interno) y estados de ciclo de vida por dominio.
- **Workspaces y RBAC** — roles `owner > admin > editor > viewer`, invitaciones
  con caducidad y renovación, transferencia de propiedad con step-up y cuotas
  por workspace.
- **Webhooks** — entregas firmadas (`X-UVH-Signature`, HMAC-SHA256), al menos
  una vez con deduplicación por `event_id`, cola asíncrona con reintentos y
  backoff.
- **API pública** — tokens con scopes (`links:read/write`, `analytics:read`,
  `domains:read/write`), rate limiting y expiración/revocación.
- **Seguridad** — MFA (TOTP + códigos de recuperación de un solo uso),
  reautenticación para operaciones sensibles, consola admin con MFA reciente,
  auditoría append-only, protección SSRF, rate limiting diferenciado, hCaptcha
  verificada en servidor dentro de un iframe aislado con CSP propia y
  arranque fail-closed en producción.
- **Cuenta y privacidad** — verificación de email, recuperación de contraseña,
  cambio de email con reserva, exportación de datos cifrada, eliminación de
  cuenta con periodo de gracia y workflow de derechos RGPD (acceso,
  rectificación, supresión, portabilidad…).
- **Consola local de Windows** — `UVH Control.cmd` para arrancar, detener e
  inspeccionar el stack sin privilegios elevados.

## Stack tecnológico

| Capa           | Tecnología                                                                                   |
| -------------- | -------------------------------------------------------------------------------------------- |
| Frontend       | Angular 22, TypeScript estricto, Angular Material + CDK, Signals, componentes standalone, lazy loading |
| Backend        | Laravel 13 (PHP 8.4), Eloquent/Query Builder, cola `database`, scheduler                      |
| Base de datos  | PostgreSQL 16 (local vía Docker Compose), transacciones con `lockForUpdate` para operaciones con carrera |
| Edge / web     | Caddy 2.11 (On-Demand TLS) + Nginx (SPA + PHP-FPM) en producción                              |
| Email          | Resend (transaccional) con outbox transaccional durable                                       |
| Captcha        | hCaptcha (verificación 100 % server-side, iframe aislado con CSP propia)                      |
| QR             | Generación local con `qrcode` (PNG), sin llamadas externas                                    |
| Tests          | PHPUnit (Laravel) + Karma/Jasmine (Angular)                                                   |

## Estructura del repositorio

```
.
├── frontend/                 # SPA Angular (app.uvh.es)
│   └── src/app/
│       ├── core/             # servicios (API, auth, workspace, tema), guards, modelos DTO
│       ├── auth/             # login, registro, MFA, verificación, recuperación
│       ├── landing/          # landing pública
│       ├── legal/            # términos, privacidad y denuncia pública (abuse report)
│       └── panel/            # dashboard, links, analytics, domains, team, tokens, webhooks, settings, admin
├── backend-laravel/          # API Laravel
│   └── app/
│       ├── Http/Controllers/ # auth, links, analytics, workspaces, domains, tokens, webhooks, admin, público
│       ├── Http/Middleware/  # sesión, auth, CSRF, workspace, API token, MFA, host guard, cabeceras de seguridad
│       ├── Support/          # SessionManager, Ssrf, UvhCrypto, Captcha, Totp, Audit, WebhookService…
│       ├── Jobs/             # WebhookDeliveryJob (cola asíncrona)
│       └── Console/Commands/ # housekeeping, promoción admin, emisor de política de contraseñas, healthcheck…
├── docker/                   # Dockerfiles: PHP 8.4 (local/producción), Nginx, configuración Caddy
├── docs/                     # arquitectura, despliegue, seguridad, API, runbooks
├── tools/                    # ayudas PowerShell locales (UVH Control)
├── docker-compose.local.yml      # stack de desarrollo local
├── docker-compose.production.yml # stack de producción (Nginx + PHP-FPM + edge Caddy)
└── docker-compose.rotation.yml   # soporte de rotación de APP_SECRET
```

## Puesta en marcha

**Requisitos:** Docker Desktop, Node.js 22+ y npm. PHP/Composer se usan dentro
de contenedores (imagen local `uvh-php:8.4`).

### 1. Infraestructura (PostgreSQL + PHP)

```bash
cp .env.docker.local.example .env.docker.local
docker compose -f docker-compose.local.yml --env-file .env.docker.local up -d postgres
# App completa (servidor PHP + worker de cola + scheduler):
docker compose -f docker-compose.local.yml --env-file .env.docker.local --profile laravel up -d
```

Endpoints locales: backend en `http://127.0.0.1:8000` (servidor PHP integrado)
y PostgreSQL publicado **solo** en `127.0.0.1:5432` (nunca fuera de localhost).

### 2. Backend (Laravel)

```bash
cd backend-laravel
composer install
cp .env.example .env        # y configura DB_* para apuntar al PostgreSQL local
php artisan key:generate
php artisan migrate
```

Si ejecutas PHP fuera de Docker, es preferible usar el contenedor puntual:

```bash
docker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm php php artisan migrate
```

### 3. Frontend (Angular)

```bash
cd frontend
npm install
npm start        # ng serve → http://localhost:4200
```

El proxy de desarrollo (`src/proxy.conf.js`) reenvía `/api` y `/r` al backend
(`BACKEND_URL`, por defecto `http://127.0.0.1:8000`).

### Migraciones y pruebas

Las pruebas se ejecutan **siempre** sobre una base aislada `*_test`:
`tests/TestCase.php` aborta antes de migrar si el nombre de la base no termina
en `_test`. El override `-e DB_DATABASE=uvh_test` es deliberado — Compose tiene
prioridad sobre `phpunit.xml`.

```bash
# Dentro del contenedor:
docker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm \
  -e DB_DATABASE=uvh_test php php artisan test

# O desde una instalación local de PHP:
cd backend-laravel
DB_DATABASE=uvh_test php artisan test
```

> ⚠️ Nunca apuntes migraciones destructivas de pruebas a `uvh_local` (ni a
> ninguna base que no sea `*_test`).

### Ayudante de Windows: UVH Control

En Windows también puedes usar [`UVH Control.cmd`](UVH%20Control.cmd): prepara
`.env.docker.local` si falta, arranca/detiene los servicios Docker y un único
servidor Angular, muestra salud HTTP real (una respuesta lenta se presenta como
`LENTO`, no como caída), abre consolas de logs de backend/frontend e incluye
una acción de reparación del IPC de Docker. Consulta
[`docs/local-control.md`](docs/local-control.md) para controles, límites y
recuperación.

Modo diagnóstico sin interfaz:

```powershell
powershell.exe -NoLogo -NoProfile -ExecutionPolicy Bypass -File .\tools\uvh-control.ps1 -Mode Status
```

## Comandos y scripts

**Backend Laravel** (`backend-laravel/`)

| Comando | Propósito |
| ------- | --------- |
| `php artisan test` | suite PHPUnit (exige base `*_test`) |
| `php artisan queue:work` | worker de cola (webhooks y exports asíncronos) |
| `php artisan schedule:work` | scheduler local (activación/caducidad, purgas) |
| `php artisan uvh:housekeeping` | pasada de mantenimiento manual (transiciones de estado, purgas, reintentos de webhook) |
| `php artisan uvh:healthcheck` | healthcheck de contenedor (`app`, `queue`, `scheduler`) |
| `php artisan uvh:release-check` | comprobación previa de esquema en producción (solo lectura: migraciones pendientes, límites inválidos) |
| `php artisan uvh:admin:promote <email>` | promoción idempotente del primer administrador (exige cuenta verificada + MFA) |
| `php artisan uvh:emit-password-policy` | regenerar la política de contraseñas compartida con el frontend (`uvh-password-policy.v1.js`) |

**Frontend** (`frontend/package.json`)

| Comando | Propósito |
| ------- | --------- |
| `npm start` | `ng serve` con proxy de `/api` y `/r` |
| `npm run build` | build de producción (`dist/uvh/browser`) |
| `npm run typecheck` | `tsc --noEmit` |
| `npm test` | pruebas unitarias Karma/Jasmine |

**Scheduler (`UvhHousekeeping`, cada 60 s / configurable):**

1. activa enlaces `scheduled` vencidos;
2. caduca enlaces `expired`;
3. purga `click_events` y `metric_rollups` según retención;
4. reintenta `webhook_deliveries` pendientes con backoff;
5. limpia sesiones/tokens expirados o revocados y registros del outbox de correo.

## Resumen de la API

API REST bajo `/api/v1` (contrato completo en [`docs/api.md`](docs/api.md)):

- **Auth** (`/auth`): registro (anti-enumeración), login, MFA (setup,
  verificación, recovery codes de un solo uso), sesiones (listado/revocación),
  recuperación de contraseña, cambio de email, exportación de datos y
  eliminación de cuenta.
- **Enlaces** (`/links`, por workspace): CRUD, disponibilidad de alias,
  transiciones de estado y actividad (auditoría) por enlace.
- **Analítica** (`/analytics`): resúmenes y series por periodo;
  `/analytics/public/overview` para integraciones con token.
- **Workspaces** (`/workspaces`): miembros, invitaciones (con presupuesto
  `Retry-After`), roles, transferencia de propiedad y feed de actividad.
- **Dominios** (`/domains`): alta → verificación TXT → CNAME → TLS → `active`;
  revalidación y desactivación.
- **Tokens** (`/tokens`): tokens de API con scopes, mostrados una sola vez,
  con step-up obligatorio.
- **Webhooks** (`/webhooks`): CRUD, entregas (50 más recientes), reenvío
  manual y entrega de prueba.
- **Administración** (`/admin`): gestión de plataforma; exige admin + MFA
  dentro de `ADMIN_MFA_FRESH_MINUTES`.
- **Público**: `/report` (denuncias), `/status`, `/health`, `robots.txt`,
  `sitemap.xml` y **redirecciones reales** en `/:alias` y `/r/:alias` (más
  `/r/:alias/unlock` para enlaces con contraseña).

Convenciones: errores `{ "error": string, "details?": unknown }`; `409` para
estado concurrente, `429` con `Retry-After` para límites y `503` fail-closed
cuando una dependencia necesaria (captcha, cache/locks, cola, outbox) no está
disponible. La superficie de redirección (`/:alias`, `/r/:alias`) **nunca** usa
el sobre JSON: alias desconocido devuelve una página HTML 404.

## Modelo de seguridad

Aspectos destacados (detalle completo en [`docs/security.md`](docs/security.md)
y [`docs/threat-model.md`](docs/threat-model.md)):

- **Sesiones**: cookie `HttpOnly` + `SameSite` + `Secure` (en producción),
  propiedad exclusiva de `app.uvh.es`; token almacenado hasheado (SHA-256);
  CSRF de doble envío (`X-CSRF-Token`) en mutaciones; regeneración de sesión
  tras login; revocación al cambiar/resetear contraseña.
- **Contraseñas y MFA**: bcrypt cost 12; política de fortaleza compartida
  UI/API (`uvh:emit-password-policy`); TOTP + recovery codes hasheados de un
  solo uso; reautenticación (contraseña + factor) para operaciones sensibles;
  administración exige MFA reciente.
- **Anti-enumeración**: respuestas uniformes y hash señuelo en login/registro
  para emails inexistentes.
- **Validación de destino**: solo `http`/`https`; se rechazan `javascript:`,
  `data:`, `file:`, credenciales embebidas, CR/LF y hosts inválidos.
- **Protección SSRF** (`app/Support/Ssrf.php`): bloqueo de loopback, RFC1918,
  link-local y metadata cloud; IPs validadas fijadas con `CURLOPT_RESOLVE`
  (sin DNS rebinding) y sin redirecciones.
- **Criptografía**: tokens de API, sesiones y tokens de email guardados solo
  como hash SHA-256; secretos de webhook y TOTP cifrados en reposo
  (AES-256-GCM).
- **Auditoría**: `audit_events` append-only para acciones sensibles; logging
  estructurado sin tokens, contraseñas, cookies ni secretos.
- **Rate limiting**: diferenciado por endpoint (login, registro, recuperación,
  MFA, creación de enlaces, alias, API, webhooks, denuncias, admin).
- **Invariantes de producción fail-closed**: `APP_SECRET` obligatorio (falta,
  longitud insuficiente o valor de desarrollo impiden arrancar), claves de
  prueba de hCaptcha rechazadas, stores de caché no compartidos rechazados y
  PostgreSQL con `sslmode=verify-full`.
- **Separación por host**: `/api/v1`, `/auth` y `/app` responden solo en
  `APP_HOST`; landing, legales y resolución solo en `PUBLIC_HOST` o dominios
  personalizados verificados.

Reglas de entorno: los archivos `.env*` están ignorados por git — nunca subas
secretos reales. En producción activa `COOKIE_SECURE=true` y mantén
`COOKIE_DOMAIN` vacío.

## Despliegue en producción

El stack de producción reproducible es
[`docker-compose.production.yml`](docker-compose.production.yml): Nginx no
privilegiado sirve la SPA y envía API/redirecciones a PHP-FPM, edge Caddy con
On-Demand TLS, servicios `app` + `queue` + `scheduler`, secretos Docker para
todos los valores sensibles, contenedores read-only y `no-new-privileges`.

```bash
# 1. Construir imágenes inmutables.
docker compose -f docker-compose.production.yml build --pull

# 2. Ejecutar migraciones como tarea única antes de sustituir procesos.
docker compose -f docker-compose.production.yml --profile tools run --rm migrate

# 3. Arrancar/recerar servicios y comprobar el health check.
docker compose -f docker-compose.production.yml up -d --remove-orphans
docker compose -f docker-compose.production.yml ps
```

Notas clave de producción (detalle en [`docs/deployment.md`](docs/deployment.md)):

- Parte de `backend-laravel/.env.production.example`, almacenado **fuera** del
  repositorio y legible solo por la cuenta de despliegue. `APP_KEY`,
  `APP_SECRET`, PostgreSQL, hCaptcha, `RESEND_API_KEY` y secretos del edge son
  obligatorios; el arranque falla cerrado si se incumple una invariante crítica.
- El puerto de Nginx queda ligado a `127.0.0.1` deliberadamente: un proxy TLS
  (edge Caddy) debe ser el único punto de entrada y debe sobrescribir
  `X-Forwarded-*`; decláralo en `TRUSTED_PROXIES`.
- Primer administrador: registrar, verificar email, activar MFA y ejecutar
  `docker compose -f docker-compose.production.yml exec app php artisan uvh:admin:promote operador@ejemplo.com`.
- Salud: monitorizar `/health` externamente con `Host: app.uvh.es` (valida
  proceso web + base de datos). La consola admin interna no sustituye a las
  alertas externas.
- PostgreSQL: instancia gestionada/externa con `sslmode=verify-full`, backups
  cifrados fuera del host y una **restauración ensayada** antes del lanzamiento.
- Los dominios personalizados exigen un edge capaz de emitir certificados por
  host; su activación sigue bloqueada detrás de los P0 de
  [`docs/todos.md`](docs/todos.md).

## Estado del proyecto

Desarrollo activo, **pre-lanzamiento**. El informe de seguridad
([`INFORME_SEGURIDAD_REGISTRO_CAPTCHA.md`](INFORME_SEGURIDAD_REGISTRO_CAPTCHA.md))
documenta la revisión profunda de registro/hCaptcha/política de contraseñas
(H-1 corregido; endurecimiento H-2/H-3 pendiente). Antes del lanzamiento deben
cubrirse (seguimiento en [`docs/todos.md`](docs/todos.md) y
[`docs/production-readiness.md`](docs/production-readiness.md)):

- Ejecutar las suites de pruebas preparadas (backend y frontend) en un entorno
  autorizado (solo bases `*_test`) — muchas suites están escritas pero aún sin
  ejecutar.
- Ensayar las migraciones `000016`–`000033` sobre una copia representativa
  (locks, plan de rollback).
- Validar E2E con correo (Resend) y hCaptcha reales, DNS/TLS de dominios
  personalizados, backup/restauración y alertas externas.
- Revisión jurídica de RGPD/LOPDGDD/LSSI-CE (identidad del responsable, tabla
  de conservación, DPA con encargados) — los textos legales actuales son
  provisionales.

## Documentación

| Documento | Contenido |
| --------- | --------- |
| [`docs/architecture.md`](docs/architecture.md) | hosts, componentes, flujos de datos, modelo de datos y decisiones |
| [`docs/api.md`](docs/api.md) | contrato completo de la API REST (`/api/v1`) |
| [`docs/security.md`](docs/security.md) | endurecimiento: cabeceras, sesiones, MFA, SSRF, secretos, checklist de release |
| [`docs/threat-model.md`](docs/threat-model.md) | activos, actores y catálogo de 17 amenazas con mitigaciones y pruebas |
| [`docs/deployment.md`](docs/deployment.md) | despliegue local y de producción, variables de entorno, operación y límites conocidos |
| [`docs/production-readiness.md`](docs/production-readiness.md) | checklist verificable del gate de lanzamiento |
| [`docs/app-secret-rotation-runbook.md`](docs/app-secret-rotation-runbook.md) | ceremonia de rotación solapada de `APP_SECRET` |
| [`docs/mail-outbox-runbook.md`](docs/mail-outbox-runbook.md) | operación del outbox de correo transaccional |
| [`docs/invitation-mail-budget-runbook.md`](docs/invitation-mail-budget-runbook.md) | presupuestos y cooldowns de correo de invitaciones |
| [`docs/local-control.md`](docs/local-control.md) | ayudante de Windows `UVH Control`: controles, límites y recuperación |
| [`docs/todos.md`](docs/todos.md) | backlog de implementación/validación/lanzamiento con estado por tarea |
| [`docs/design-system.md`](docs/design-system.md) | convenciones del sistema de diseño de la UI |
| [`INFORME_SEGURIDAD_REGISTRO_CAPTCHA.md`](INFORME_SEGURIDAD_REGISTRO_CAPTCHA.md) | informe de seguridad: registro, hCaptcha y política de contraseñas |

## Licencia

Aún no se ha publicado una licencia. Hasta que se añada, todos los derechos
quedan reservados por el propietario del proyecto.
