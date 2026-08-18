# Revisión de seguridad exhaustiva — UVH Link Manager

Fecha: 2026-08-18 · Alcance: backend Express + SQLite (`backend/src`), frontend Angular 19 (`frontend/src`), commit base `4963dbc` + fixes posteriores.

Metodología: lectura completa del código, revisión adversarial por subsistemas (3 revisores en paralelo), pruebas de concepto empíricas en Node v24 (formatos de IP exóticos, `DELETE ... LIMIT`, `lookup` en `http.request`, canonicalización de `new URL()`), y verificación de cada hallazgo contra el código antes de corregirlo. Suite de regresión ampliada con tests por hallazgo.

## Hallazgos corregidos (ordenados por severidad)

### 1. Bypass SSRF: IPv4-mapped IPv6, formatos de transición y DNS rebinding — HIGH

`backend/src/util/ssrf.ts` clasificaba como públicos: `::ffff:127.0.0.1`, `::ffff:169.254.169.254`, NAT64 (`64:ff9b::/96`), 6to4 (`2002::/16`), Teredo (`2001::/32`) y `::`. Un dominio controlado por el atacante con registros AAAA de estos formatos llegaba a direcciones internas (metadata cloud, loopback) desde el fetcher de webhooks. Además, entre `assertSafeHost()` y `fetch()` existía el TOCTOU clásico de rebinding.

Fix: `isPrivateIp` extrae y valida el IPv4 embebido en esos formatos (+100.64.0.0/10 y 192.0.0.0/24). Nuevo `safeFetch()` que: valida IPs literales antes de conectar (Node omite `lookup` cuando el host ya es una IP — verificado empíricamente), re-valida **cada dirección resuelta en el momento de conectar**, no sigue redirects y aplica timeout duro. Webhooks usa `safeFetch`.

### 2. Escalado de privilegios: admin de workspace → owner — HIGH

`PATCH /:id/members/:userId` (`workspaces.ts`) permitía a un admin asignar `owner` (a sí mismo o a terceros) y gestionar a otros admins.

Fix: solo el owner asigna `owner` o gestiona admins; aplicado a `DELETE /:id/members/:userId` y a invitaciones con rol `admin`.

### 3. Bypass del control anti-abuso: editores desbloqueando enlaces bloqueados — HIGH

`POST /api/v1/links/:id/state` permitía a cualquier editor poner `active` un enlace bloqueado por la plataforma (y bloquear enlaces), burlando el flujo admin+MFA.

Fix: transiciones hacia/desde `blocked` requieren admin de plataforma.

### 4. Bloquear un usuario no revocaba sus API tokens — HIGH

`PATCH /api/v1/admin/users/:id` revocaba sesiones pero no los API tokens creados por el usuario, que seguían funcionando (fuga continua de `analytics:read`, vector latente de escritura).

Fix: `api_tokens.created_by` (ALTER de migración) + revocación al bloquear + test end-to-end.

### 5. IDOR: mover un enlace a un dominio de otro workspace — MEDIUM-HIGH

`PATCH /api/v1/links/:id` aceptaba `domainId` ajeno (a diferencia de `POST /links`): phishing sobre dominio de terceros y oráculo 500 por FK. Además `check-alias` filtraba disponibilidad de alias cross-tenant y `domainId: 0` producía 500.

Fix: guarda de propiedad en PATCH y `check-alias` (sin filtraciones), `domainId` positivo en los esquemas.

### 6. Enumeración de usuarios vía /mfa/recovery — MEDIUM

Mensajes distintos revelaban existencia de cuenta + MFA + códigos de recuperación.

Fix: respuesta uniforme `401 {error:"Código de recuperación incorrecto"}` en todos los caminos + throttling por cuenta.

### 7. Códigos de recuperación MFA débiles (~37 bits) — MEDIUM

`randomToken(5)` producía códigos de 7 caracteres para un login **sin contraseña**.

Fix: `randomToken(10)` → 14 caracteres base64url (~80 bits).

### 8. Amplificación de almacenamiento en `metric_rollups` — MEDIUM

Claves derivadas del `Referer` (campaña y dominio) sin límite de cardinalidad/longitud: cada clic reescribe un blob JSON creciente (O(n²)).

Fix: campaña truncada a 100 chars y mapas acotados a 200 claves en `bump()`.

### 9. Usuario bloqueado con challenge MFA en vuelo — MEDIUM

`/mfa/verify` no comprobaba `deleted_at`: un bloqueado con challenge pendiente podía obtener sesión nueva.

Fix: `SELECT ... AND deleted_at IS NULL` (+ `hydrateSession` ya corregido).

### 10. Lockout permanente del área admin — MEDIUM

Un admin podía degradar/bloquear a todos los admins.

Fix: guarda del "último admin activo" (403 si quedaría 0).

### 11. Spam/phishing vía invitaciones de cuentas no verificadas — MEDIUM

Registro sin verificar permitía crear workspaces ilimitados e invitar correos arbitrarios (emails reales desde el dominio de UVH).

Fix: `requireVerified` en creación de workspace, invitación y reenvío; nombres de workspace sin caracteres de control (evita inyección de logs/headers).

### 12. Fuga de `REPUTATION_PROVIDER_URL` en endpoint público — MEDIUM

`GET /api/v1/status` exponía la URL del proveedor (posibles credenciales embebidas).

Fix: solo expone `{externalAnalysis:true, provider:"configured"}`.

### 13. Cola de analítica no acotada bloqueando el event loop — MEDIUM

Cola sin límite con `shift()` O(n²) y escrituras SQLite síncronas por clic.

Fix: cola acotada (shedding a 10k), `setImmediate` cada 32 jobs, sin `shift()`.

### 14. Sesiones de usuarios bloqueados — MEDIUM

`hydrateSession()` no comprobaba `deleted_at` (defensa en profundidad del fix #9).

Fix: `JOIN ... AND u.deleted_at IS NULL` + test.

### 15. Throttling MFA/recovery solo por IP — MEDIUM

Añadido contador de intentos por cuenta (10 intentos / 15 min → 429) sobre `/mfa/verify` y `/mfa/recovery`.

### 16. Varios LOW

- `POST /api/v1/report` con `linkId` inexistente → 500 (FK): ahora 404.
- `/api/v1` sin `Cache-Control: no-store`: cabecera global añadida.
- `events` de webhook sin `max`: acotado a 10.
- Log injection vía nombre de workspace en el fallback de email: mitigado con el regex de caracteres de control.
- **Re-auth débil en MFA**: `/mfa/disable` y `/mfa/setup` solo pedían contraseña. Ahora exigen el código TOTP actual (step-up), también en el frontend (formulario de desactivación con código).
- **`/resend-verification` sin límite** (flooding de buzón + crecimiento de `email_tokens`): cooldown de 1 minuto por usuario (basado en BD) → 429.
- **`APP_SECRET` estático en dev/preview** (forjable): ahora se genera un secreto efímero aleatorio al arrancar si no está definido; producción sigue fallando cerrado.
- **`/login` sin `max` en password**: unificado con el esquema (max 128).
- **Sesgo de módulo en `randomAlias`**: muestreo por rechazo con `randomInt` (CSPRNG), sin sesgo.
- **NaN en parámetros numéricos → 500**: `norm()` de db.ts convierte NaN/Infinity en NULL (los queries devuelven 404/empty en vez de 500) y la paginación de admin valida enteros seguros.
- **Secretos at-rest legacy en claro**: `migrate()` re-cifra en el arranque los valores sin prefijo `enc:v1:` (`users.mfa_secret`, `webhooks.secret`).
- **TOCTOU en la cuota de enlaces**: el COUNT se movió dentro de la transacción `BEGIN IMMEDIATE`.
- **No se podía quitar la contraseña de un enlace** (bug de `??`): `password:null` ahora la elimina (`undefined` la conserva) + test.
- **Fechas con offset de zona horaria**: `scheduledAt`/`expiresAt` se normalizan a UTC ISO al guardar, así las comparaciones textuales del scheduler son consistentes.
- **`restore` fijaba `active` a ciegas**: ahora re-deriva el estado temporal (un enlace caducado vuelve como `expired`) + test.
- **`ip_hash` sin sal** (reversible para IPv4): ahora es HMAC-SHA256 con `APP_SECRET` en sesiones y auditoría.
- **`returnTo` aceptaba `//host`**: rechaza protocol-relative y backslash en el frontend.
- **`check-alias` sin rate limit**: añadido `linkCreateLimiter` (`LINK_CREATE_LIMIT`, configurable).
- **Workspaces ilimitados por usuario**: cap de 20 workspaces en propiedad (429).
- **Rango reservado `240.0.0.0/4`** añadido al filtro SSRF.
- **Token de unlock no ligado al enlace**: el token firma ahora `{alias, host, link.id}`; un enlace borrado y recreado con el mismo alias no acepta tokens antiguos + test.
- **TOCTOU de estado en `resolveLink`**: los chequeos de ciclo de vida (blocked/paused/scheduled/expired) se re-evalúan sobre la fila fresca **dentro** de la transacción de consumo.
- **Rate limit por (IP, alias) en el unlock**: fuerza bruta acotada por enlace (10/min) además del límite global.
- **Log de email con `JSON.stringify`**: inmune a inyección de CR/LF vía subject.
- **IPv6 multicast (`ff00::/8`) y documentación (`2001:db8::/32`)** bloqueados en el filtro SSRF.

## Documentados (riesgo residual aceptado)

| Hallazgo | Nota |
| --- | --- |
| Rate limits en memoria y por IP | `trust proxy=1` exige que el backend sea alcanzable solo tras el proxy (deployment.md); multi-instancia → store compartido (Redis). |
| `visitorHash` sin salt | Identificador pseudónimo (día+IP+UA) de 128 bits; no filtra IP cruda. Considerar HMAC con `APP_SECRET`. |
| TOCTOU de cuota de enlaces | Carrera mínima permite superar la cuota por 1 en ráfagas concurrentes. |
| `restore` ignora `expires_at`/bloqueo | El restaurador (editor) puede reactivar un enlace caducado por tiempo; lo revisará el scheduler al minuto. |
| Oráculo 404/403 en el unlock de contraseña | Revela qué alias está protegido; aceptable (la página de contraseña ya lo revela). |
| Comparación de fechas como texto en el scheduler | Los ISO-8601 UTC con el mismo formato comparan lexicográficamente igual que temporalmente. |

## Verificado y NO vulnerable

- SQL 100% parametrizado (incluidos LIKE/IN/LIMIT); sin inyección.
- Tokens de sesión/email/invitación/API almacenados como hash; migración legacy incluida.
- Consumo atómico de enlaces single-use/max-clicks (BEGIN IMMEDIATE + UPDATEs guardados).
- CSRF en todas las mutaciones; cookies de sesión httpOnly + SameSite.
- Anti-enumeración en register/login/forgot-password (y ahora mfa/recovery).
- Sin CRLF/header injection en `Location` (control chars rechazados); sin HTML injection en páginas (títulos estáticos + `encodeURIComponent`).
- IPs decimal/octal/hex normalizadas por `new URL()` → bloqueadas (verificado empíricamente).
- `returnTo` del frontend no explotable (`navigateByUrl` no sale de la app; Angular 19 sin `bypassSecurityTrust` ni `innerHTML`).
- Criptografía: AES-256-GCM at-rest con clave derivada por dominio, HMAC + `timingSafeEqual` en `sign`, `APP_SECRET` obligatorio en producción.
