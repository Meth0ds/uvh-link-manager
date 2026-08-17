# UVH — Modelo de amenazas

Modelo de amenazas y mitigaciones implementadas. Cada clase de vulnerabilidad listada en el plan tiene una contramedida y, cuando aplica, una prueba de regresión.

## Activos

- Cuentas de usuario y credenciales (hash bcrypt, secretos MFA).
- Enlaces, dominios, reglas de redirección y analítica por workspace.
- API tokens y secretos de webhooks.
- Auditoría y datos de abuso.

## Actores

- Visitante anónimo (resolución de enlaces, denuncia).
- Usuario autenticado (owner/admin/editor/viewer).
- Admin de plataforma (requiere MFA).
- Atacante externo (sin cuenta, con credenciales robadas, o con cuenta legítima intentando BOLA/IDOR).

## Catálogo de amenazas y mitigaciones

| # | Amenaza | Mitigación | Prueba |
| - | ------- | ---------- | ------ |
| 1 | **BOLA / IDOR** (usuario B accede a recursos de A) | Toda consulta filtra por `workspace_id` derivado del `X-Workspace-Id` y de la pertenencia real del usuario; nunca por ID "adivinable". | `user B cannot see, edit or delete user A's links` |
| 2 | **XSS** | Angular escapa por defecto; sin `innerHTML` con datos de usuario; CSP vía `securityHeaders`. | Revisión manual + inputs escapados |
| 3 | **CSRF** | Cookie CSRF de doble envío en todas las mutaciones (`X-CSRF-Token`), `SameSite` en cookie de sesión. | Mutaciones sin token rechazadas |
| 4 | **SSRF** (webhooks / fetches a URL de usuario) | `util/ssrf.ts` bloquea loopback, RFC1918, link-local y metadata cloud; revalida DNS/IP tras cada redirect; límites de bytes/redirects/puertos. | Tests de utilidad SSRF |
| 5 | **SQL injection** | `node:sqlite` con sentencias preparadas parametrizadas en el 100% de las consultas; sin concatenación de SQL. | Revisión de código |
| 6 | **Host Header Injection** | La resolución valida `Host` contra el host público y dominios verificados; URLs generadas desde configuración, no del header del cliente. | Test de host falso |
| 7 | **CR/LF injection** | `util/url.ts` rechaza `\r` y `\n` en destinos/alias; zod valida inputs. | `rejects invalid destinations (... CR/LF ...)` |
| 8 | **Session fixation** | Regeneración de sesión tras login; revocación de todas las sesiones al cambiar/resetear contraseña. | Tests de logout/revocación |
| 9 | **Brute force / credential stuffing** | Rate limiting diferenciado en `/login`, `/register`, `/forgot-password`, MFA; bcrypt cost 12. | Tests de rate limit |
| 10 | **API abuse** | Rate limiting en API, cuotas por workspace (`quotas`), tokens con scopes y expiración/revocación. | `rejects revoked tokens` |
| 11 | **Domain takeover / DNS rebinding** | Verificación de dominios por desafío DNS TXT (nunca solo CNAME); revalidación de DNS en SSRF; estados pending/verifying antes de `active`. | Tests de dominio no verificado |
| 12 | **Race conditions** (uso único / máx. clics) | `UPDATE ... SET used_at WHERE used_at IS NULL` y `UPDATE ... SET click_count = click_count + 1 WHERE click_count < max` atómicos dentro de `BEGIN IMMEDIATE`. | `single-use link is consumed atomically under concurrency`, `max-clicks is enforced atomically under concurrency` |
| 13 | **Secrets exposure** | Tokens de API solo hash; secreto de webhook solo hash; `.env*.local` en `.gitignore`; logging sin tokens/cookies/query sensibles. | Revisión + `.gitignore` |
| 14 | **Webhook forgery** | Firma HMAC-SHA256 del payload con event id + timestamp; verificación en recepción. | Tests de webhook falso |
| 15 | **Scheme/URL maliciosa** | Solo `http`/`https`; rechazo de `javascript:`, `data:`, `file:`, `ftp:`, credenciales, hosts inválidos. | `rejects invalid destinations` |
| 16 | **Alias collision** | Restricción `UNIQUE(domain_id, alias)` + generación criptográfica con reintentos; alias personalizado normalizado y comprobado en backend con lista reservada. | Tests de colisiones |

## Supuestos

- El dominio raíz `uvh.es` y el subdominio `app.uvh.es` se sirven por el mismo origen backend en producción (o con proxy que preserva el `Host`). La cookie del panel se restringe a `app.uvh.es`.
- `APP_SECRET`, `RESEND_API_KEY` y cualquier secreto se inyectan por variables de entorno, nunca en el código ni en git.

## Riesgos aceptados / pendientes del entorno

- El scheduler es in-process (no hay workers/cron garantizados en Freebuff Cloud). Los reintentos de webhooks y purgas se ejecutan mientras la API esté viva. Ver `docs/deployment.md`.
- La reputación externa de enlaces es un adaptador opcional; si no hay proveedor configurado, la UI lo indica y **nunca** se afirma un estado "seguro" inventado.
