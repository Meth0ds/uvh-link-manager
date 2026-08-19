# Auditoría de seguridad profunda — UVH (Laravel + Angular)

**Fecha:** 2026-08-19 · **Alcance:** `backend-laravel/` (port Laravel 13,
único backend del proyecto), `frontend/` (Angular 22), infraestructura Docker
local.
**Método:** auditoría adversarial de la frontera de seguridad del port Laravel
(SSRF, sesiones, CSRF, rate limits, autorización, criptografía), pruebas
manuales contra el stack vivo (`127.0.0.1:8000`) y suites de test (Laravel
18 tests / 339 aserciones, frontend 12 tests, SSRF 60 aserciones).

---

## Resumen ejecutivo

| Severidad | Hallazgo | Estado |
| --------- | -------- | ------ |
| **CRÍTICO** | SSRF en la entrega de webhooks (fetch sin protección) | **Corregido** |
| **MEDIO** | Rango de benchmarking 198.18.0.0/15 ausente del filtro SSRF inicial | **Corregido** |
| **MEDIO** | Race TOCTOU en el límite de cuota de enlaces (PostgreSQL read-committed) | **Corregido** |
| **BAJO** | `expiresAt` inválido en creación de API token → 500 | **Corregido** |
| **BAJO** | Webhooks bloqueaban el request hasta 5 s | **Corregido** (cola async) |
| **BAJO** | Fallback de clave at-rest no determinista si faltan `APP_SECRET` y `APP_KEY` | **Corregido** |

No se encontraron exploits explotables pendientes tras los arreglos. En la
pasada adicional se cerraron dos carreras de consumo de tokens
(reset/MFA recovery) y la posibilidad de resucitar sesiones legacy al verificar
el email.

---

## Hallazgos detallados

### CRÍTICO-1 — SSRF en webhooks (corregido)

**Dónde:** `backend-laravel/app/Support/WebhookService.php` (antes del fix).

**Descripción:** la entrega de webhooks debe validar el destino: esquema
http/https, sin credenciales embebidas, puertos {80, 443, 8080, 8443},
resolución de TODOS los registros DNS con rechazo de cualquier IP
privada/loopback/link-local/reservada (incluidas formas IPv6 de transición) y
revalidación en connect-time contra DNS rebinding. El port inicial hacía
`Http::post($url)` sin ninguna validación.

**Exploit:** un usuario con rol `editor` crea un webhook apuntando a
`http://169.254.169.254/latest/meta-data/`, `http://127.0.0.1:<puerto interno>` o
`http://<IP privada>` y dispara un evento (`link.created` al crear un enlace). El
servidor hace el fetch: escaneo de puertos internos, acceso a servicios internos
y metadata cloud (SSRF clásico).

**Fix (`app/Support/Ssrf.php`):**
- Esquema http/https únicamente; rechazo de credenciales embebidas.
- Puertos {80, 443, 8080, 8443}.
- `isPrivateIp()`: tabla completa de rangos IPv4 (0/8, 10/8, 100.64/10, 127/8,
  169.254/16, 172.16/12, 192.0.0/24, 192.0.2/24, 192.168/16, 198.18/15,
  198.51.100/24, 203.0.113/24, 255.255.255.255/32) y IPv6 (::, ::1, fc00::/7,
  fe80::/10, ff00::/8, 2001:db8::/32) con extracción de IPv4 embebida en formas
  de transición: mapped (`::ffff:`), compatible (`::`), NAT64 (`64:ff9b::/96`),
  6to4 (`2002::/16`) y Teredo (`2001::/32`, complemento de bits).
- Cierre del DNS-rebinding TOCTOU: las IPs validadas se **fijan** en la conexión
  con `CURLOPT_RESOLVE` (curl no vuelve a resolver el host), sin redirecciones
  (`CURLOPT_FOLLOWLOCATION=false`) y con timeouts de conexión y total (5 s).
- Tests: `tests/Feature/SsrfTest.php` (60 aserciones) + integración de entrega a
  destino privado.

### MEDIO-2 — Rango reservado 198.18.0.0/15 en SSRF (corregido)

**Dónde:** `backend-laravel/app/Support/Ssrf.php`.

**Descripción:** el filtro inicial cubría solo `198.51.100.0/24` (TEST-NET-2) y
dejaba sin proteger el rango de benchmarking `198.18.0.0/15` (RFC 2544). Un
webhook dirigido a `198.18.0.1:8080` podía evitar esa parte del filtro.

**Fix:** el filtro bloquea ahora `0xc6120000–0xc613ffff` y
`0xc6336400–0xc63364ff`; el caso queda cubierto por la suite SSRF.

### MEDIO-3 — Race en cuota de enlaces (corregido)

**Dónde:** `backend-laravel/app/Support/LinkService.php::create()`.

**Descripción:** el chequeo de cuota hacía `COUNT(*)` + `INSERT` dentro de una
transacción. En PostgreSQL (aislamiento read-committed) dos creaciones
concurrentes del mismo workspace podían leer el mismo contador y exceder la
cuota.

**Fix:** `lockForUpdate()` sobre la fila `quotas` del workspace dentro de la
transacción: las creaciones concurrentes se serializan por workspace.

### BAJO-4 — `expiresAt` inválido → 500 (corregido)

**Dónde:** `backend-laravel/app/Http/Controllers/TokenController.php::store()`.

**Descripción:** `Carbon::parse($expiresAt)` lanzaba excepción con input inválido
→ 500. Ahora se captura y responde 422.

### BAJO-5 — Webhooks bloqueantes (corregido)

**Dónde:** `backend-laravel/app/Support/WebhookService.php`.

**Descripción:** la primera versión hacía el fetch HTTP dentro del request (hasta
5 s por webhook; un webhook lento amplifica la ocupación de workers PHP).

**Fix:** `app/Jobs/WebhookDeliveryJob` (ShouldQueue) con `afterCommit()`. En
tests (`QUEUE_CONNECTION=sync`) se ejecuta inline; en local, el worker
`php artisan queue:work` del Compose (perfil `laravel`) lo procesa.

### MEDIO-7 — Sesiones legacy resucitables al verificar email (corregido)

**Descripción:** una sesión emitida por una versión anterior podía permanecer
válida en la base de datos mientras la cuenta no estaba verificada; si el usuario
verificaba el email antes de que ese cookie se usara, el middleware podía
aceptarla después de la verificación.

**Fix:** `/auth/verify-email` revoca dentro de la misma transacción todas las
sesiones activas del usuario antes de permitir un nuevo login. El usuario debe
crear una sesión nueva con sus credenciales; los middlewares mantienen además la
revocación defensiva al hidratar cookies no verificadas.

### MEDIO-8 — Carreras en tokens one-time de reset/MFA (corregido)

**Descripción:** dos requests concurrentes podían leer el mismo token de reset
o código de recuperación antes de marcarlo como usado y obtener dos resultados
exitosos.

**Fix:** consumo y actualización de contraseña/código bajo `lockForUpdate()` en
transacción. El segundo request recibe el mismo error de token/código consumido.

### BAJO-9 — Fallback de clave at-rest no determinista (corregido)

**Dónde:** `backend-laravel/app/Support/UvhCrypto.php::secret()`.

**Descripción:** el fallback usaba `Ids::randomToken(32)` **por llamada**: con
`APP_SECRET` y `APP_KEY` ausentes, lo cifrado en una petición no sería
descifrable en la siguiente. Ahora deriva de `APP_KEY` (estable por despliegue);
en producción `APP_SECRET` sigue siendo obligatorio.

---

## Verificaciones sin hallazgos

### Autenticación y sesiones
- El token de sesión viaja solo en cookie `httpOnly + SameSite=Lax`, `Secure`
  según `COOKIE_SECURE`, dominio restringido (`COOKIE_DOMAIN` vacío; nunca
  `.uvh.es`). En BD solo se guarda `sha256(token)`.
- `change-password` y `reset-password` revocan el resto de sesiones; `reset`
  revoca todas. `logout` y la revocación explícita de la sesión actual revocan la
  fila en BD y limpian la cookie; el frontend borra la identidad antes de
  esperar la red y cierra el panel también ante un 401 remoto.
- MFA: challenge con TTL 300 s, máx. 10 intentos / 15 min, recovery codes
  hasheados, reconfiguración exige TOTP actual, disable exige password + TOTP.
- Anti-enumeración: registro duplicado → 201 idéntico + bcrypt dummy; login con
  email inexistente → hash dummy; `forgot-password` → respuesta idéntica.
- Política de contraseñas: 10–128.
- Admin gated por `is_admin` + MFA activado (`uvh.mfa`).

### CSRF
- Double-submit en toda `/api/v1` (incluidos 404s) y en `/r/{alias}/unlock`;
  verificación con `hash_equals`; el hot path de redirección no emite cookies;
  el unlock emite CSRF solo al renderizar el formulario HTML.

### Rate limits (todos replicados con los valores de la spec)
| Limiter | Ventana | Límite | Estado |
| ------- | ------- | ------ | ------ |
| auth | 15 min | 10 | ✓ |
| register | 60 min | 10 | ✓ |
| link_create | 1 min | 30 | ✓ |
| resolve | 1 min | 600 | ✓ |
| report | 1 min | 10 | ✓ |
| api | 1 min | 120 | ✓ |
| admin | 1 min | 60 | ✓ |
| api_token | 1 min | 600 | ✓ |
| unlock | 1 min | 10 (por IP+alias) | ✓ |

### Autorización / IDOR
- Todas las rutas de workspace resuelven la membresía por `X-Workspace-Id` o
  workspace por defecto y comprueban rol mínimo (`viewer/editor/admin/owner`).
- `linkId`, `domainId`, `deliveryId`, `invitationId` siempre verificados dentro
  del workspace. Invitaciones ligadas al email del destinatario y de un solo uso.
- API tokens: hasheados, `analytics/overview` público limitado al workspace del
  token, revocación por workspace. Bloquear un usuario revoca sesiones y tokens.
- Admin: guard de "al menos un administrador activo" al degradar/bloquear.

### Inyección
- **SQL:** Eloquent/query builder parametrizado en todo el backend Laravel; el
  importador usa lista fija de tablas + `quoteIdent`; los `DB::raw` de
  AnalyticsController usan placeholders con binding.
- **XSS:** frontend Angular sin sinks (`bypassSecurityTrust*`, `innerHTML`,
  `eval` ausentes por grep); páginas HTML de redirección escapan con
  `htmlspecialchars`; emails escapan URL/workspace/rol.
- **Headers:** destinos con caracteres de control rechazados en creación
  (422 por validación — sin inyección).
- **Open redirect:** los destinos se validan (http/https absoluto, sin
  credenciales) antes de usarse en `Location`; el token de unlock está ligado a
  host + alias + link.

### Criptografía y secretos
- Cifrado at-rest AES-256-GCM, clave derivada por HMAC domain-separated de
  `APP_SECRET` (formato `enc:v1:` heredado).
- Tokens (sesión, email, invitación, API) hasheados con SHA-256 en BD.
- IPs pseudonimizadas con HMAC. Auditoría append-only sin secretos.
- `.env`, `.env.docker.local` y fixtures sin secretos reales.

### Otros
- Host guard de producción (separación `app.uvh.es` / `uvh.es`,
  `/health` abierto, redirección nunca en app host).
- Security headers (nosniff, XFO DENY, Referrer-Policy,
  Permissions-Policy, CSP, HSTS condicional).
- El 404 de la superficie de redirección es HTML (congelado en contrato).
- La verificación de dominio usa solo `dns_get_record(DNS_TXT)` (sin SSRF).

---

## Limitaciones conocidas

1. **Rate limits y challenges MFA en memoria** (por proceso): en despliegues
   multi-instancia requieren un store compartido (Redis). Documentado.
2. **Webhooks**: la entrega es asíncrona vía cola `database`; el worker debe
   estar corriendo (`docker compose --profile laravel up -d queue`).
3. **`TRUST_COUNTRY_HEADER`** desactivado por defecto; si se activa, el país se
   toma del header configurado y debe provenir de un proxy de confianza.

## Verificación final

```bash
# Laravel (uvh_test)
docker compose -f docker-compose.local.yml --env-file .env.docker.local \
  run --rm php php artisan test    # 18 tests, 339 aserciones ✓

# Frontend
npm run typecheck --prefix frontend  # TypeScript ✓
npm run build --prefix frontend      # Angular 22 ✓
npm test --prefix frontend -- --watch=false --browsers=ChromeHeadless # 12 tests ✓
```
