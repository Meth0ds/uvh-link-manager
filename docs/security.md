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

- Cookie `uvh_session` (nombre configurable) con `HttpOnly`, `SameSite`, `Secure` en producción, `Path=/`.
- `COOKIE_DOMAIN` se mantiene **vacío**. Nunca `.uvh.es`: la cookie del panel pertenece solo a `app.uvh.es`.
- CSRF de doble envío (`uvh_csrf` + `X-CSRF-Token`) en toda mutación.
- Regeneración de sesión al iniciar sesión; revocación de sesiones al cambiar o resetear contraseña.
- Listado y revocación de sesiones desde Ajustes.

## 3. Contraseñas, MFA y tokens

- bcrypt con coste 12.
- MFA TOTP (`otplib`) con códigos de recuperación de un solo uso.
- Reautenticación (contraseña) para cambiar contraseña y para configurar/desactivar MFA.
- API tokens: solo se guarda el hash (`sha256`); el token completo se muestra una sola vez; scopes (`links:read`, `links:write`, `analytics:read`, `domains:read`, `domains:write`), expiración y revocación.
- Secretos de webhook firmados con HMAC-SHA256 (event id + timestamp) y almacenados solo como hash.

## 4. Validación de entrada y SSRF

- Zod en todos los endpoints.
- Destinos: solo `http`/`https`, parseo estructurado con `URL`, rechazo de `javascript:`, `data:`, `file:`, `ftp:`, credenciales, control chars, CR/LF y hosts inválidos.
- SSRF (`util/ssrf.ts`): bloqueo de loopback (`127.0.0.0/8`, `::1`), RFC1918, link-local, multicast y metadata cloud; revalidación DNS/IP tras cada redirect; límites de tiempo, bytes, redirects y puertos.
- La redirección normal de UVH **no visita** el destino.

## 5. Antiabuso

- Cuenta verificada para crear enlaces (`VERIFIED_REQUIRED_TO_CREATE`).
- Rate limiting diferenciado: login, registro, recuperación, MFA, creación de enlaces, alias, API, tokens, webhooks, denuncias y acciones admin (`backend/src/middleware/ratelimit.ts`).
- Cuotas por workspace.
- Denuncia pública, revisión administrativa, bloqueo con motivo, apelación, auditoría.
- Adaptador opcional de reputación externa: si no está configurado se indica claramente y no se inventa un estado "seguro".

## 6. Auditoría y logging

- `audit_events` append-only: acciones de roles, dominios, bloqueos, restauraciones, tokens, webhooks, configuración y administración.
- Logging estructurado **sin** tokens, contraseñas, cookies, query strings sensibles, MFA ni secretos.

## 7. Gestión de secretos

- `.env`, `.env.local` y `.env.*.local` están en `.gitignore`.
- Los secretos se inyectan por la pestaña API Keys de Freebuff y se leen con `process.env` en el backend.
- En producción los secretos se definen aparte (ver `docs/deployment.md`).

## 8. Checklist de release

- [ ] `COOKIE_SECURE=true` y HSTS activos solo bajo HTTPS.
- [ ] `APP_SECRET` largo y aleatorio definido en producción.
- [ ] `COOKIE_DOMAIN` vacío.
- [ ] Dominios personalizados verificados por TXT antes de `active`.
- [ ] `RESEND_API_KEY` definida para emails.
- [ ] CSP revisada para los assets reales servidos.
- [ ] Límites de cuota por plan definidos.
