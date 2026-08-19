# UVH — API

API REST bajo `/api/v1` (panel en `app.uvh.es`). Toda mutación requiere `X-CSRF-Token`; las rutas protegidas además requieren cookie de sesión. Las rutas de workspace requieren la cabecera `X-Workspace-Id` y autorizan por rol en backend.

- Roles: `owner` > `admin` > `editor` > `viewer`.
- `requireVerified` = email verificado.
- Errores: `{ "error": string, "details?": unknown }`.

## Autenticación — `/api/v1/auth`

| Método | Ruta | Auth | Descripción |
| ------ | ---- | ---- | ----------- |
| GET | `/captcha` | — | Obtiene un desafío aritmético accesible de un solo uso (IP-bound, 5 min). |
| POST | `/register` | — | Registro multistep. Requiere `name`, `email`, `password`, `captchaChallenge`, `captchaAnswer`, `acceptTerms: true` y `termsVersion`; el honeypot `website` debe estar vacío. Crea usuario + workspace + cuota, audita el consentimiento y envía email de verificación sin crear sesión. |
| POST | `/login` | — | Login solo para cuentas con email verificado. Si MFA: `{ mfaRequired, challenge }`; si no: `{ user }`; una cuenta no verificada recibe `403` y no crea sesión. |
| POST | `/change-registration-email` | — | Corrige una dirección de registro no verificada con `{ currentEmail, newEmail, password, captchaChallenge, captchaAnswer }`; invalida el token anterior y envía uno nuevo, sin crear sesión. |
| POST | `/mfa/verify` | — | Completa login MFA con `{ challenge, code }` → `{ user }`. |
| POST | `/mfa/recovery` | — | Login con código de recuperación `{ email, code }`. |
| POST | `/logout` | sesión | Revoca la sesión actual. |
| POST | `/verify-email` | — | `{ token }` → verifica el email, consume el bearer token y revoca cualquier sesión legacy/preexistente; el acceso posterior exige un login nuevo. |
| POST | `/resend-verification` | — / sesión | Reenvía el correo de verificación con `{ email }` cuando no hay sesión. La respuesta pública es genérica (anti-enumeración) y aplica cooldown de 60 s. |
| POST | `/forgot-password` | — | `{ email }` → envía enlace (respuesta idéntica siempre, anti-enumeración). |
| POST | `/reset-password` | — | `{ token, password }` → restablece y revoca sesiones; el token se consume atómicamente y solo puede funcionar una vez. |
| GET | `/me` | sesión | `{ user }`. |
| PATCH | `/profile` | sesión | `{ name }`. |
| POST | `/change-password` | sesión | `{ current, newPassword }`. |
| GET | `/sessions` | sesión | `{ sessions[] }`, incluyendo `current` para identificar el navegador actual. |
| POST | `/sessions/:id/revoke` | sesión | Revoca una sesión; si es la actual devuelve `current: true`, borra la cookie y el panel cierra sesión inmediatamente (también sincroniza otras pestañas). |
| POST | `/mfa/setup` | sesión | `{ password, code? }` → `{ secret, uri }`; `code` es obligatorio al reconfigurar MFA activo. |
| POST | `/mfa/enable` | sesión | `{ code }` → `{ recoveryCodes[] }`. |
| POST | `/mfa/disable` | sesión | `{ password, code }`; exige contraseña y TOTP actual (step-up). |

## Enlaces — `/api/v1/links` (workspace)

| Método | Ruta | Rol | Descripción |
| ------ | ---- | --- | ----------- |
| GET | `/` | viewer | Listado con `q, state, tag, sort, page, perPage` → `{ links, total, page, perPage }`. |
| POST | `/` | editor | Crear enlace (destino, alias, dominio, UTM, notas, programación, expiración, contraseña, máx. clics, uso único, fallback, reglas, tags). |
| POST | `/check-alias` | viewer | `{ alias, domainId }` → `{ available, reason? }`. |
| GET | `/:id` | viewer | `{ link, rules[] }`. |
| PATCH | `/:id` | editor | Editar enlace. |
| POST | `/:id/state` | editor | `{ state }` (active/paused/archived). |
| DELETE | `/:id` | editor | Soft delete. |
| POST | `/:id/restore` | editor | Restaura. |
| GET | `/:id/activity` | viewer | `{ events[] }` (auditoría del enlace). |

## Analítica — `/api/v1/analytics`

| Método | Ruta | Auth | Descripción |
| ------ | ---- | ---- | ----------- |
| GET | `/overview` | sesión + workspace viewer | `period` (`24h`,`7d`,`30d`,`90d`), `linkId?` → resumen + series + topLinks + desgloses. |
| GET | `/public/overview` | API token `analytics:read` | Igual que arriba para integraciones. |

## Workspaces — `/api/v1/workspaces`

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| GET | `/` | `{ workspaces[] }` del usuario. |
| POST | `/` | Crear workspace. |
| GET | `/:id` | `{ workspace, members[], invitations[] }`. |
| PATCH | `/:id` | Renombrar (admin/owner). |
| PATCH | `/:id/members/:userId` | Cambiar rol (admin/owner). |
| DELETE | `/:id/members/:userId` | Eliminar miembro. |
| POST | `/:id/leave` | Abandonar (no owner). |
| DELETE | `/:id` | Eliminar (owner). |
| POST | `/:id/invitations` | Invitar `{ email, role }`. |
| POST | `/invitations/accept` | Aceptar invitación (token). |
| POST | `/invitations/reject` | Rechazar invitación (token). |
| DELETE | `/:id/invitations/:invitationId` | Cancelar invitación. |
| POST | `/:id/invitations/:invitationId/resend` | Reenviar invitación. |

## Dominios — `/api/v1/domains` (workspace)

| Método | Ruta | Rol | Descripción |
| ------ | ---- | --- | ----------- |
| GET | `/` | viewer | `{ domains[] }`. |
| POST | `/` | editor | Alta de dominio → genera desafío TXT. |
| POST | `/:id/verify` | editor | Comprueba el TXT y pasa a `verified`. |
| POST | `/:id/activate` | editor | Activa el dominio. |
| POST | `/:id/disable` | editor | Desactiva. |
| POST | `/:id/revalidate` | editor | Revalida el TXT. |
| DELETE | `/:id` | editor | Elimina. |

## API tokens — `/api/v1/tokens` (workspace)

| Método | Ruta | Rol | Descripción |
| ------ | ---- | --- | ----------- |
| GET | `/` | editor | `{ tokens[] }` (sin el secreto). |
| POST | `/` | editor | `{ name, scopes[], expiresAt? }` → `{ token }` (se muestra **una sola vez**). |
| DELETE | `/:id` | editor | Revocar. |

Scopes: `links:read`, `links:write`, `analytics:read`, `domains:read`, `domains:write`. Autenticación de API: cabecera `Authorization: Bearer <token>`.

## Webhooks — `/api/v1/webhooks` (workspace)

| Método | Ruta | Rol | Descripción |
| ------ | ---- | --- | ----------- |
| GET | `/` | viewer | `{ webhooks[] }`. |
| POST | `/` | editor | `{ url, events[], secret }`. |
| PATCH | `/:id` | editor | Editar. |
| DELETE | `/:id` | editor | Eliminar. |
| GET | `/:id/deliveries` | viewer | `{ deliveries[] }`. |
| POST | `/:id/deliveries/:deliveryId/resend` | editor | Reenvío manual. |
| POST | `/:id/test` | editor | Entrega de prueba. |

Eventos: `link.created`, `link.updated`, `link.deleted`, `link.threshold_reached`, `domain.verified`. Firma: `X-UVH-Signature` (HMAC-SHA256 del body con el secreto) + `X-UVH-Event-Id` y `X-UVH-Timestamp`.

## Administración — `/api/v1/admin` (admin + MFA)

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| GET | `/overview` | Contadores globales. |
| GET | `/users` | `{ users[] }` (búsqueda `q`). |
| PATCH | `/users/:id` | `{ isAdmin?, blocked? }`. |
| GET | `/reports` | `{ reports[] }` (filtro `status`). |
| PATCH | `/reports/:id` | `{ status }`. |
| GET | `/domains` | Todos los dominios. |
| GET | `/audit` | `{ events[], total, page }`. |
| POST | `/links/:id/block` | `{ reason }` → bloquea. |
| POST | `/links/:id/unblock` | Desbloquea. |

## Denuncias / público — `/api/v1`

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| POST | `/report` | `{ linkId, reason, details?, reporterEmail? }` (rate limited). |
| GET | `/status` | Estado del módulo antiabuso (incluye si hay proveedor de reputación configurado). |

## Público

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| GET | `/health` | `{ ok: true }` (health check). |
| GET | `/robots.txt` / `/sitemap.xml` | SEO básico. |
| GET | `/:alias` | **Redirección HTTP real** (302). |
| GET | `/r/:alias` | Redirección bajo el path `/r`. |

> **Comportamiento congelado:** la superficie de redirección (`/:alias` y `/r/:alias`)
> **no** usa el sobre JSON `{ error }`. Para alias/dominio desconocido o enlace no redirigible
> devuelve una **página HTML** con status 404 (no `{ error }`); solo `/api/v1/*` usa el sobre JSON.
> Ver `backend-laravel/tests/Feature/ApiParityTest.php`.
| POST | `/r/:alias/unlock` | `{ password }` para enlaces protegidos (luego redirige). |
