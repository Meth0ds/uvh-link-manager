<div align="center">

# UVH Link Manager

### Enlaces cortos, dominios propios, QR avanzados y analítica con seguridad por diseño

[![CI](https://github.com/Meth0ds/uvh-link-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/Meth0ds/uvh-link-manager/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Meth0ds/uvh-link-manager/actions/workflows/codeql.yml/badge.svg)](https://github.com/Meth0ds/uvh-link-manager/actions/workflows/codeql.yml)
[![Angular 22](https://img.shields.io/badge/Angular-22-DD0031?logo=angular)](https://angular.dev/)
[![Laravel 13](https://img.shields.io/badge/Laravel-13-FF2D20?logo=laravel)](https://laravel.com/)
[![PHP 8.4](https://img.shields.io/badge/PHP-8.4-777BB4?logo=php&logoColor=white)](https://www.php.net/)
[![PostgreSQL 16](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)

</div>

UVH es una plataforma multi-tenant para crear, administrar y observar enlaces
cortos: alias propios, dominios verificados, QR imprimibles, informes
compartidos y analítica. Reúne una SPA Angular, una API Laravel, PostgreSQL y
Redis detrás de una regla central: **toda decisión de autorización se toma en
el servidor**, con aislamiento de datos por workspace, defensas antiabuso,
auditoría append-only y reautenticación para las operaciones sensibles.

> [!IMPORTANT]
> El proyecto está en desarrollo activo. Un build correcto **no** acredita un
> despliegue listo para producción: consulta
> [preparación para producción](docs/production-readiness.md) antes de publicar
> el servicio.

## Capacidades

### Enlaces

| Función | Descripción |
| --- | --- |
| Nombres internos | Nombre descriptivo por enlace (hasta 120 caracteres Unicode) que identifica sin tocar el alias; orden Nombre A–Z / Z–A y «Usar como nombre» desde la vista previa del destino. |
| Búsqueda global | Paleta `Buscar…` con Ctrl+K / ⌘K: workspace, acciones, navegación, enlaces y dominios, con atajos de teclado y resaltado seguro. Endpoint `GET /api/v1/search` con patrones literales. |
| Ciclo de vida | Programación, caducidad, límites de clics, un solo uso, pausa, archivo y papelera recuperable con restauración. |
| Reglas de redirección | Reglas por dispositivo/país/idioma con simulador de reglas, UTM y parámetros de campaña. |
| Organización | Etiquetas, colecciones, plantillas de enlace, favoritos personales y filtros guardados («Mis filtros»). |
| Flujos avanzados | Duplicar con alias nuevo, historial de ediciones con restauración, importación/exportación CSV (con protección frente a fórmulas) y operaciones en bloque. |
| Experiencia | Página personalizada cuando el enlace no está disponible (texto plano + botón opcional), avisos de caducidad/agotamiento (24 h y 90 %), comprobación de disponibilidad del destino y vista previa con título, dominio e icono normalizado. |
| Apertura de aplicaciones | Enlaces que abren Spotify, YouTube, Google Maps o Apple Maps en móvil y apps propias mediante AASA (`/a/*`) y Android Asset Links. Sin detección de instalaciones ni falsas confirmaciones: la métrica sigue siendo **visita**. |

### QR avanzados

| Función | Descripción |
| --- | --- |
| Un solo diseño | Contrato `QrDesignSpec` v1: la vista previa, el PNG, el SVG y el PDF comparten una escena geométrica. SVG vectorial con texto trazado; PDF con Manrope incrustada y texto buscable. |
| Personalización | Colores de alto contraste, margen, marco y logos propios (PNG/JPG normalizados a 1024 px, cifrados en disco privado). |
| Impresión y archivo | Impresión A4 con mm/cm, copias o llenar hoja y marcas de corte; exportación PNG/SVG/PDF individual. |
| Lotes | «Exportar QR» hasta 100 enlaces: ZIP con PNG/SVG y `manifest.json`, o PDF A4, generado en worker con progreso, cancelación y límite de 64 MiB. |
| Campañas | QR de campaña con nombre y copia del diseño (`?qr=<id>`), comparación de visitas atribuidas por serie diaria UTC, archivado que conserva los QR impresos. |
| Límites | `QR_DESIGNS_PER_WORKSPACE` (50), `QR_VARIANTS_PER_LINK` (100), `QR_ASSET_BYTES_PER_WORKSPACE` (64 MiB); idempotencia y versiones optimistas. Detalle en [docs/advanced-qr.md](docs/advanced-qr.md). |

### Analítica e informes

| Función | Descripción |
| --- | --- |
| Eventos y agregados | Clicks con retención configurable, filtros por periodo/enlace/etiqueta y rollups con precisión preservada. |
| Informes compartidos | Informes vivos de hasta 100 enlaces con secciones y periodo fijados por el autor. URL con secreto en el fragmento (retirado antes de compartir), cookie acotada al informe y 30 minutos, contraseña opcional, revocación y regeneración de acceso. Nunca publica destinos, notas, miembros ni identificadores de visitante. |
| Tarjetas sociales | Título e imagen independientes del nombre interno, recorte local y normalización JPEG 1200 × 630; imagen privada, lectores sociales acotados y tarjeta neutra con contraseña. |
| Exportación de datos | Exportación de cuenta autoservicio con step-up, generación por streaming, TTL 48 h e historial de las últimas diez; separación contractual entre «Descarga de cuenta» (art. 15) y «Derecho RGPD» (art. 20). |

### Dominios, equipos y cuenta

| Área | Capacidades |
| --- | --- |
| Dominios | Verificación DNS con diagnóstico, provisionado y sondeo TLS, estados explícitos, perfiles de app por dominio (AASA y Asset Links publicables) y controles de acceso por rol. |
| Equipos | Workspaces aislados, roles `owner`/`admin`/`editor`/`viewer`, invitaciones con reintento limitado, transferencia de propiedad, actividad y uso por workspace. |
| Cuenta | Registro que empieza solo con el email y la verificación antiabuso; la cuenta se completa al abrir el enlace del correo (nombre, contraseña y términos una sola vez) y los enlaces preparados en el hero se reanudan incluso desde otro dispositivo. Verificación de correo, MFA TOTP con códigos de recuperación, sesiones revocables y step-up para operaciones críticas. |
| Privacidad y legal | Derechos RGPD con casos verificables, borrado de cuenta con confirmación y cancelación protectoras, documentos legales versionados y registro de identidad publicable. |
| Integraciones | Tokens API con scopes, webhooks firmados con reintentos, inspector con payload reducido por allowlist y asociaciones de app (`/.well-known`). |
| Operación | Workers aislados por cola, scheduler de mantenimiento, auditoría append-only, métricas por cola, estado público externo, pausa temporal de registros operable desde admin, centro de seguridad e incidentes. |

## Arquitectura

```text
Navegador
   ├── uvh.es          → landing, páginas legales y redirecciones públicas
   └── app.uvh.es      → SPA Angular 22
                              │
                              ▼
                        API Laravel 13
                     │      │      │
                     │      │      └── workers por cola: mail · webhooks · domains
                     │      │          · exports · analytics · security · destinations
                     │      └───────── scheduler de mantenimiento
                     └─────────────── PostgreSQL 16 · Redis 7 (caché, límites,
                                       locks y colas; la verdad del producto es la BD)
```

Invariantes que ninguna capa del cliente puede relajar:

- La cookie de sesión **nunca** se comparte con `.uvh.es`: `COOKIE_DOMAIN` y
  `SESSION_DOMAIN` permanecen vacíos.
- Los guards de Angular son ayuda de navegación, no una frontera de seguridad.
- PostgreSQL y los servicios de desarrollo se publican únicamente en loopback.
- Los estados, permisos y datos de gráficos no cambian al cambiar la apariencia;
  los alias semánticos `--uvh-*` desacoplan ambos.
- Redis guarda solo estado efímero compartido (caché, rate limits de volumen,
  locks y colas); las cuentas, enlaces, auditoría y outboxes viven en
  PostgreSQL ([docs/redis-operations.md](docs/redis-operations.md)).

El detalle de componentes, flujos y decisiones está en
[docs/architecture.md](docs/architecture.md).

## Stack

| Capa | Tecnología |
| --- | --- |
| Frontend | Angular 22.2, TypeScript 6 estricto, Angular Material/CDK, signals, componentes standalone y workers propios para QR. |
| Backend | Laravel 13 sobre PHP 8.4, jobs asíncronos por cola y scheduler. |
| Datos | PostgreSQL 16; Redis 7 para caché, límites, locks y colas. Transacciones y bloqueos pesimistas para operaciones con carreras. |
| Calidad | Pint, Larastan/PHPStan, ESLint (`--max-warnings=0`) y `tsc --noEmit`. |
| Pruebas | PHPUnit, Karma/Jasmine y Playwright 1.63 sobre Chromium (WebKit y móvil se validan en las revisiones de función). |
| Entrega | Docker Compose con imágenes fijadas por digesto para desarrollo y producción; ejecutables nativos `uvh-control` para operación local. |

## Estructura del repositorio

```text
backend-laravel/     API Laravel: controladores, jobs, modelos y pruebas PHPUnit
frontend/            SPA Angular: panel, landing, auth, legal, páginas públicas
  design-preview/    build aislado de revisión visual (datos ficticios, sin backend)
  e2e/               recorridos Playwright (e2e, release, async, backup, boot)
panel/               panel Angular Material del control local nativo (uvh-control)
docker/              imágenes y configuración (php, nginx, caddy, postgres, backup…)
scripts/             verify-local, uvh-control, digestos, escaneos y benchmarks
docs/                referencia, runbooks, roadmaps, legal y evidencias de release
dist/                ejecutables nativos uvh-control (Windows, macOS, Linux)
docker-compose.local.yml        entorno de desarrollo
docker-compose.upcloud*.yml     pila de producción (app, edge y correo)
docker-compose.e2e / async-e2e / release-e2e / release-boot / backup-e2e /
                   rotation / analytics-drill     ensayos y simulacros aislados
```

## Inicio rápido

Requisitos: Git, Docker Desktop y Node.js 22.

### Windows

```powershell
# 1. Clona y entra en el repositorio.
git clone https://github.com/Meth0ds/uvh-link-manager.git
Set-Location uvh-link-manager

# 2. Configuración local de Docker; sólo contiene credenciales de desarrollo.
Copy-Item .env.docker.local.example .env.docker.local

# 3. Prepara Laravel e instala sus dependencias bloqueadas en el contenedor.
Copy-Item backend-laravel/.env.example backend-laravel/.env
docker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm php composer install
docker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm php php artisan key:generate

# 4. Prepara Angular y abre el panel local compilado: "Iniciar entorno".
Push-Location frontend; npm ci; Pop-Location
.\dist\uvh-control-windows-x64.exe
```

### Cualquier plataforma

```bash
cp .env.docker.local.example .env.docker.local
cp backend-laravel/.env.example backend-laravel/.env
docker compose -f docker-compose.local.yml --env-file .env.docker.local up -d postgres redis
docker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm php composer install
docker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm php php artisan key:generate
docker compose -f docker-compose.local.yml --env-file .env.docker.local --profile laravel up -d

cd frontend && npm ci && npm start
```

El perfil `laravel` levanta la API en `http://127.0.0.1:8000`, dos workers
(`queue:work` sobre `mail,webhooks,domains,exports,analytics,security,default`
y, aparte, la cola `destinations` con timeout de 20 s) y el scheduler. Angular
sirve el panel en `http://127.0.0.1:4200`.

El registro comienza únicamente con el email y la comprobación antiabuso.
El correo permite completar la cuenta: nombre, contraseña y aceptación de los
términos se eligen una sola vez al abrir su enlace. Hasta completar ese paso
no existe una cuenta ni una sesión. Al completar una cuenta nueva se abre su
sesión y se muestra un botón para ir al panel. Si se preparó una URL en el hero,
el botón permite retomarla incluso al abrir el correo en otro dispositivo;
su caducidad original se mantiene y el enlace no se publica automáticamente.
Una sesión existente de otra cuenta se conserva hasta elegir cambiar de cuenta.

### Conectar y retirar dominios

Al añadir un subdominio se abre su guía de configuración. Incluye instrucciones
manuales para Cloudflare y otros proveedores, copia de TXT/CNAME y progreso
obtenido del servidor. La comprobación explícita de DNS puede iniciar HTTPS;
abrir la guía o copiar un registro no inicia verificaciones ni emisiones.

«Eliminar dominio» revisa primero sus enlaces de biblioteca y papelera. Un
propietario o administrador puede seleccionar hasta 100 enlaces, elegir otro
dominio disponible o el de plataforma, revisar las URL y confirmar su traslado.
Los conflictos bloquean toda la selección. La papelera conserva estado y fecha
de purga; los enlaces bloqueados requieren administración de la plataforma.
Las URL y los QR distribuidos deben actualizarse después de un traslado.
El borrado se confirma por separado y vuelve a comprobar que no haya enlaces.
Los registros DNS del proveedor se gestionan manualmente.

La API de sesión añade `GET /api/v1/domains/:id/deletion-preview`,
`POST /api/v1/domains/:id/reassignment-preview` y
`POST /api/v1/domains/:id/reassign`. La ejecución exige versiones esperadas e
`Idempotency-Key`; su auditoría, historial y cambios se admiten juntos.
La papelera admite el filtro `domainId`. La API pública mantiene sus contratos.

Prueba integrada: `cd frontend && npm run e2e -- e2e/specs/domain-management.spec.ts`.
Usa una base aislada `_test`; DNS/HTTPS se preparan mediante una fixture, por lo
que esta prueba no acredita propagación DNS ni emisión ACME públicas. Las pruebas
`DomainRemovalTest` incluyen peticiones simultáneas y fallos de admisión de auditoría.

## Panel de control local (nativo)

Los ejecutables nativos `dist/uvh-control-windows-x64.exe`,
`dist/uvh-control-macos-arm64` y `dist/uvh-control-linux-x64` (doble clic o
terminal) abren un panel Angular Material independiente con identidad UVH,
temas claro/oscuro, estado de servicios, registros y mantenimiento. El panel
no requiere Node.js instalado; iniciar Angular de desarrollo sí requiere Node
y `npm ci` previo en `frontend/`. La API local valida origen y sesión, las
operaciones quedan identificadas y las acciones sensibles piden confirmación.
La reparación IPC de Docker solo aplica a Windows y exige elevación explícita.
La guía y las limitaciones están en [docs/local-control.md](docs/local-control.md).
Sin binario, compila primero `panel/` y usa `node scripts/uvh-control.mjs serve`
(o `status|start|stop|restart|migrate` sin panel).

## Servicios locales de apoyo

### Adminer (base de datos en el navegador)

La base local es PostgreSQL; phpMyAdmin solo admite MySQL/MariaDB. El stack
incluye Adminer, una interfaz web compatible con PostgreSQL:

```sh
docker compose -f docker-compose.local.yml --env-file .env.docker.local up -d postgres adminer
```

Abre [http://localhost:8080](http://localhost:8080) y usa el sistema
**PostgreSQL**, servidor `postgres` y las credenciales `POSTGRES_DB`,
`POSTGRES_USER` y `POSTGRES_PASSWORD` de `.env.docker.local` (por defecto
local: `uvh_local`). El servicio web está enlazado solo a `127.0.0.1`; cambia
el puerto con `ADMINER_PORT`.

### Mailpit (correo de desarrollo)

La app y los workers de Docker entregan los correos a Mailpit, un buzón de
pruebas interno. Arranca el stack con:

```sh
docker compose -f docker-compose.local.yml --env-file .env.docker.local --profile laravel up -d
```

Abre [http://localhost:8025](http://localhost:8025). Tras registrarte, abre ahí
el mensaje de verificación y sigue el enlace. Si ya te registraste cuando
`MAIL_MAILER=log`, pulsa **Reenviar enlace** en la pantalla de verificación:
aquel correo se marcó como entregado por el transporte de desarrollo, pero nunca
llegó a una bandeja. Desde el navegador donde te registraste, el login te
llevará a esa pantalla; desde otro, usa **Crear cuenta → ¿Ya te registraste?
Solicita otro enlace** e indica tu dirección. El reenvío tiene un intervalo
mínimo de 60 segundos. La dirección pública no recibe estos correos; solo
aparecen en Mailpit. El SMTP no se publica fuera de la red de Docker y la
interfaz web solo escucha en localhost. El puerto web se puede cambiar con
`MAILPIT_PORT` (el acceso directo de la pantalla usa el puerto predeterminado
8025).

En este stack, `APP_URL` sigue siendo el servidor Laravel (`localhost:8000`) y
`FRONTEND_URL` dirige los enlaces de los correos al frontend (`localhost:4200`).

## Verificación

Las pruebas de backend **son destructivas** para la base de datos objetivo. El
guard exige un nombre terminado en `_test`: no uses `uvh_local`.

Todo lo que sigue, en el orden de la CI y deteniéndose en el primer fallo:

```bash
node scripts/verify-local.mjs              # frontend y backend
node scripts/verify-local.mjs --only=frontend
node scripts/verify-local.mjs --only=backend --skip-build
```

```powershell
# Backend: calidad estática y pruebas contra una base aislada.
docker compose -f docker-compose.local.yml --env-file .env.docker.local `
  run --rm php composer quality
docker compose -f docker-compose.local.yml --env-file .env.docker.local `
  run --rm -e DB_DATABASE=uvh_test php composer test
```

```bash
# Frontend.
cd frontend
npm run lint
npm run typecheck
npm test -- --watch=false --browsers=ChromeHeadless
npm run build
npm run e2e:install   # descarga Chromium una sola vez
npm run e2e
```

CI ejecuta estas comprobaciones desde lockfiles, con permisos de repositorio de
solo lectura y una base PostgreSQL efímera `uvh_test`, en nueve jobs:

> **Estado de la CI (comprobado el 2026-10-16): la cuenta de GitHub sigue
> bloqueada por facturación.** Los workflows son válidos y sus jobs se crean,
> pero ninguno arranca: aparecen como `failure` en segundos con `steps: []` y la
> anotación *“The job was not started because your account is locked due to a
> billing issue”* (últimos runs: CI #128, CodeQL #133, Security scans #78).
> Ningún commit lo arregla —se corrige en la cuenta o se mueve la ejecución a
> un runner propio—, así que hasta entonces la evidencia de una tanda es
> `node scripts/verify-local.mjs`: los pasos de los trabajos `frontend` y
> `backend`, ejecutados y reproducibles. Los trabajos de navegador, runtime y
> cadena de suministro no se ejecutan ahí —duran decenas de minutos cada uno— y
> se invocan por su propia entrada, la que figura en la tabla.

| Job | Contenido | Entrada local |
| --- | --- | --- |
| Frontend | `npm audit`, `lint`, `typecheck`, tests con Karma y build de producción. | `node scripts/verify-local.mjs --only=frontend` |
| Backend | `composer validate` y `audit`, `composer quality` (Pint + PHPStan), `migrate:fresh` y PHPUnit contra `uvh_test`. | `node scripts/verify-local.mjs --only=backend` |
| Browser | Recorridos críticos de Playwright sobre una pila efímera. | `npm run e2e` |
| Browser (release) | Smoke del proxy sobre las imágenes de producción, con SBOM y gate de CRITICAL. | `npm run release:e2e` |
| Runtime (boot) | Que cada invariante rota de producción detenga el contenedor al arrancar. | `npm run release:boot` |
| Runtime (async) | Workers y scheduler reales hasta el estado durable, con el drill de contención analítica. | `npm run e2e:async` |
| Runtime (backup) | Backup, destrucción y restore con RPO/RTO medidos. | `npm run e2e:backup` |
| Supply chain (digests) | Que cada imagen base fijada siga resolviendo en el registro. | `node scripts/check-image-digests.mjs` |
| Supply chain (bases) | Escaneo CRITICAL con parche de cada base fijada del árbol. | `node scripts/scan-pinned-images.mjs` |

Últimos recuentos de suites registrados en
[docs/release-evidence/](docs/release-evidence): backend **3015 pruebas /
35 029 aserciones** y frontend **2254 pruebas** en ChromeHeadless (14 de octubre
de 2026), más 2266 pruebas de frontend el 16 de octubre tras la revisión de
apertura de aplicaciones. Son recuentos fechados, no una promesa del árbol
actual: la tanda que juzgue un cambio es la que se ejecute sobre ese cambio.

Antes de tocar el baseline de Larastan, lee
[docs/static-analysis.md](docs/static-analysis.md); los recorridos de navegador
se describen en [docs/e2e-testing.md](docs/e2e-testing.md).

## Identidad visual y vista aislada

El panel usa una identidad editorial (papel, tinta y acento terracota; Manrope
para texto, monoespaciada para etiquetas y datos; marcos hairline de 3px en
lugar de tarjetas redondeadas con sombra) definida por tokens en
`frontend/src/app/core/_identity-tokens.scss` y `frontend/src/styles.scss`, con
temas claro y oscuro, contraste medido (WCAG 2.2 AA) y microinteracciones
cuidadas con soporte de `prefers-reduced-motion`. Las convenciones, la escala
tipográfica y la deuda conocida están en
[docs/design-system.md](docs/design-system.md).

Para revisar componentes reales de panel sin backend ni credenciales existe un
punto de entrada aislado con datos ficticios, en su propio build
(`dist/design-preview`, separado de `dist/uvh`):

```bash
cd frontend
node node_modules/@angular/cli/bin/ng.js serve --configuration design-preview \
  --host 127.0.0.1 --port 4301 --no-open
```

Detalles y límites en [frontend/design-preview/README.md](frontend/design-preview/README.md).
No es un sustituto de las pruebas funcionales ni debe desplegarse.

## Seguridad

Controles aplicados, entre otros:

- cookies `HttpOnly`, `SameSite` y `Secure` en producción, más protección CSRF;
- tokens y sesiones almacenados mediante hash, y secretos sensibles cifrados en
  reposo (incluidos destinos de inspección y assets QR);
- MFA TOTP, códigos de recuperación y reautenticación (step-up) para operaciones
  críticas;
- aislamiento de tenant y roles revalidados dentro de las transacciones;
- protección SSRF para webhooks e inspección de destinos, con validación estricta
  de destinos, DNS y redirecciones;
- hCaptcha verificado servidor a servidor, con timeout y fallo cerrado;
- CSP estricta con Trusted Types y `worker-src 'self'` para los workers de QR;
- límites de tasa por superficie (credenciales en BD, volumen en Redis),
  idempotencia cifrada y versiones optimistas frente a ediciones concurrentes;
- auditoría append-only, retención configurable y contenedores de producción no
  privilegiados con filesystem de solo lectura y secretos montados fuera de la
  imagen.

No publiques vulnerabilidades, credenciales, datos personales ni pruebas de
concepto sensibles en una issue. Consulta [docs/security.md](docs/security.md) y
el [modelo de amenazas](docs/threat-model.md).

## Configuración y funciones tras bandera

La referencia completa de variables —obligatoriedad, valores por defecto, qué
pasa si faltan e interruptores de seguridad— está en
[docs/configuration.md](docs/configuration.md). Las funciones experimentales
nacen desactivadas y se activan por entorno:

| Variable | Por defecto | Función |
| --- | --- | --- |
| `UVH_FEATURE_RULE_SIMULATOR` | `true` | Simulador de reglas de redirección. |
| `UVH_FEATURE_LINK_HISTORY` | `true` | Historial de ediciones de enlaces. |
| `UVH_FEATURE_LINK_HISTORY_RESTORE` | `true` | Restauración desde el historial. |
| `UVH_LINK_WORKFLOWS_ENABLED` | `false` | Flujos avanzados de enlaces (favoritos, filtros, avisos, duplicación, página personalizada). |
| `UVH_FEATURE_SHARED_REPORTS` | `false` | Informes compartidos públicos. |
| `UVH_FEATURE_SOCIAL_PREVIEWS` | `false` | Tarjetas sociales. |
| `UVH_FEATURE_APP_PROVIDERS` | `false` | Apertura de Spotify/YouTube/Maps. |
| `UVH_FEATURE_NATIVE_APPS` | `false` | Apps propias vía AASA / Asset Links. |

Las migraciones de cada función son aditivas y se aplican con
`php artisan migrate --force` **antes** de desplegar el frontend.

## Despliegue

- **Desarrollo**: `docker-compose.local.yml` (API, workers, scheduler, Redis,
  PostgreSQL, Adminer y Mailpit, todo en loopback).
- **Producción**: `docker-compose.upcloud.yml` + `docker-compose.upcloud-mail.yml`,
  con imágenes inmutables verificadas por digesto, workers aislados por cola
  (`mail`, `webhooks`, `domains`, `exports`, `analytics`, `security`,
  `destinations`×2 y `legacy`), migración como tarea única previa, edge Caddy
  con TLS y secretos montados como ficheros. Runbook:
  [docs/upcloud-production-runbook.md](docs/upcloud-production-runbook.md).
- **Antes de publicar**: gate de
  [docs/production-readiness.md](docs/production-readiness.md) y registro con
  [docs/release-evidence-template.md](docs/release-evidence-template.md). Las
  evidencias fechadas de cada candidatura están en
  [docs/release-evidence/](docs/release-evidence).

## Documentación

### Referencia

| Documento | Contenido |
| --- | --- |
| [Arquitectura](docs/architecture.md) | Componentes, flujos, hosts y decisiones técnicas. |
| [API](docs/api.md) | Contratos HTTP, autenticación, step-up y errores. |
| [Despliegue](docs/deployment.md) | Desarrollo, producción, TLS, secretos y operación. |
| [Configuración](docs/configuration.md) | Referencia de todas las variables e interruptores de seguridad. |
| [Seguridad](docs/security.md) | Controles de aplicación y checklist de release. |
| [Modelo de amenazas](docs/threat-model.md) | Activos, actores, amenazas y riesgos pendientes. |
| [Sistema de diseño](docs/design-system.md) | Tokens, temas, tipografía y convenciones visuales del panel. |
| [Pruebas E2E](docs/e2e-testing.md) | Aislamiento, ejecución, cobertura y límites de Playwright. |
| [Análisis estático](docs/static-analysis.md) | Configuración de Pint y Larastan, y su baseline. |
| [Control local](docs/local-control.md) | Panel web local, arranque y diagnóstico. |
| [Redis](docs/redis-operations.md) | Qué vive en Redis, operación y modo degradado. |
| [Matriz de exportación](docs/data-export-matrix.md) | Contenido autoritativo de las exportaciones de datos. |
| [Política npm audit](docs/npm-audit-policy.md) | Excepciones y caducidad de avisos de dependencias. |
| [Backlog](docs/current-backlog.md) | Trabajo vigente por prioridades (histórico en [docs/archive/todos.md](docs/archive/todos.md)). |

### Funciones de producto

| Documento | Contenido |
| --- | --- |
| [Flujos de enlaces](docs/link-workflows.md) | Duplicar, favoritos, filtros, avisos, página personalizada, inspección de destinos. |
| [Nombres y búsqueda global](docs/link-names-global-search.md) | Nombre interno, paleta `Buscar…` y contrato de `GET /api/v1/search`. |
| [QR avanzados](docs/advanced-qr.md) | Diseño único, archivos, impresión, lotes y campañas. |
| [Activación de QR](docs/advanced-qr-activation.md) | Pasos para activar la función en un entorno. |
| [Apertura de apps](docs/native-apps/README.md) | Spotify/YouTube/Maps, AASA, Asset Links y límites. |
| [Estado público](docs/public-status-feed.md) | Contrato del feed externo de estado. |

### Operación y runbooks

| Documento | Contenido |
| --- | --- |
| [Preparación para producción](docs/production-readiness.md) | Evidencias obligatorias antes del lanzamiento. |
| [Plantilla de evidencia](docs/release-evidence-template.md) | Registro de digests, proveedores, carga, restore, alertas y rollback. |
| [Incidente e indisponibilidad](docs/incident-runbook.md) | Detección, triaje por superficie, recuperación y cierre. |
| [Producción UpCloud](docs/upcloud-production-runbook.md) | Despliegue, verificación de bundles y operación del VPS. |
| [Backup y restore](docs/backup-and-restore.md) | Copias, destrucción controlada y recuperación. |
| [Rotación de `APP_KEY`](docs/app-secret-rotation-runbook.md) | Procedimiento de rotación de secretos. |
| [Outbox de correo](docs/mail-outbox-runbook.md) | Cola, reintentos y diagnóstico de envíos. |
| [Presupuesto de invitaciones](docs/invitation-mail-budget-runbook.md) | Límites y comportamiento ante agotamiento. |
| [Pausa de registros](docs/registration-pause-runbook.md) | Pausa temporal de registros operable desde admin. |
| [Fallback local de captcha](docs/local-captcha-fallback.md) | Verificación en desarrollo sin proveedor real. |
| [Disponibilidad de redirección y webhooks](docs/redirect-and-webhook-availability-policy.md) | Política ante dependencias degradadas. |
| [Procedencia de imágenes](docs/image-provenance-runbook.md) | Digestos, SBOM y trazabilidad de imágenes. |
| [Precisión de eventos de clic](docs/click-event-precision-runbook.md) | Medición y diagnóstico de eventos. |
| [Reputación de URLs](docs/url-reputation-runbook.md) | Comprobación de destinos y reputación. |
| [Capacidad de rollups](docs/analytics-rollup-capacity.md) | Dimensionado de agregaciones. |
| [Índice de autores de enlaces](docs/link-author-index-runbook.md) | Mantenimiento del índice. |

### Legal, roadmaps y evidencias

| Documento | Contenido |
| --- | --- |
| [Documentos legales](docs/legal/README.md) | Términos, privacidad y publicación versionada. |
| [Roadmap de primeros pasos](docs/getting-started-roadmap.md) | Guía de incorporación al producto. |
| [Roadmap de uso de workspaces](docs/workspace-usage-roadmap.md) | Evolución de cuotas y uso. |
| [Roadmap de actividad](docs/workspace-activity-roadmap.md) | Evolución del registro de actividad. |
| [Evidencias de release](docs/release-evidence/) | Validaciones fechadas por candidatura (sharing, app-opening, upcloud…). |
| [Cierre del informe ZIP](docs/report-remediation-2026-09-08.md) | Trazabilidad F01–F26 y límites de lo aún no acreditado. |

Los documentos con fecha en el nombre son el **registro histórico** de una
decisión o auditoría concreta; describen el estado de ese día y no el estado
actual del proyecto. Están en [`docs/`](docs).

## Contribuir

1. Crea una rama desde `main`.
2. Mantén los cambios pequeños, documentados y acompañados de pruebas.
3. No incluyas secretos ni datos reales en fixtures, logs o capturas.
4. Ejecuta las comprobaciones de backend y frontend aplicables
   (`node scripts/verify-local.mjs` es la referencia reproducible).
5. Abre un pull request y completa la lista de verificación incluida.

Los cambios que afecten autenticación, autorización, cifrado, retención, correo,
webhooks o bloqueos de base de datos deben explicar sus invariantes y su plan de
rollback en el pull request. Las funciones nuevas documentan su uso, sus
contratos y sus pasos de despliegue en `docs/`.

## Estado del proyecto

El repositorio distingue deliberadamente tres estados, que **no** son
equivalentes:

- **Implementado:** el código existe y fue revisado.
- **Validado:** existe evidencia automatizada o manual concreta.
- **Listo para producción:** además se han completado infraestructura real,
  restauración de backups, TLS/DNS, observabilidad, accesibilidad y revisión
  legal.
