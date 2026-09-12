<div align="center">

# UVH Link Manager

### Enlaces cortos, dominios propios y analítica con seguridad por diseño

[![CI](https://github.com/Meth0ds/uvh-link-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/Meth0ds/uvh-link-manager/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Meth0ds/uvh-link-manager/actions/workflows/codeql.yml/badge.svg)](https://github.com/Meth0ds/uvh-link-manager/actions/workflows/codeql.yml)
[![Angular 22](https://img.shields.io/badge/Angular-22-DD0031?logo=angular)](https://angular.dev/)
[![Laravel 13](https://img.shields.io/badge/Laravel-13-FF2D20?logo=laravel)](https://laravel.com/)
[![PHP 8.4](https://img.shields.io/badge/PHP-8.4-777BB4?logo=php&logoColor=white)](https://www.php.net/)
[![PostgreSQL 16](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)

</div>

UVH es una plataforma multi-tenant para crear, administrar y observar enlaces
cortos. Reúne una SPA Angular, una API Laravel y PostgreSQL detrás de una regla
central: **toda decisión de autorización se toma en el servidor**, con
aislamiento de datos por workspace, defensas antiabuso, auditoría append-only y
reautenticación para las operaciones sensibles.

> [!IMPORTANT]
> El proyecto está en desarrollo activo. Un build correcto **no** acredita un
> despliegue listo para producción: consulta
> [preparación para producción](docs/production-readiness.md) antes de publicar
> el servicio.

## Capacidades

| Área | Capacidades |
| --- | --- |
| Enlaces | Alias seguros, programación, caducidad, reglas de redirección, UTM, etiquetas, límites de clics, un solo uso y papelera recuperable. |
| Dominios | Verificación DNS, diagnóstico operativo, estados explícitos y controles de acceso por rol. |
| Analítica | Eventos y agregados con retención configurable, filtros y exportación controlada. |
| Equipos | Workspaces aislados, roles `owner`/`admin`/`editor`/`viewer`, invitaciones con reintento limitado y transferencia de propiedad. |
| Integraciones | Tokens API con scopes, webhooks firmados, reintentos e inspector con payload reducido por allowlist. |
| Cuenta | Sesiones revocables, verificación de correo, MFA TOTP, códigos de recuperación y operaciones sensibles con reautenticación. |
| Operación | Workers aislados por carga, scheduler, auditoría append-only, métricas por cola, estado público externo y comprobaciones previas de release. |

## Arquitectura

```text
Navegador
   ├── uvh.es          → landing, páginas legales y redirecciones públicas
   └── app.uvh.es      → SPA Angular 22
                              │
                              ▼
                        API Laravel 13
                         │     │     │
                         │     │     └── workers: mail · webhooks · domains · exports · analytics
                         │     └──────── scheduler de mantenimiento
                         └────────────── PostgreSQL 16
```

Invariantes que ninguna capa del cliente puede relajar:

- La cookie de sesión **nunca** se comparte con `.uvh.es`: `COOKIE_DOMAIN` y
  `SESSION_DOMAIN` permanecen vacíos.
- Los guards de Angular son ayuda de navegación, no una frontera de seguridad.
- PostgreSQL y los servicios de desarrollo se publican únicamente en loopback.
- Los estados, permisos y datos de gráficos no cambian al cambiar la apariencia;
  los alias semánticos `--uvh-*` desacoplan ambos.

El detalle de componentes, flujos y decisiones está en
[docs/architecture.md](docs/architecture.md).

## Stack

| Capa | Tecnología |
| --- | --- |
| Frontend | Angular 22, TypeScript estricto, Angular Material/CDK, signals y componentes standalone. |
| Backend | Laravel 13 sobre PHP 8.4, jobs asíncronos y scheduler. |
| Datos | PostgreSQL 16, transacciones y bloqueos pesimistas para operaciones con carreras. |
| Calidad | Pint, Larastan/PHPStan, ESLint (`--max-warnings=0`) y `tsc --noEmit`. |
| Pruebas | PHPUnit, Karma/Jasmine y Playwright 1.63 sobre Chromium. |
| Entrega | Docker Compose, con imágenes separadas para desarrollo y producción. |

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

# 4. Abre el panel local y pulsa "Iniciar todo".
.\UVH Control.cmd
```

### Cualquier plataforma

```bash
cp .env.docker.local.example .env.docker.local
cp backend-laravel/.env.example backend-laravel/.env
docker compose -f docker-compose.local.yml --env-file .env.docker.local up -d postgres
docker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm php composer install
docker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm php php artisan key:generate
docker compose -f docker-compose.local.yml --env-file .env.docker.local --profile laravel up -d

cd frontend && npm ci && npm start
```

El perfil `laravel` levanta la API en `http://127.0.0.1:8000`, el worker
(`queue:work` sobre las colas `mail,webhooks,domains,exports,analytics`) y el
scheduler. Angular sirve el panel en `http://127.0.0.1:4200`.

`UVH Control.cmd` orquesta lo mismo desde una interfaz de escritorio, incluidas
la recuperación segura de Docker y el diagnóstico de puertos; la guía completa
está en [docs/local-control.md](docs/local-control.md).

## Verificación

Las pruebas de backend **son destructivas** para la base de datos objetivo. El
guard exige un nombre terminado en `_test`: no uses `uvh_local`.

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
solo lectura y una base PostgreSQL efímera `uvh_test`, en cuatro jobs:

| Job | Contenido |
| --- | --- |
| Frontend | `typecheck`, tests con Karma y build de producción. |
| Backend | `composer quality` (Pint + PHPStan) y PHPUnit. |
| Browser | Recorridos críticos de Playwright sobre una pila efímera. |
| Browser (release) | Smoke del proxy sobre las imágenes de producción. |

Antes de tocar el baseline de Larastan, lee
[docs/static-analysis.md](docs/static-analysis.md); los recorridos de navegador
se describen en [docs/e2e-testing.md](docs/e2e-testing.md).

## Identidad visual y vista aislada

El panel usa una identidad editorial (papel, tinta y acento terracota; Manrope
para texto, monoespaciada para etiquetas y datos; marcos hairline de 3px en
lugar de tarjetas redondeadas con sombra) definida por tokens en
`frontend/src/styles.scss` y `frontend/src/app/core/_identity-tokens.scss`, con
temas claro y oscuro. Las convenciones y la escala tipográfica están en
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
  reposo;
- MFA y reautenticación para operaciones críticas;
- aislamiento de tenant y roles revalidados dentro de las transacciones;
- protección SSRF para webhooks y validación estricta de destinos;
- hCaptcha verificado servidor a servidor, con timeout y fallo cerrado;
- límites de tasa por superficie, auditoría y retención configurable;
- contenedores de producción no privilegiados, filesystem de solo lectura y
  secretos montados fuera de la imagen.

No publiques vulnerabilidades, credenciales, datos personales ni pruebas de
concepto sensibles en una issue. Consulta [docs/security.md](docs/security.md) y
el [modelo de amenazas](docs/threat-model.md).

## Documentación

### Referencia

| Documento | Contenido |
| --- | --- |
| [Arquitectura](docs/architecture.md) | Componentes, flujos, hosts y decisiones técnicas. |
| [API](docs/api.md) | Contratos HTTP, autenticación y errores. |
| [Despliegue](docs/deployment.md) | Desarrollo, producción, TLS, secretos y operación. |
| [Seguridad](docs/security.md) | Controles de aplicación y checklist de release. |
| [Modelo de amenazas](docs/threat-model.md) | Activos, actores, amenazas y riesgos pendientes. |
| [Sistema de diseño](docs/design-system.md) | Tokens, temas y convenciones visuales del panel. |
| [Pruebas E2E](docs/e2e-testing.md) | Aislamiento, ejecución, cobertura y límites de Playwright. |
| [Análisis estático](docs/static-analysis.md) | Configuración de Pint y Larastan, y su baseline. |
| [Control local](docs/local-control.md) | Panel de escritorio, arranque y diagnóstico. |
| [TODOs](docs/todos.md) | Trabajo implementado, validado y pendiente. |

### Evidencias de release

| Documento | Contenido |
| --- | --- |
| [Preparación para producción](docs/production-readiness.md) | Evidencias obligatorias antes del lanzamiento. |
| [Plantilla de evidencia](docs/release-evidence-template.md) | Registro de digests, proveedores, carga, restore, alertas y rollback. |
| [Cierre del informe ZIP](docs/report-remediation-2026-09-08.md) | Trazabilidad F01–F26 y límites de lo aún no acreditado. |

### Runbooks

| Documento | Contenido |
| --- | --- |
| [Rotación de `APP_KEY`](docs/app-secret-rotation-runbook.md) | Procedimiento de rotación de secretos. |
| [Outbox de correo](docs/mail-outbox-runbook.md) | Cola, reintentos y diagnóstico de envíos. |
| [Presupuesto de invitaciones](docs/invitation-mail-budget-runbook.md) | Límites y comportamiento ante agotamiento. |
| [Estado público](docs/public-status-feed.md) | Contrato del feed externo de estado. |
| [Fallback local de captcha](docs/local-captcha-fallback.md) | Verificación en desarrollo sin proveedor real. |
| [Disponibilidad de redirección y webhooks](docs/redirect-and-webhook-availability-policy.md) | Política ante dependencias degradadas. |

### Informes y planes fechados

Los documentos con fecha en el nombre son el **registro histórico** de una
decisión o auditoría concreta; describen el estado de ese día y no el estado
actual del proyecto. Están en [`docs/`](docs).

## Contribuir

1. Crea una rama desde `main`.
2. Mantén los cambios pequeños, documentados y acompañados de pruebas.
3. No incluyas secretos ni datos reales en fixtures, logs o capturas.
4. Ejecuta las comprobaciones de backend y frontend aplicables.
5. Abre un pull request y completa la lista de verificación incluida.

Los cambios que afecten autenticación, autorización, cifrado, retención, correo,
webhooks o bloqueos de base de datos deben explicar sus invariantes y su plan de
rollback en el pull request.

## Estado del proyecto

El repositorio distingue deliberadamente tres estados, que **no** son
equivalentes:

- **Implementado:** el código existe y fue revisado.
- **Validado:** existe evidencia automatizada o manual concreta.
- **Listo para producción:** además se han completado infraestructura real,
  restauración de backups, TLS/DNS, observabilidad, accesibilidad y revisión
  legal.
