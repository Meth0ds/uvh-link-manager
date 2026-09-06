<div align="center">

# UVH Link Manager

### Enlaces cortos, dominios propios y analítica con seguridad por diseño

[![CI](https://github.com/Meth0ds/uvh-link-manager/actions/workflows/ci.yml/badge.svg)](https://github.com/Meth0ds/uvh-link-manager/actions/workflows/ci.yml)
[![CodeQL](https://github.com/Meth0ds/uvh-link-manager/actions/workflows/codeql.yml/badge.svg)](https://github.com/Meth0ds/uvh-link-manager/actions/workflows/codeql.yml)
[![Angular 22](https://img.shields.io/badge/Angular-22-DD0031?logo=angular)](https://angular.dev/)
[![Laravel 13](https://img.shields.io/badge/Laravel-13-FF2D20?logo=laravel)](https://laravel.com/)
[![PostgreSQL 16](https://img.shields.io/badge/PostgreSQL-16-4169E1?logo=postgresql&logoColor=white)](https://www.postgresql.org/)

</div>

UVH es una plataforma para crear, administrar y observar enlaces cortos. Reúne
una SPA Angular, una API Laravel y PostgreSQL en una arquitectura multi-tenant
con controles explícitos de autorización, antiabuso, auditoría y aislamiento de
datos.

> [!IMPORTANT]
> El código y sus pruebas automatizadas están en desarrollo activo. Un build
> correcto no acredita por sí solo un despliegue listo para producción. Consulta
> la [lista de preparación para producción](docs/production-readiness.md) antes
> de publicar el servicio.

## Capacidades principales

| Área | Capacidades |
| --- | --- |
| Enlaces | Alias seguros, programación, caducidad, reglas de redirección, UTM, etiquetas, límites de clics, un solo uso y papelera recuperable. |
| Dominios | Verificación DNS, diagnóstico operativo, estados explícitos y controles de acceso por rol. |
| Analítica | Eventos y agregados con retención configurable, filtros y exportación controlada. |
| Equipos | Workspaces aislados, roles `owner`/`admin`/`editor`/`viewer`, invitaciones y transferencia de propiedad. |
| Integraciones | Tokens API con scopes, webhooks firmados, reintentos e inspector con payload reducido por allowlist. |
| Cuenta | Sesiones revocables, verificación de correo, MFA TOTP, códigos de recuperación y operaciones sensibles con reautenticación. |
| Operación | Cola, scheduler, auditoría append-only, métricas, estado público externo y comprobaciones previas de release. |

## Arquitectura

```text
Navegador
   ├── uvh.es          → landing, legales y redirecciones públicas
   └── app.uvh.es      → Angular 22 SPA
                              │
                              ▼
                        Laravel 13 API
                         │     │     │
                         │     │     └── worker de webhooks/correo
                         │     └──────── scheduler de mantenimiento
                         └────────────── PostgreSQL 16
```

- El panel y la API autenticada viven en `app.uvh.es`.
- La cookie de sesión nunca se comparte con `.uvh.es`; `COOKIE_DOMAIN` y
  `SESSION_DOMAIN` deben permanecer vacíos.
- La autorización se decide siempre en el backend. Los guards del frontend son
  una ayuda de navegación, no una frontera de seguridad.
- PostgreSQL y los servicios de desarrollo se publican únicamente en loopback.

La descripción completa está en [docs/architecture.md](docs/architecture.md).

## Stack técnico

- **Frontend:** Angular 22, TypeScript estricto, Angular Material/CDK, Signals y
  componentes standalone.
- **Backend:** Laravel 13 sobre PHP 8.4, jobs asíncronos y scheduler.
- **Datos:** PostgreSQL 16, transacciones y bloqueos pesimistas para operaciones
  con carreras.
- **Calidad:** Pint, Larastan/PHPStan, ESLint y TypeScript estricto.
- **Pruebas:** PHPUnit, Karma/Jasmine y Playwright sobre Chromium.
- **Despliegue:** Docker Compose con imágenes separadas para desarrollo y
  producción.

## Inicio rápido en Windows

Requisitos: Git, Docker Desktop y Node.js 22.

```powershell
# 1. Clona y entra en el repositorio.
git clone https://github.com/Meth0ds/uvh-link-manager.git
Set-Location uvh-link-manager

# 2. Crea la configuración local de Docker; contiene sólo credenciales de desarrollo.
Copy-Item .env.docker.local.example .env.docker.local

# 3. Prepara Laravel e instala sus dependencias bloqueadas dentro del contenedor.
Copy-Item backend-laravel/.env.example backend-laravel/.env
docker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm php composer install
docker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm php php artisan key:generate

# 4. Abre el panel local y usa "Iniciar todo".
.\UVH Control.cmd
```

El panel inicia PostgreSQL, Laravel, el worker, el scheduler y Angular. La guía
detallada, incluida la recuperación segura de Docker, está en
[docs/local-control.md](docs/local-control.md).

### Inicio multiplataforma

```bash
cp .env.docker.local.example .env.docker.local
cp backend-laravel/.env.example backend-laravel/.env
docker compose -f docker-compose.local.yml --env-file .env.docker.local up -d postgres
docker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm php composer install
docker compose -f docker-compose.local.yml --env-file .env.docker.local run --rm php php artisan key:generate
docker compose -f docker-compose.local.yml --env-file .env.docker.local --profile laravel up -d

cd frontend
npm ci
npm start
```

Por defecto, el backend escucha en `http://127.0.0.1:8000` y Angular en
`http://127.0.0.1:4200`.

## Verificación

Las pruebas de backend son destructivas para su base de datos objetivo. El
guard de pruebas exige un nombre terminado en `_test`; no uses `uvh_local`.

```powershell
# Backend: la base uvh_test debe existir y estar aislada.
docker compose -f docker-compose.local.yml --env-file .env.docker.local `
  run --rm php composer quality
docker compose -f docker-compose.local.yml --env-file .env.docker.local `
  run --rm -e DB_DATABASE=uvh_test php composer test

# Frontend.
Set-Location frontend
npm run lint
npm run typecheck
npm test -- --watch=false --browsers=ChromeHeadless
npm run build
npm run e2e:install
npm run e2e
```

CI ejecuta estas comprobaciones desde lockfiles, con permisos de repositorio de
solo lectura y una base PostgreSQL efímera llamada `uvh_test`. Consulta la
[política de análisis estático](docs/static-analysis.md) antes de modificar el
baseline de Larastan. Los recorridos de navegador usan otra pila efímera y se
describen en [pruebas E2E](docs/e2e-testing.md).

## Seguridad

UVH aplica, entre otros, estos controles:

- cookies `HttpOnly`, `Secure` en producción y `SameSite`, más protección CSRF;
- tokens y sesiones almacenados mediante hash, y secretos sensibles cifrados en
  reposo;
- MFA y reautenticación para operaciones críticas;
- aislamiento de tenant y roles revalidados dentro de las transacciones;
- protección SSRF para webhooks y validación estricta de destinos;
- hCaptcha verificado servidor a servidor, con timeout y fallo cerrado;
- rate limits por superficie, auditoría y retención configurable;
- contenedores de producción no privilegiados, filesystem de solo lectura y
  secretos montados fuera de la imagen.

No publiques vulnerabilidades, credenciales, datos personales ni pruebas de
concepto sensibles en una issue. Consulta [docs/security.md](docs/security.md) y
el [modelo de amenazas](docs/threat-model.md) para conocer el diseño actual.

## Documentación

| Documento | Contenido |
| --- | --- |
| [Arquitectura](docs/architecture.md) | Componentes, flujos, hosts y decisiones técnicas. |
| [API](docs/api.md) | Contratos HTTP, autenticación y errores. |
| [Despliegue](docs/deployment.md) | Desarrollo, producción, TLS, secretos y operación. |
| [Seguridad](docs/security.md) | Controles de aplicación y checklist de release. |
| [Modelo de amenazas](docs/threat-model.md) | Activos, actores, amenazas y riesgos pendientes. |
| [Preparación para producción](docs/production-readiness.md) | Evidencias obligatorias antes del lanzamiento. |
| [Pruebas E2E](docs/e2e-testing.md) | Aislamiento, ejecución, cobertura y límites de Playwright. |
| [TODOs](docs/todos.md) | Trabajo implementado, validado y pendiente. |

## Contribuciones

1. Crea una rama desde `main`.
2. Mantén los cambios pequeños, documentados y acompañados de pruebas.
3. No incluyas secretos ni datos reales en fixtures, logs o capturas.
4. Ejecuta las comprobaciones de backend y frontend aplicables.
5. Abre un pull request y completa la lista de verificación incluida.

Las decisiones que afecten autenticación, autorización, cifrado, retención,
correo, webhooks o bloqueos de base de datos deben explicar sus invariantes y el
plan de rollback en el pull request.

## Estado del proyecto

El repositorio distingue deliberadamente tres estados:

- **Implementado:** el código existe y fue revisado.
- **Validado:** existe evidencia automatizada o manual concreta.
- **Listo para producción:** además se han completado infraestructura real,
  restauración de backups, TLS/DNS, observabilidad, accesibilidad y revisión
  legal.

No deben usarse estos términos como equivalentes.
