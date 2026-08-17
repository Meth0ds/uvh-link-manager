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

## 2. Stack real (decidido tras inspección del entorno)

El plan original proponía Laravel/PHP. **Freebuff Cloud es un entorno de ejecución Node.js-only** (no hay `php` ni `composer` en la imagen de preview ni en la de deploy). Por ello el backend se implementó con el equivalente soportado por el entorno, sin cambiar el modelo de producto ni la arquitectura de hosts:

| Capa          | Tecnología                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------- |
| Frontend      | Angular 19, TypeScript estricto, Angular Material + CDK, Signals, componentes standalone, lazy loading  |
| Backend       | Express 4 + TypeScript (estricto), Zod, bcryptjs, otplib, express-rate-limit                            |
| Base de datos | SQLite (módulo nativo `node:sqlite`), modo WAL, `BEGIN IMMEDIATE` para transacciones atómicas           |
| Email         | Resend (transaccional: verificación y recuperación)                                                     |
| QR            | Generación local con `qrcode` (PNG), sin llamadas externas ni visita al destino                         |
| Tests         | Vitest + Supertest (backend)                                                                             |

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
├── backend/                  # API Express
│   └── src/
│       ├── routes/           # auth, links, analytics, workspaces, domains, tokens, webhooks, admin, abuse, public, redirect
│       ├── services/         # links, redirect, analytics, webhooks
│       ├── middleware/       # auth (sesión), csrf, ratelimit, apitoken
│       └── util/             # url, ssrf, audit, email, ids, sign, analytics
└── docs/                     # esta documentación
```

## 4. Flujo de datos

### 4.1 Creación de enlace (panel)

```
Angular (form tipado) → POST /api/v1/links (cookie + CSRF + X-Workspace-Id)
  → middleware requireAuth + authorizeWorkspace(role editor+)
  → validación Zod del destino, alias, UTM, reglas
  → generación de alias criptográficamente seguro (o alias personalizado validado)
  → INSERT atómico en links + redirect_rules + link_tags
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

La redirección **no visita** el destino. El clic se registra con `UPDATE ... WHERE` atómico para `single_use` y `max_clicks`, de modo que dos peticiones simultáneas solo consumen una (testeado con concurrencia real en `backend/tests/api.test.ts`).

## 5. Modelo de datos

Tablas (todas con `foreign_keys=ON`, índices y constraints):

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

- **Sesión SPA (Sanctum-style):** cookie `HttpOnly` + `SameSite` + `Secure` en producción, CSRF de doble envío en mutaciones, regeneración de sesión tras login, reautenticación para operaciones sensibles y MFA (TOTP + códigos de recuperación).
- **Nunca** `localStorage`/`sessionStorage` para credenciales o tokens (solo se usa `localStorage` para preferencias no sensibles: workspace seleccionado y tema).
- **Autorización 100% en backend** con comprobación de pertenencia al workspace y rol (`authorizeWorkspace`). Los guards de Angular son solo UX; nunca son una frontera de seguridad.

## 7. Trabajos programados (scheduler in-process)

El backend ejecuta cada 60 s un job que reemplaza al cron de Laravel:

1. activa enlaces `scheduled` vencidos;
2. caduca enlaces `expired`;
3. purga `click_events` y `metric_rollups` según retención;
4. reintenta `webhook_deliveries` pendientes con backoff.

**Limitación (documentada en `deployment.md`):** en Freebuff Cloud no hay workers ni cron persistentes garantizados; el scheduler corre dentro del proceso de la API. Si el proceso se reinicia, el job se reanuda al arrancar.

## 8. Decisiones de seguridad destacadas

- Validación de destino con `URL` nativo + lista de schemes permitidos (`http`, `https`), rechazo de `javascript:`, `data:`, `file:`, credenciales embebidas, CR/LF.
- SSRF en webhooks: bloqueo de loopback, redes privadas, link-local y metadata cloud, con revalidación de DNS/IP tras cada redirect.
- Hash de tokens de API y secretos de webhook (HMAC con event id + timestamp).
- Auditoría append-only de acciones sensibles.
- Rate limiting diferenciado por endpoint (login, registro, recuperación, MFA, creación de enlaces, alias, API, webhooks, denuncias, admin).
