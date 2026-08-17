# UVH — Seguridad

Implementación de seguridad y guía de endurecimiento (hardening).

## 1. Cabeceras de seguridad

`backend/src/security.ts` establece:

- **CSP** (`Content-Security-Policy`): restringe scripts a self, bloquea eval y permite solo los orígenes necesarios (fonts/Google en dev si aplica). Ajustar en producción sin romper la SPA.
- **X-Frame-Options** / `frame-ancestors`: evita clickjacking.
- **X-Content-Type-Options: nosniff**.
- **Referrer-Policy** estricta.
- **Permissions-Policy** restrictiva.
- **HSTS** (`Strict-Transport-Security`) se activa **solo cuando el entorno sirve HTTPS**, para no romper la preview HTTP local.

> No se activan configuraciones que rompan el proyecto: HSTS y `COOKIE_SECURE` son toggles de producción.

## 2. Sesiones y cookies

- Cookie `uvh_session` (nombre configurable) con `HttpOnly`, `SameSite`, `Secure` (por defecto **`true` en producción**, `COOKIE_SECURE` solo para override), `Path=/`.
- `COOKIE_DOMAIN` se mantiene **vacío**. Nunca `.uvh.es`: la cookie del panel pertenece solo a `app.uvh.es`.
- El token de sesión se almacena **hasheado** (SHA-256); el valor en claro solo existe en la cookie. El `last_used_at` se actualiza como mucho una vez por minuto por sesión (menos escrituras en el hot path).
- Separación por host en producción (`middleware/host.ts`): panel/API solo en `app.uvh.es`; landing y resolución solo en `uvh.es` o dominios personalizados.
- CSRF de doble envío (`uvh_csrf` + `X-CSRF-Token`) acotado a la API (`/api/v1`) y a los formularios públicos que mutan; la resolución de enlaces no emite cookies CSRF.
- Regeneración de sesión al iniciar sesión; revocación de sesiones al cambiar o resetear contraseña.
- Listado y revocación de sesiones desde Ajustes.
- Las redirecciones 302 llevan `Cache-Control: no-store`: cada visita llega al backend (conteo de clics, uso único, máx. clics, caducidad) y ninguna caché intermedia sirve destinos obsoletos.

## 3. Contraseñas, MFA y tokens

- bcrypt con coste 12. Login y registro usan un hash dummy cuando el email no existe o ya está registrado, para que el tiempo de respuesta no delate la existencia de la cuenta (anti-enumeración por timing).
- Registro con respuesta **uniforme** (`201 { user: null }` siempre): el endpoint no permite confirmar si un email existe.
- MFA TOTP (`otplib`) con códigos de recuperación de un solo uso; el secreto TOTP se cifra en reposo (AES-256-GCM) y los códigos de recuperación se guardan solo como hash. Los retos MFA en memoria se podan al expirar (no crecen sin límite).
- Reautenticación (contraseña) para cambiar contraseña y para configurar/desactivar MFA.
- API tokens: solo se guarda el hash (`sha256`); el token completo se muestra una sola vez; scopes (`links:read`, `links:write`, `analytics:read`, `domains:read`, `domains:write`), expiración y revocación.
- Secretos de webhook firmados con HMAC-SHA256 y **cifrados en reposo** (AES-256-GCM). No se usa hash irreversible: el secreto debe recuperarse para firmar cada entrega.

## 4. Validación de entrada y SSRF

- Zod en todos los endpoints.
- Destinos: solo `http`/`https`, parseo estructurado con `URL`, rechazo de `javascript:`, `data:`, `file:`, `ftp:`, credenciales, control chars, CR/LF y hosts inválidos.
- SSRF (`util/ssrf.ts`): bloqueo de loopback (`127.0.0.0/8`, `::1`), RFC1918, link-local, multicast y metadata cloud; revalidación DNS/IP tras cada redirect; límites de tiempo, bytes, redirects y puertos; rechazo de credenciales embebidas en la URL.
- La redirección normal de UVH **no visita** el destino.
- Analítica: `from`/`to`/`period` validados (422 en vez de 500 con fechas inválidas); la cabecera de país (`cf-ipcountry` por defecto) **solo se confía si `TRUST_COUNTRY_HEADER=1`** (por defecto se ignora, para que un cliente no pueda falsear la analítica por país); las rutas con API token tienen rate limit.

## 5. Antiabuso

- Cuenta verificada para crear enlaces (`VERIFIED_REQUIRED_TO_CREATE`).
- Rate limiting diferenciado: login, registro, recuperación, MFA, creación de enlaces, alias, API, tokens, webhooks, denuncias y acciones admin (`backend/src/middleware/ratelimit.ts`).
- Cuotas por workspace.
- Denuncia pública, revisión administrativa, bloqueo con motivo, apelación, auditoría.
- Adaptador opcional de reputación externa: si no está configurado se indica claramente y no se inventa un estado "seguro".

## 6. Auditoría, logging y retención

- `audit_events` append-only: acciones de roles, dominios, bloqueos, restauraciones, tokens, webhooks, configuración y administración.
- Logging estructurado **sin** tokens, contraseñas, cookies, query strings sensibles, MFA ni secretos.
- El scheduler purga: sesiones expiradas/revocadas (>30d, `SESSION_PURGE_DAYS`), tokens de email usados/caducados (>7d, `TOKEN_PURGE_DAYS`), entregas de webhook exitosas (>90d, `DELIVERY_PURGE_DAYS`) y auditoría (>365d, `AUDIT_PURGE_DAYS`), además de la retención de analítica existente.

## 7. Gestión de secretos

- `.env`, `.env.local` y `.env.*.local` están en `.gitignore`.
- Los secretos se inyectan por la pestaña API Keys de Freebuff y se leen con `process.env` en el backend.
- `APP_SECRET` **falla cerrado** en producción: el proceso se niega a arrancar si falta, es demasiado corto o usa el valor de desarrollo.
- En producción los secretos se definen aparte (ver `docs/deployment.md`).

## 8. Checklist de release

- [ ] `COOKIE_SECURE` (por defecto `true` en producción) y HSTS activos solo bajo HTTPS.
- [ ] `APP_SECRET` largo y aleatorio definido en producción.
- [ ] `COOKIE_DOMAIN` vacío.
- [ ] Dominios personalizados verificados por TXT antes de `active`.
- [ ] `RESEND_API_KEY` definida para emails.
- [ ] CSP revisada para los assets reales servidos.
- [ ] `APP_HOST=app.uvh.es` y `PUBLIC_HOST=uvh.es` definidos en producción (separación por host).
- [ ] Límites de cuota por plan definidos.
