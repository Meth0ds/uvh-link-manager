# UVH — Arquitectura

> **Enlaces cortos. Control total.**

Documento de arquitectura del sistema. Describe hosts, componentes, flujos y decisiones técnicas.

## 1. Visión general

UVH es una plataforma de acortamiento, administración y analítica de enlaces con dos superficies:

| Host          | Función                                                                                          |
| ------------- | ------------------------------------------------------------------------------------------------ |
| `uvh.es`      | Landing pública, resolución de enlaces cortos (redirección HTTP real), páginas legales, denuncia |
| `app.uvh.es`  | SPA Angular autenticada. La API vive bajo `/api/v1`                                              |

**Regla crítica de seguridad:** la cookie de sesión del panel pertenece **solo** a `app.uvh.es`. No existe cookie compartida sobre `.uvh.es`. `COOKIE_DOMAIN` se mantiene siempre vacío.

## 2. Stack

| Capa          | Tecnología                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| Frontend      | Angular 22, TypeScript estricto, Angular Material + CDK, Signals, componentes standalone, lazy loading  |
| Backend       | Laravel 13 (PHP 8.4), Eloquent/Query Builder, cola `database`, scheduler                                |
| Base de datos | PostgreSQL 16 (local vía Docker Compose), transacciones con `lockForUpdate` para carreras               |
| Email         | Resend (transaccional: verificación y recuperación)                                                     |
| QR            | Generación local con `qrcode` (PNG), sin llamadas externas ni visita al destino                         |
| Tests         | PHPUnit (Laravel) + Karma/Jasmine (Angular)                                                             |

Prohibidos y no usados: React, Vue, Svelte, Bootstrap, PrimeNG, Tailwind como framework principal, y cualquier BaaS (Convex, Supabase, Firebase, Appwrite, Auth0, Clerk, PocketBase).

## 3. Estructura del repositorio

```
uvh/
├── frontend/                 # SPA Angular
│   └── src/app/
│       ├── core/             # servicios (API, auth, workspace, theme), guards, modelos DTO
│       ├── auth/             # login, registro, MFA, verificación, recuperación
│       ├── landing/          # landing pública
│       ├── legal/            # términos, privacidad y denuncia pública (abuse report)
│       └── panel/            # dashboard, links, analytics, domains, team, tokens, webhooks, settings, admin
├── backend-laravel/          # API Laravel
│   └── app/
│       ├── Http/Controllers/ # auth, links, analytics, workspaces, domains, tokens, webhooks, admin, public
│       ├── Http/Middleware/  # sesión (uvh.session), auth, csrf, workspace, apitoken, mfa, host, security headers
│       ├── Support/          # SessionManager, Ssrf, UvhCrypto, Captcha, Totp, Audit, WebhookService…
│       ├── Jobs/             # WebhookDeliveryJob (cola asíncrona)
│       └── Console/Commands/ # UvhHousekeeping (purgas y transiciones de estado)
└── docs/                     # esta documentación
```

## 4. Flujo de datos

### 4.1 Creación de enlace (panel)

```
Angular (form tipado) → POST /api/v1/links (cookie + CSRF + X-Workspace-Id)
  → middleware uvh.auth:verified + uvh.workspace:editor
  → validación del destino, alias, UTM, reglas
  → generación de alias criptográficamente seguro (o alias personalizado validado)
  → INSERT transaccional en links + redirect_rules + link_tags
  → auditoría append-only
  → respuesta DTO
```

### 4.2 Resolución de enlace (la función más importante)

```
GET uvh.es/{alias} (o dominio personalizado)
  → validar Host → normalizar alias → buscar por host+alias
  → comprobar estado, activación, expiración, contraseña, máximo de clics, uso único
  → evaluar redirect_rules (prioridad determinista) → destino final
  → validar destino (solo http/https, sin schemes prohibidos)
  → responder 302/307 REAL (sin JS, sin Angular→window.location)
  → emitir click_event de forma asíncrona (la respuesta no espera a la analítica pesada)
```

La redirección **no visita** el destino. El clic se registra con `UPDATE ... WHERE` atómico para `single_use` y `max_clicks`, de modo que dos peticiones simultáneas solo consumen una (testeado con concurrencia real en `backend-laravel/tests/Feature/ApiParityTest.php`).

## 5. Modelo de datos

Tablas (PostgreSQL, con claves foráneas, índices y constraints):

- `users`, `sessions`
- `workspaces`, `memberships` (roles owner/admin/editor/viewer), `invitations`
- `links`, `tags`, `link_tags`
- `redirect_rules` (país, idioma, dispositivo, SO, horario, referente, campaña, prioridad)
- `custom_domains` (estados pending/verifying/verified/active/error/disabled; verificación por DNS TXT)
- `click_events`, `metric_rollups` (agregación por día)
- `api_tokens` (solo hash almacenado), `webhooks`, `webhook_deliveries`
- `abuse_reports`, `audit_events` (append-only), `quotas`, `email_tokens`

Las fechas se almacenan siempre en UTC (ISO 8601). La zona horaria solo se aplica al presentar o interpretar la entrada.

## 6. Autenticación y autorización

- **Sesión SPA:** cookie `HttpOnly` + `SameSite` + `Secure` en producción (implementación propia en `SessionManager`, hash SHA-256 del token en BD), CSRF de doble envío en mutaciones, regeneración de sesión tras login, reautenticación para operaciones sensibles y MFA (TOTP + códigos de recuperación).
- **Nunca** `localStorage`/`sessionStorage` para credenciales o tokens (solo se usa `localStorage` para preferencias no sensibles: workspace seleccionado y tema).
- **Autorización 100% en backend** con comprobación de pertenencia al workspace y rol (`WorkspaceAccess`). Los guards de Angular son solo UX; nunca son una frontera de seguridad.
- Los endpoints administrativos exigen `is_admin` + MFA activado (`uvh.mfa`).

## 7. Trabajos programados (scheduler)

El backend ejecuta cada 60 s un job (`UvhHousekeeping`) que:

1. activa enlaces `scheduled` vencidos;
2. caduca enlaces `expired`;
3. purga `click_events` y `metric_rollups` según retención;
4. reintenta `webhook_deliveries` pendientes con backoff;
5. limpia sesiones/tokens revocados y expirados.

En local corre con `php artisan schedule:work` (contenedor `schedule` del Compose). La entrega de webhooks es asíncrona vía cola `database` (`WebhookDeliveryJob`), procesada por el worker `php artisan queue:work`.

## 8. Decisiones de seguridad destacadas

- Validación de destino: solo `http`/`https`, rechazo de `javascript:`, `data:`, `file:`, credenciales embebidas, CR/LF.
- SSRF en webhooks (`app/Support/Ssrf.php`): bloqueo de loopback, redes privadas, link-local y metadata cloud, IPs fijadas con `CURLOPT_RESOLVE` y sin redirecciones.
- Hash de tokens de API, sesiones y tokens de email (SHA-256); secretos de webhook y TOTP cifrados en reposo (AES-256-GCM).
- Auditoría append-only de acciones sensibles.
- Rate limiting diferenciado por endpoint (login, registro, recuperación, MFA, creación de enlaces, alias, API, webhooks, denuncias, admin).
- Ver `docs/security.md` y `docs/security-audit-2026-08-19.md`.