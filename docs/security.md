# UVH — Seguridad

Implementación de seguridad y guía de endurecimiento (hardening).

## 1. Cabeceras de seguridad

`app/Http/Middleware/SecurityHeaders.php` establece:

- **CSP** (`Content-Security-Policy`): restringe scripts a self, bloquea eval y permite solo los orígenes necesarios (fonts/Google en dev si aplica). Ajustar en producción sin romper la SPA.
- **X-Frame-Options** / `frame-ancestors`: evita clickjacking.
- **X-Content-Type-Options: nosniff**.
- **Referrer-Policy** estricta.
- **Permissions-Policy** restrictiva.
- **HSTS** (`Strict-Transport-Security`) se activa **solo cuando el entorno sirve HTTPS**, para no romper la preview HTTP local.

> No se activan configuraciones que rompan el proyecto: HSTS y `COOKIE_SECURE` son toggles de producción.

## 2. Sesiones y cookies

- Cookie `uvh_session` (nombre configurable) con `HttpOnly`, `SameSite`, `Secure` (por defecto **`true` en producción`, `COOKIE_SECURE` solo para override), `Path=/`.
- `COOKIE_DOMAIN` se mantiene **vacío**. Nunca `.uvh.es`: la cookie del panel pertenece solo a `app.uvh.es`.
- El token de sesión se almacena **hasheado** (SHA-256, `SessionManager`); el valor en claro solo existe en la cookie. El `last_used_at` se actualiza como mucho una vez por minuto por sesión (menos escrituras en el hot path).
- Separación por host en producción (`UvhHostGuard`): panel/API solo en `app.uvh.es`; landing y resolución solo en `uvh.es` o dominios personalizados.
- CSRF de doble envío (`uvh_csrf` + `X-CSRF-Token`, `UvhCsrf`) acotado a la API (`/api/v1`) y a los formularios públicos que mutan; la resolución de enlaces no emite cookies CSRF.
- **Ningún bearer de handoff en `localStorage`.** El enlace de invitación (7 días) y el link intent preparado antes de autenticar (24 h) vivían en almacenamiento legible por script. Ahora los aparca el servidor en dos cookies `HttpOnly`/`Secure`/host-only firmadas (`PendingHandoff`, endpoints `/api/v1/pending/*`): el navegador entrega el bearer una vez, nunca lo vuelve a leer, y sólo pregunta si hay uno aparcado. El techo de caducidad lo fija el servidor — el cliente puede acortarlo, nunca alargarlo — y el aparcado no revela si el bearer existe. Detalle en `docs/api.md`.
- Login solo para cuentas con email verificado; el registro no crea sesión hasta consumir el token de verificación.
- Revocación de sesiones al cambiar o resetear contraseña; listado y revocación de sesiones desde Ajustes.
- Las redirecciones 302 llevan `Cache-Control: no-store`: cada visita llega al backend (conteo de clics, uso único, máx. clics, caducidad) y ninguna caché intermedia sirve destinos obsoletos.

## 3. Contraseñas, MFA y tokens

- bcrypt (coste 12). Login y registro usan un hash dummy cuando el email no existe o ya está registrado, para que el tiempo de respuesta no delate la existencia de la cuenta (anti-enumeración por timing).
- Registro con respuesta **uniforme** (`201 { user: null }` siempre): el endpoint no permite confirmar si un email existe.
- MFA TOTP (`app/Support/Totp.php`) con códigos de recuperación de un solo uso; el secreto TOTP se cifra en reposo (AES-256-GCM, `UvhCrypto`) y los códigos de recuperación se guardan solo como hash. Los retos MFA viven en caché compartida con TTL y límite de intentos por usuario.
- Reautenticación (contraseña) para cambiar contraseña y para configurar/desactivar MFA (step-up con TOTP actual).
- API tokens: solo se guarda el hash (`sha256`); el token completo se muestra una sola vez; scopes (`links:read`, `links:write`, `analytics:read`, `domains:read`, `domains:write`), expiración y revocación.
- Secretos de webhook firmados con HMAC-SHA256 y **cifrados en reposo** (AES-256-GCM). No se usa hash irreversible: el secreto debe recuperarse para firmar cada entrega.

## 4. Validación de entrada y SSRF

- Validación estricta en todos los endpoints (reglas de validación de Laravel).
- Destinos: solo `http`/`https`, parseo estructurado con `URL`, rechazo de `javascript:`, `data:`, `file:`, `ftp:`, credenciales, control chars, CR/LF y hosts inválidos (`app/Support/UrlUtil.php`).
- SSRF (`app/Support/Ssrf.php`): bloqueo de loopback (`127.0.0.0/8`, `::1`), RFC1918, link-local, multicast, rangos reservados y metadata cloud (incluidas formas IPv6 de transición); las IPs validadas se **fijan** con `CURLOPT_RESOLVE` (sin DNS rebinding), sin redirecciones y con timeouts de conexión/total.
- Búsquedas: `q` **no es un lenguaje de patrones**. Los listados de la consola de administración y del panel construyen `ILIKE` con el término del operador, y `%`/`_` son comodines para PostgreSQL: sin escaparlos, `q=%` devolvía la tabla entera —incluido el `count()` de la paginación, que es coste de moderación— y `q=a_b` casaba con `axb`. `app/Support/SearchTerm.php` aplica una única regla (recorte, tope de 200 caracteres y escapado de `\`, `%` y `_`) en los siete endpoints que buscan, y el patrón viaja **como parámetro ligado**, nunca interpolado.
- La redirección normal de UVH **no visita** el destino.
- Analítica: `from`/`to`/`period` validados (422 en vez de 500 con fechas inválidas); la cabecera de país (`cf-ipcountry` por defecto) **solo se confía si `TRUST_COUNTRY_HEADER=1`** (por defecto se ignora, para que un cliente no pueda falsear la analítica por país); las rutas con API token tienen rate limit. La cabecera de país se acepta en cualquier caja y se normaliza a mayúsculas: es dato de proveedor, y exigir una caja concreta hacía que un borde que la envía en minúsculas perdiera país en las reglas y en la analítica **sin decirlo**.

## 5. Antiabuso

- Cuenta verificada para crear enlaces (`VERIFIED_REQUIRED_TO_CREATE`).
- Rate limiting diferenciado: login, registro, recuperación, MFA, creación de enlaces, alias, API, tokens, webhooks, denuncias y acciones admin (`RateLimiter` de Laravel con los mismos valores que la referencia).
- **Dos clases de límite, dos stores.** Los límites de *volumen* (redirects,
  API, panel) toleran un backend degradado porque su propósito es mantener la
  superficie servida: viven en la cadena `CACHE_LIMITER`, tipo *failover* en
  producción. Los de *credenciales* (login, MFA, verificación, recuperación,
  restablecimiento, reautenticación y registro) cuentan en
  `CACHE_LIMITER_SECURITY`, un store único que producción exige compartido, no
  `failover` y **no Redis**: para un límite de credenciales, un segundo backend
  no es un respaldo sino una segunda ventana vacía, de modo que la caída del
  primero regalaría presupuesto y, al volver, contadores antiguos podrían
  bloquear a una cuenta legítima. Un contador que una dependencia puede poner a
  cero no es una protección. La clasificación vive en `app/Support/UvhLimiters.php`.
- Cuotas por workspace (con `lockForUpdate` para evitar carreras).
- Denuncia pública, revisión administrativa, bloqueo con motivo, auditoría.
- **Moderación a nivel de destino**, no de enlace: la denylist local
  (`destination_denylist`) se aplica de forma síncrona en `LinkService` —también
  al destino *fallback* y a las reglas de redirección— y empareja por etiqueta
  (`evil.example` cubre sus subdominios, nunca `notevil.example`), guardando las
  URLs como hash canónico. Sin ella, bloquear un enlace dejaba la misma URL a un
  clic de distancia.
- **Apelación real**: el propietario de un enlace bloqueado puede abrir una
  apelación (una sola abierta por enlace) y un moderador restaurar o mantener.
  Restaurar retira las entradas de denylist que aplicaban al destino, de modo
  que una decisión automática puede anularse por una persona.
- Un bloqueo automático es **reversible por diseño**, y sólo eso: el enlace
  guarda de dónde vino el bloqueo y a qué estado debe volver, de modo que
  retirar o dejar caducar una entrada libera los enlaces que había bloqueado,
  mientras que un bloqueo de moderador no lleva marcador y no puede retirarse
  solo. Sin ese marcador, `state = blocked` era una decisión sin autor.
- El recorrido de etiquetas de la denylist **se detiene por encima del sufijo
  público** (`co.uk`, `github.io`): un dedazo en la consola no puede apagar todos
  los sitios alojados bajo uno, y una página concreta de esas plataformas se
  sigue bloqueando con una entrada de URL.
- Adaptador opcional de reputación externa (pool `security`): si no está
  configurado se indica claramente y **nunca** se inventa un estado "seguro".
  `suspicious` abre un caso de moderación; `malicious` sólo bloquea con
  `REPUTATION_AUTO_BLOCK=true`. Contrato y operación:
  [`url-reputation-runbook.md`](url-reputation-runbook.md).

## 5 bis. Límite de volumen en el borde

El `throttle:uvh-*` de Laravel decide por propósito e identidad, pero se ejecuta
**después** de Caddy, Nginx y PHP-FPM: un atacante ya ha llegado al proceso antes
de que se le rechace. Nginx añade por ello un techo de volumen por cliente
(`limit_req`/`limit_conn`) como último salto antes de PHP-FPM.

Propiedades que lo hacen seguro de activar:

- **Nunca es el primero en rechazar lo que Laravel habría admitido.** Sus tasas
  se fijan por encima del límite equivalente (2× el más estricto por minuto) y
  `EdgeLimitContractTest` compara template, ficheros de despliegue y
  `config/uvh.php` para que esa relación no dependa de quien edite los números.
- **La IP del cliente se restaura** desde `TRUSTED_PROXIES` (el mismo valor que
  confía Laravel) con `real_ip_recursive`; una lista ausente, con comodín o con
  hostname hace fallar el arranque. Sobre la dirección del par, todos los
  clientes compartirían un cubo: un limitador que no limita.
- **Un rechazo del borde es distinguible** de un `429` de Laravel: sólo el borde
  añade `Retry-After` y sólo él deja `limit=$limit_req_status` (y
  `conn=$limit_conn_status`, que atribuye el rechazo al tope de conexiones). El
  `429` de Laravel conserva su cuerpo JSON.
- **Cubre también el `default_server`** de dominios personalizados: limitar sólo
  los hosts con nombre dejaría sin protección justo los redirects que importan.
- **`EDGE_DRY_RUN=on` es un interruptor de apagado completo y, a la vez, una
  medición**: desactiva el rechazo de `limit_req` **y** de `limit_conn` — con
  sólo el primero, un despliegue que creía haber apagado el rechazo seguía
  recibiendo `429` del tope de conexiones, medido en la imagen de producción — y
  en la misma pasada deja en el access log `limit=REJECTED_DRY_RUN` y
  `conn=REJECTED_DRY_RUN` para lo que habría rechazado. Dimensionar la tasa no
  necesita un segundo despliegue: agregar `limit=`/`conn=` de este log con el
  interruptor puesto.

La capa de CDN/WAF por delante del borde es un requisito de despliegue, no
código: se verifica en el checklist de release, no aquí.

## 6. Auditoría, logging y retención

- `audit_events` append-only: acciones de roles, dominios, bloqueos, restauraciones, tokens, webhooks, configuración y administración.
- Logging estructurado **sin** tokens, contraseñas, cookies, query strings sensibles, MFA ni secretos.
- El scheduler (`UvhHousekeeping`) purga: sesiones expiradas/revocadas (>30d, `SESSION_PURGE_DAYS`), tokens de email usados/caducados (>7d, `TOKEN_PURGE_DAYS`), entregas de webhook exitosas (>90d, `DELIVERY_PURGE_DAYS`) y auditoría (>365d, `AUDIT_PURGE_DAYS`), además de la retención de analítica existente.

## 7. Gestión de secretos

- `.env`, `.env.local` y `.env.*.local` están en `.gitignore`.
- Los secretos se inyectan por variables de entorno.
- `APP_SECRET` **falla cerrado** en producción: el proceso se niega a arrancar si falta, es demasiado corto o usa el valor de desarrollo.
- En producción los secretos se definen aparte (ver `docs/deployment.md`).
- La rotación de `APP_SECRET` usa una clave actual de escritura y un keyring
  temporal de lectura, con deadline de producción y recifrado reanudable. El
  procedimiento, drenaje y rollback se documentan en
  [`app-secret-rotation-runbook.md`](app-secret-rotation-runbook.md).
- Gitleaks comprueba en CI que no se cuele una credencial: el árbol en cada
  cambio y el historial completo en la ejecución semanal. Las excepciones son
  rutas con datos de prueba (`.gitleaks.toml`) y hallazgos históricos ya
  revisados, fijados al commit (`.gitleaksignore`); ninguna alcanza el código de
  la aplicación. El detalle está en
  [`static-analysis.md`](static-analysis.md#escaneo-de-seguridad).
- Un secreto publicado se rota aunque se borre del árbol: seguiría en el
  historial y en cualquier copia. El escaneo detecta; la rotación es una
  decisión, y su procedimiento es el del runbook citado arriba.

## 8. Checklist de release

- [ ] `COOKIE_SECURE` (por defecto `true` en producción) y HSTS activos solo bajo HTTPS.
- [ ] `APP_SECRET` largo y aleatorio definido en producción.
- [ ] `COOKIE_DOMAIN` vacío.
- [ ] Dominios personalizados verificados por TXT antes de `active`.
- [ ] `RESEND_API_KEY` definida para emails.
- [ ] CSP revisada para los assets reales servidos.
- [ ] `APP_HOST=app.uvh.es` y `PUBLIC_HOST=uvh.es` definidos en producción (separación por host).
- [ ] Límites de cuota por plan definidos.
- [ ] El flujo `Security scans` en verde en el commit que se despliega: Semgrep
  sin hallazgos ERROR, Gitleaks sin hallazgos, y Trivy sin HIGH/CRITICAL con
  parche. Las excepciones vigentes están en `.trivyignore.yaml`, `.gitleaks.toml`
  y `.gitleaksignore`, cada una con su motivo y su deuda en `todos.md`;
  `Tests\Unit\SecurityScanContractTest` comprueba que sigan siéndolo.
