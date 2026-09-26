# Configuración de UVH: referencia completa

Estado: **referencia de todas las variables, con su obligatoriedad, su valor por
defecto y qué ocurre si falta.** Está escrita para poder responder una sola
pregunta sin leer código: *«quiero cambiar esto, ¿es obligatorio?, ¿qué pasa si
lo dejo vacío?, ¿cómo sé que no he roto nada?»*.

Si buscas el procedimiento de despliegue, es
[`deployment.md`](deployment.md). Si buscas por qué un valor está puesto así,
cada sección enlaza al documento que lo explica.

---

## 1. Dónde vive cada valor y cuál gana

Tres fuentes, en este orden de precedencia (la última gana):

1. **Valores por defecto del código** (`config/*.php`, `env('X', default)`).
2. **Fichero de entorno** (`backend-laravel/.env.production.example` es la
   plantilla; en producción se copia fuera del repositorio).
3. **Bloque `environment` de `docker-compose.production.yml`**, que **prevalece
   sobre `env_file`**.

Esto último importa: hay variables que están fijadas en el compose (Redis,
caché, colas, `CACHE_LIMITER_SECURITY`, `UVH_QUEUE_POOL` por servicio). Cambiar
el fichero `.env` para una de ellas **no tiene efecto**; hay que cambiar el
compose. La lista exacta de lo que el compose fija está en
`docker-compose.production.yml`, bloque `x-php-environment`.

Una consecuencia práctica: **una variable ausente no siempre es un error**. En
producción, el proceso se niega a arrancar sólo cuando falta algo crítico (lo
comprueba `App\Support\ProductionSecurity`); para todo lo demás, ausente
significa «aplica el valor por defecto del código», que es el que documenta este
fichero.

Esa precedencia se sostiene con dos reglas mecánicas, no con cuidado al editar.
Para cada clave que **sí** está en la plantilla, el valor que trae tiene que ser
el mismo que el del código: copiar la plantilla sin tocar nada nunca cambia el
comportamiento respecto a no tener la variable. Y toda clave leída por
`config/uvh.php` está **o en la plantilla o declarada como omitida a propósito**,
con su motivo, dentro del propio test. Las pocas diferencias que existen son
intencionales y están enumeradas allí mismo, así que añadir un knob nuevo obliga
a decidir en qué lado cae en vez de olvidarlo en ninguno de los dos. Lo comprueba
`EnvTemplateContractTest`, que también detecta lo contrario: una clave de la
plantilla que no lee nadie (un nombre mal escrito se ve idéntico a un ajuste sin
efecto).

---

## 2. Cómo comprobar antes de desplegar

```bash
# Arranque real de la pila de producción con la configuración dada, en aislado:
npm run release:boot

# Comprobación de esquema/ledger sin migrar (no valida configuración):
php artisan uvh:release-check
```

`release:boot` es la puerta que importa: monta Caddy → Nginx → PHP-FPM con tus
valores y **falla antes de servir tráfico** si el gate de configuración o el de
esquema rechazan algo. Muchos fallos de configuración son comprobables sin
ensayar la variable: los tests de contrato (`EdgeLimitContractTest`,
`UvhLimitersTest`, `ProductionSecurityTest`) leen los ficheros reales y fallan si
plantilla, compose y reglas de negocio se contradicen.

El gate de producción se ejecuta en cada arranque del *app* y de cada worker, y
acumula **todos** los errores en un único mensaje
(`Configuración de seguridad de producción inválida: …`). Úsalo como lista de
tareas.

---

## 3. Leyenda de obligatoriedad

| Símbolo | Significado |
|---|---|
| **\*** | **Obligatorio en producción.** Ausente, vacío, o con forma inválida, el proceso **no arranca**. |
| **†** | **Opcional con valor de referencia.** La plantilla lo trae; si lo quitas, el código aplica su propio valor por defecto y nada se rompe. |
| **∅** | **Opcional vacío = función desactivada.** Vacío es un estado válido y explícito, no un olvido. |
| **⚑** | **Interruptor de seguridad.** Cambiarlo altera garantías, no sólo ajustes. |
| **⛔** | **No configurable en pruebas y nunca en despliegues** (existe para el arnés de tests). |

---

## 4. Aplicación, secreto y firma

| Variable | | Por defecto | Efecto y consecuencias |
|---|---|---|---|
| `APP_NAME` | † | `UVH` | Nombre visible y prefijo de caché. |
| `APP_ENV` | \* | — | Debe ser `production`; governs los gates y las comprobaciones de entorno. |
| `APP_KEY` | \* | — | Clave de cifrado del framework (base64). Rótala como cualquier secreto; **cambiarla invalida datos cifrados con ella**. |
| `APP_SECRET` | \* | — | Firma de sesión y cifrado at-rest (secreto TOTP, secretos de webhook). Independiente de `APP_KEY`. Rechaza valores de ejemplo o cortos. |
| `APP_SECRET_PREVIOUS` | ∅ | vacío | Claves anteriores (separadas por comas) legibles **sólo** durante una rotación. Nunca cifran datos nuevos. |
| `APP_SECRET_ROTATION_UNTIL` | ∅ | vacío | Deadline ISO-8601. **Obligatorio mientras haya `APP_SECRET_PREVIOUS`**: el gate impide conservar un keyring ampliado para siempre. |
| `APP_DEBUG` | \* | `false` | `true` en producción no arranca. |
| `APP_URL` | \* | — | Debe ser exactamente `https://APP_HOST`, sin path, query, fragmento, puerto inesperado ni credenciales. |
| `APP_LOCALE` / `APP_FALLBACK_LOCALE` | † | `es` / `en` | Idioma de plantillas y correo. |
| `BCRYPT_ROUNDS` | \* | `12` | Rango validado **12–16**. Bajarlo debilita el hash; el gate lo rechaza. |
| `LOG_CHANNEL` / `LOG_LEVEL` | † | `stderr` / `warning` | Producción rechaza un canal que no sea `stderr` (evita perder logs en un volumen efímero). |

Ceremonia de rotación: [`app-secret-rotation-runbook.md`](app-secret-rotation-runbook.md).

---

## 5. Hosts, cookies y sesión

| Variable | | Por defecto | Efecto |
|---|---|---|---|
| `APP_HOST` | \* | `app.uvh.es` | Host del panel/API. Debe ser un hostname válido y **distinto** de `PUBLIC_HOST`. |
| `PUBLIC_HOST` | \* | `uvh.es` | Host de la landing, el estado y la resolución. |
| `PUBLIC_ORIGIN` | \* | `https://PUBLIC_HOST` | Origen exacto con el que se generan las URLs cortas. |
| `SESSION_COOKIE` | \* | `uvh_session` | Nombre de la cookie de sesión (plantilla: `__Host-uvh_session`). |
| `CSRF_COOKIE` | \* | `uvh_csrf` | Cookie CSRF de doble envío. |
| `COOKIE_DOMAIN` | ⚑\* | vacío | **Debe quedar vacío**: nunca `.uvh.es`. La cookie del panel pertenece sólo a `app.uvh.es`; un dominio compartido la expondría a la superficie pública. |
| `COOKIE_SECURE` | ⚑ | `true` | En producción debe ser `true`. |
| `HSTS_ENABLED` | ⚑ | `false` | Actívalo **sólo** cuando el entorno sirva HTTPS de verdad; si no, rompe la navegación. |
| `SESSION_TTL_DAYS` | \* | `30` | Rango 1–30. |
| `PENDING_INVITATION_COOKIE` | \* | `uvh_pending_invitation` | Cookie del aparcadero para la invitación (plantilla: `__Host-uvh_pending_invitation`). Mismo prefijo `__Host-` y host-only que la sesión; debe ser distinta de las otras tres. |
| `PENDING_INTENT_COOKIE` | \* | `uvh_pending_intent` | Cookie del aparcadero para el link intent (plantilla: `__Host-uvh_pending_intent`). |
| `REGISTRATION_EDIT_COOKIE` | \* | `uvh_registration_edit` | Cookie que guarda el secreto de edición de un registro sin verificar (plantilla: `__Host-uvh_registration_edit`). Es lo único que autoriza a `change-registration-email`: la contraseña que deja el registro anónimo ya no sirve para mover la dirección. |
| `REGISTRATION_EDIT_TTL_HOURS` | \* | `24` | Rango 1–24. Vida del secreto y techo de su cookie: nunca más que el bearer de verificación emitido a la vez. |
| `INVITATION_TTL_DAYS` | \* | `7` | Rango 1–30. Vida de una invitación **y** techo de la cookie que la aparca: el navegador nunca la guarda más tiempo que la invitación. |
| `INTENT_TTL_HOURS` | \* | `24` | Rango 1–168. Vida de un link intent y techo de su cookie. |
| `ADMIN_MFA_FRESH_MINUTES` | \* | `15` | Rango 5–60. Antigüedad máxima del segundo factor en acciones administrativas. |
| `TRUST_COUNTRY_HEADER` | ⚑ | `false` | **Déjalo en `false`** salvo que un borde de confianza (Cloudflare) escriba la cabecera: con `true` y sin esa capa, un cliente falsifica la analítica por país. |

---

## 6. Identidad legal

Todas **\*** y todas visibles al público: `LEGAL_ENTITY_NAME`, `LEGAL_TAX_ID`,
`LEGAL_ADDRESS`, `LEGAL_REGISTRY_DETAILS`, `LEGAL_HOSTING_PROVIDER`,
`LEGAL_HOSTING_REGION`. El arranque rechaza vacíos y marcadores de ejemplo. Los
textos legales y el ordenamiento de encargados se revisan aparte
([`production-readiness.md`](production-readiness.md)).

---

## 7. PostgreSQL

| Variable | | Por defecto | Efecto |
|---|---|---|---|
| `DB_CONNECTION` | \* | `pgsql` | Otro driver no pasa el gate. |
| `DB_HOST`, `DB_PORT`, `DB_DATABASE` | \* | — / `5432` / `uvh` | — |
| `DB_USERNAME`, `DB_PASSWORD` | \* | — | Credenciales concretas; la contraseña debe ser robusta y no de ejemplo. Usuario de mínimo privilegio. |
| `DB_SSLMODE` | \* | `verify-full` | Rango permitido: sólo `verify-full`. |
| `DB_SSLROOTCERT` | \* | `/run/secrets/uvh_db_ca` | Ruta **absoluta** y legible dentro del contenedor. |
| `DB_QUEUE_RETRY_AFTER` | † | `240` | Sólo aplica si la cola usa el driver de base de datos. |

---

## 8. Redis y caché — incluidas las tres variables del limiter

| Variable | | Por defecto | Efecto |
|---|---|---|---|
| `CACHE_STORE` | \* | `redis` | Debe ser un store **compartido** entre procesos (`database`, `redis`, `memcached`, `dynamodb`). Un store por proceso rompería locks y límites. |
| `CACHE_LIMITER` | ⚑ | vacío | Store de los límites de **volumen**. La plantilla usa `failover`. Vacío = hereda `CACHE_STORE`. |
| `CACHE_FAILOVER_STORES` | † | `redis,database` | Miembros de la cadena `failover`, en orden. Redis primero y PostgreSQL como red: la superficie pública sigue contando intentos durante una caída. |
| `CACHE_LIMITER_SECURITY` | ⚑\* | vacío (plantilla: `database`) | Store de los límites de **credenciales**. **Obligatorio en producción, y no puede ser `failover` ni `redis`.** Ver §9. |
| `REDIS_CLIENT` | † | `phpredis` | — |
| `REDIS_HOST`, `REDIS_PORT`, `REDIS_PASSWORD` | \* | `redis` / `6379` / — | Contraseña obligatoria; el arranque rechaza ausente, de ejemplo o demasiado corta. |
| `REDIS_URL` | ∅ | vacío | Alternativa a host/puerto (admite `rediss://` para TLS). |
| `REDIS_PREFIX` / `CACHE_PREFIX` | † | `uvh-` / `uvh-cache-` | Aíslan este despliegue de cualquier otro en la misma instancia. |
| `REDIS_DB` / `REDIS_CACHE_DB` | † | `0` / `1` | Separan colas/locks de caché. |

**Si Redis cae** (comportamiento real, no aspiracional): los redirects y las APIs
siguen sirviéndose y contando intentos en PostgreSQL (`cache.failed_over`); los
locks **fallan cerrado**; el correo y los webhooks no se pierden (la fila en
PostgreSQL manda y el reconciliador republica); el login y el MFA **no se ven
afectados** (ver §9). Detalle completo: [`redis-operations.md`](redis-operations.md).

---

## 9. El limiter de credenciales: la variable con más consecuencias

`CACHE_LIMITER_SECURITY` separa dos clases de límite que **no pueden compartir
store**, porque no intercambian lo mismo:

| | Volumen | Credenciales |
|---|---|---|
| Qué protege | volumen de tráfico | adivinación de credenciales |
| Variables | `CACHE_LIMITER` + `CACHE_FAILOVER_STORES` | `CACHE_LIMITER_SECURITY` |
| Degradación | **Deseada**: la cadena pasa a PostgreSQL y sigue sirviendo | **Prohibida**: no hay segunda ventana |
| Store válido en producción | `failover` con miembros compartidos | `database` (o `memcached`/`dynamodb`) |
| Si el store cae | sigue sirviendo en el fallback | el login no depende de Redis, así que no cae con él |

El motivo, en una frase: para un límite de credenciales un segundo backend no es
un respaldo sino una **segunda ventana vacía** — la caída reiniciaría el
presupuesto del atacante y, al volver el primero, sus contadores antiguos
podrían bloquear a una cuenta legítima que ya había dejado de intentarlo.

**Si lo dejas vacío:** en producción el proceso **no arranca**. Fuera de
producción, vacío significa «usa el store de disponibilidad» (comportamiento
anterior a la separación); no falla abierto: se sigue limitando.

**Si lo pones a `redis` o `failover`:** el gate lo rechaza, a propósito. Es un
despliegue que elige perder la propiedad; para hacerlo habría que cambiar la
regla en `ProductionSecurity`, deliberadamente.

Clasificación por nombre de limiter: `app/Support/UvhLimiters.php`.

---

## 10. Colas y workers

| Variable | | Por defecto | Efecto |
|---|---|---|---|
| `QUEUE_CONNECTION` | \* | `redis` | Producción rechaza `sync`, `null`, `background`, `deferred` y `failover`. |
| `REDIS_QUEUE_RETRY_AFTER` | \* | `900` | Rango **200–3600 s**. El driver de Redis **no** hereda `DB_QUEUE_RETRY_AFTER`; sin esta clave toma 90 s del framework y un worker reclamaría un job que otro sigue ejecutando. El valor cubre el worker más largo (`queue-exports`, 660 s) con holgura para la generación de exportaciones grandes. |
| `QUEUE_FAILED_DRIVER` | \* | `database-uuids` | Producción rechaza `null`: los jobs agotados se conservan para diagnóstico. |
| `UVH_QUEUE_POOL` | † | vacío | Lo fija **cada** servicio worker del compose; alimenta su heartbeat en `/health`. Un valor que no sea `[a-z0-9-]{1,32}` se ignora. |

Un worker por clase de carga, cada uno con su heartbeat independiente:

`queue-mail` · `queue-webhooks` · `queue-domains` · `queue-exports` ·
`queue-analytics` · **`queue-security`** (comprobaciones de reputación, que
llaman a un tercero con timeout propio) · `queue-legacy` (drena la cola
`default` heredada) · `scheduler`.

Cada timeout de job es menor que el de su worker, y éste menor que el
`retry_after` de la cola. La invariante se comprueba en
[`production-readiness.md`](production-readiness.md).

---

## 11. Límites de admisión de Laravel

| Variable | | Por defecto | Rango validado | Dónde se aplica |
|---|---|---|---|---|
| `AUTH_LIMIT` | \* | `10` | 3–30 | login, MFA, verificación, recuperación (por cuenta) |
| `REGISTER_LIMIT` | \* | `10` | 1–100 | registro (por IP) |
| `LINK_CREATE_LIMIT` | \* | `30` | 1–300 | creación de enlaces (por IP) |
| `RESOLVE_LIMIT` | \* | `600` | 60–10 000 | resolución de enlaces (por IP) |
| `API_TOKEN_LIMIT` | \* | `600` | 60–10 000 | API con token (por token) |
| `PENDING_LIMIT` | \* | `20` | 1–300 | aparcado de credenciales pendientes, escritura (por IP) |
| `PENDING_READ_LIMIT` | \* | `120` | 1–1 000 | consulta del aparcadero (por IP) |

Nunca pongas `0` para «desactivar» un límite: no existe ese significado.

### Qué limiter cuenta en qué store

| Limiter | Protege | Store | Ventana y tope |
|---|---|---|---|
| `uvh-login` | autenticación | **seguridad** | 15 min · 60/IP + `AUTH_LIMIT`/cuenta |
| `uvh-mfa` | segundo factor | **seguridad** | 15 min · 30/IP + `AUTH_LIMIT`/reto |
| `uvh-email-verify` | verificación y confirmaciones | **seguridad** | 15 min · 30/IP + `AUTH_LIMIT`/cuenta o token |
| `uvh-password-reset` | restablecimiento | **seguridad** | 15 min · 30/IP + `AUTH_LIMIT`/cuenta o token |
| `uvh-account-recovery` | recuperación de cuenta | **seguridad** | 60 min · 20/IP + 5/identidad |
| `uvh-security-incident` | token de incidente | **seguridad** | 15 min · 30/IP + 5/token |
| `uvh-credential` | reautenticación (step-up) | **seguridad** | 15 min · 10/sesión+IP |
| `uvh-register` | registro | **seguridad** | 60 min · `REGISTER_LIMIT`/IP |
| `uvh-resolve` | resolución pública | volumen | 1 min · `RESOLVE_LIMIT`/IP |
| `uvh-unlock` | desbloqueo de enlace con contraseña | volumen | 1 min · 10/IP+host+alias |
| `uvh-link-create` | creación | volumen | 1 min · `LINK_CREATE_LIMIT`/IP |
| `uvh-report` | denuncias | volumen | 1 min · 10/IP |
| `uvh-status` / `uvh-health` | status y health | volumen | 1 min · 60 / 120 por IP |
| `uvh-api` / `uvh-api-token` | API | volumen | 1 min · 120/IP y `API_TOKEN_LIMIT`/token |
| `uvh-analytics` | analítica | volumen | 1 min · 60/sesión+workspace |
| `uvh-activity` / `uvh-usage` | actividad y uso | volumen | 1 min · 60 / 30 por actor |
| `uvh-admin` | consola admin | volumen | 1 min · 60/IP |
| `uvh-privacy` / `uvh-privacy-admin` | privacidad | volumen | 60 min · 20 sesión / 40 IP · 60 admin |
| `uvh-mail-retry` | reintento manual de correo | volumen | 60 min · 10 |
| `uvh-domain-dns` | comprobación DNS | volumen | 1 min · 6/sesión+dominio |
| `uvh-invitation` | invitaciones | volumen | 15 min · 20/identidad+workspace |
| `uvh-webhook-action` | pruebas/reenvíos de webhook | volumen | 15 min · 30/sesión+workspace |
| `uvh-appeal` | apelación de bloqueo | volumen | 60 min · 5/sesión + 10/IP |
| `uvh-pending` | aparcado de credenciales pendientes (escritura) | volumen | 1 min · `PENDING_LIMIT`/IP |
| `uvh-pending-read` | consulta del aparcadero | volumen | 1 min · `PENDING_READ_LIMIT`/IP |

La clasificación es deliberada: `uvh-api-token` o `uvh-privacy-admin` son
sensibles pero **limitan volumen**, no adivinación, así que se quedan en el
store de disponibilidad. `UvhLimitersTest` impide que un nombre clasificado deje
de estar registrado o de usarse en una ruta.

---

## 12. Borde HTTP (Nginx) — techo de volumen

El `throttle` de Laravel decide por propósito e identidad, pero se ejecuta
**después** de Caddy, Nginx y PHP-FPM: un atacante ya llegó al proceso. Estas
variables añaden un techo por cliente en el último salto.

| Variable | | Por defecto | Efecto |
|---|---|---|---|
| `EDGE_PUBLIC_RATE` | ⚑ | `20r/s` | Tasa por cliente en el host público y en el `default_server` de dominios personalizados. |
| `EDGE_APP_RATE` | ⚑ | `20r/s` | Tasa por cliente en `/api/` y `/r/` del panel. |
| `EDGE_BURST` | † | `100` | Ráfaga permitida sin espera (`nodelay`). |
| `EDGE_CONN` | † | `64` | Conexiones simultáneas por cliente. |
| `EDGE_DRY_RUN` | ⚑ | `off` | `on` **desactiva el rechazo** en los dos limitadores (`limit_req_dry_run` y `limit_conn_dry_run`). También es una medición: medido en la imagen de producción, el access log registra `limit=REJECTED_DRY_RUN` y `conn=REJECTED_DRY_RUN` para lo que el limitador habría rechazado, así que se puede dimensionar la tasa sin desplegar dos veces. |
| `TRUSTED_PROXIES` | \* | — | Lista de IP/CIDR del borde. **Un solo contrato, dos consumidores**: Laravel confía en estas cabeceras y Nginx restaura desde aquí la IP real. Sin él, todos los clientes compartirían un cubo y el limitador no limitaría. Comodines, hostnames o `/0` hacen fallar el arranque. |
| `EDGE_ASK_SECRET` | \* | — | Secreto compartido del *ask* de Caddy (TLS on-demand). Base64URL aleatorio de 43–128 caracteres, distinto de `APP_SECRET`. |
| `METRICS_BEARER_TOKEN` | \* | — | Bearer del endpoint interno `/internal/metrics`, sólo alcanzable por la red interna. |
| `ACME_EMAIL` | \* | — | Avisos de certificados. |

**Invariante que no debes romper al tunear:** el borde **nunca** es el primero en
rechazar lo que Laravel habría admitido. Sus tasas se fijan por encima del
límite equivalente (2× el más estricto por minuto) y `EdgeLimitContractTest`
compara plantilla, ficheros de despliegue y `config/uvh.php`, de modo que la
relación no dependa de quien edite los números.

**Variables que el `envsubst` debe poder sustituir** (filtro
`NGINX_ENVSUBST_FILTER` en los composes). Si añades una a la plantilla y no al
filtro, el contenedor arranca con el placeholder literal y el contrato de test
falla:

```
^(APP_HOST|PUBLIC_HOST|EDGE_ASK_SECRET|METRICS_BEARER_TOKEN|EDGE_PUBLIC_RATE|EDGE_APP_RATE|EDGE_BURST|EDGE_CONN|EDGE_DRY_RUN)$
```

La capa de **CDN/WAF por delante** no es configuración de este repositorio: es un
requisito de despliegue que se verifica en el expediente de release
([`archive/todos.md`](archive/todos.md), `EDGE-000`).

---

## 13. hCaptcha

| Variable | | Por defecto | Efecto |
|---|---|---|---|
| `HCAPTCHA_SITE_KEY` / `HCAPTCHA_SECRET` | \* | — | Par del panel. El gate rechaza marcadores de ejemplo. |
| `HCAPTCHA_PUBLIC_SITE_KEY` / `HCAPTCHA_PUBLIC_SECRET` | \* | — | Par independiente para los formularios antiabuso del host público. |
| `HCAPTCHA_CONNECT_TIMEOUT` | \* | `2` | Rango 1–5 s. |
| `HCAPTCHA_TIMEOUT` | \* | `5` | Rango 2–10 s. |
| `HCAPTCHA_DEV_FALLBACK` | ⚑⛔ | `false` | **Nunca lo actives en un despliegue**: acepta un token de pruebas sin verificar. Sólo para desarrollo local, con comprobaciones adicionales de entorno y host. |
| `HCAPTCHA_VERIFY_URL` | ⛔ | `api.hcaptcha.com` | Sólo `APP_ENV=testing`: apunta al verificador determinista del arnés. Fuera de pruebas se ignora. |

Si el proveedor cae, la superficie antiabuso **falla cerrada** (rechaza), nunca
abierta.

---

## 14. Correo

| Variable | | Por defecto | Efecto |
|---|---|---|---|
| `MAIL_MAILER` | \* | `resend` | Debe entregar correo realmente: un transporte que no entregue no arranca. |
| `MAIL_FROM_ADDRESS` | \* | — | Dirección válida; sin controles. |
| `MAIL_FROM_NAME` | † | `UVH` | — |
| `RESEND_API_KEY` | \* | — | Obligatoria cuando el transporte efectivo es `resend`. |
| `INVITATION_MAIL_ACTOR_DAY` | † | `100` | Presupuesto diario de invitaciones por actor. |
| `INVITATION_MAIL_WORKSPACE_DAY` | † | `200` | …por workspace. |
| `INVITATION_MAIL_RECIPIENT_DAY` | † | `5` | …por destinatario. |
| `INVITATION_MAIL_IP_DAY` | † | `200` | …por IP. |
| `INVITATION_MAIL_GLOBAL_DAY` | † | `2000` | …global del despliegue. |

Los presupuestos **nunca** se ponen a `0` para desactivarlos: `0` no significa
«ilimitado». Procedimiento: [`invitation-mail-budget-runbook.md`](invitation-mail-budget-runbook.md).
El correo no se pierde con la cola caída: `mail_outbox` es la fuente de verdad.

---

## 15. Reputación de destinos y moderación

Integración **opcional**: sin `REPUTATION_PROVIDER_URL` la plataforma publica la
capacidad como no verificada y **no inventa** un estado «seguro». La moderación
útil (denylist local, apelación) funciona sin proveedor.

| Variable | | Por defecto | Efecto si falta / se deja vacío |
|---|---|---|---|
| `REPUTATION_PROVIDER_URL` | ∅ | vacío | Sin él, adaptador nulo: todo veredicto es `unknown` y `/api/v1/status` publica `not_configured`. La denylist local sigue activa. Debe ser HTTPS, puerto 443, host público, sin credenciales ni fragmento. |
| `REPUTATION_PROVIDER_TOKEN` | ∅ | vacío | Se envía como `Authorization: Bearer`. Vacío = sin cabecera. Rótalo como cualquier credencial. |
| `REPUTATION_TIMEOUT_SECONDS` | † | `5` | Timeout **duro, también de conexión**. Un proveedor lento no bloquea a nadie indefinidamente; nunca reintenta. |
| `REPUTATION_MAX_BODY_BYTES` | † | `65536` | Cota del cuerpo de respuesta (1 KiB–1 MiB). Al superarse, se corta la conexión y se trata como fallo. |
| `REPUTATION_CACHE_TTL_HOURS` | † | `24` | Techo de validez de un veredicto (1 h–30 d). El proveedor puede **acortarlo** — nunca alargarlo, y nunca por debajo de **5 minutos** (suelo fijo, para que «vuelve a preguntarme pronto» no se convierta en una consulta por evaluación). |
| `REPUTATION_RECHECK_BATCH` | † | `50` | Enlaces reanalizados por ciclo del scheduler (1–500). Barrido de fondo, no un recorrido de todos los enlaces: los candidatos se ordenan por `links.reputation_checked_at` (los nunca examinados primero) y **toda** la ventana leída se marca como examinada, así que cada ciclo avanza en lugar de releer las mismas filas. |
| `REPUTATION_RELEASE_BATCH` | † | `50` | Enlaces **autobloqueados** re-evaluados por ciclo para retirar un bloqueo cuya causa desapareció (1–500). Acotado por el mismo motivo que el anterior, en la dirección contraria, y con el mismo cursor: la cola se ordena por `links.reputation_checked_at` (los nunca examinados primero) y `evaluate()` marca lo que examina, así que una tanda que no retira nada igualmente deja atrás a los mismos bloques en vez de releerlos cada ciclo. |
| `REPUTATION_REANALYSIS_BUDGET` | † | `500` | Enlaces que un bloqueo de destino **nuevo** reanaliza de una vez, contando enlaces y reglas juntos (1–2000). Si el host tenía más, el barrido se detiene y **lo dice** (`linksSweepTruncated: true` + `reputation.reanalysis_truncated`), y el resto **continúa solo**: el servicio encola `ContinueDestinationSweepJob` con el cursor devuelto en `linksSweepCursor` y el job repite tandas acotadas hasta terminar, sin depender de que haya proveedor de reputación ni de que el scheduler llegue. |
| `REPUTATION_AUTO_BLOCK` | ⚑ | `false` | **Con `false`, un veredicto `malicious` no bloquea a nadie.** Sólo con `true` un veredicto `malicious` de un proveedor configurado puede bloquear. |
| `REPUTATION_DOMAIN_MONITOR` | ⚑ | `true` | Vigila la reputación de los hosts propios y emite `reputation.domain_listed` si aparecen mal valorados. |


Consecuencias que conviene tener presentes:

- **`unknown` nunca es `safe`.** Proveedor ausente, lento, caído o respondiendo
  algo fuera de contrato se registra como `unknown` y se reintenta en una ventana
  corta; no se cachea como decisión.
- **El veredicto se lee sin distinguir mayúsculas ni espacios** (`"MALICIOUS"`,
  `" Malicious "`), porque el caso contrario es el único que apaga en silencio la
  retirada automática de abuso. Lo que no es `safe`/`suspicious`/`malicious` se
  registra como `provider_verdict_unusable` **y suma
  `reputation.verdict_unusable`**: una integración que contesta en otra forma es
  una avería que hay que mirar, no una tarde tranquila.
- **Un bloqueo nuevo avisa si no llegó a todos los enlaces.** El barrido que
  reencola los enlaces que ya apuntaban al host está acotado
  (`REPUTATION_REANALYSIS_BUDGET`); la respuesta del endpoint distingue «hecho» de
  «me detuve en el tope» en vez de presentar un bloqueo parcial como completo.
- **La reputación no decide ninguna escritura.** Se aplica en segundo plano,
  sobre enlaces que ya existen, en el pool `security`. La denylist local sí
  decide, de forma síncrona, en el alta (incluidos el destino *fallback* y las
  reglas de redirección).
- **Sólo se retira lo que la plataforma decidió por sí misma.** Un bloqueo
  automático lleva marcador en el enlace y se libera al desaparecer su causa
  (entrada retirada o caducada, veredicto que mejora, `REPUTATION_AUTO_BLOCK`
  apagado). Un bloqueo de moderador no lleva marcador y **nunca** se libera solo.
- **Un enlace bloqueado automáticamente es apelable** y restaurar retira las
  entradas de denylist que aplicaban al destino.
- **Marcha atrás:** `REPUTATION_AUTO_BLOCK=false` recupera de inmediato el
  comportamiento conservador; `REPUTATION_PROVIDER_URL` vacío desactiva la capa
  entera sin tocar código.

Contrato, operación y lo que **no** está acreditado:
[`url-reputation-runbook.md`](url-reputation-runbook.md).

---

## 16. Feed de estado público

| Variable | | Por defecto | Efecto |
|---|---|---|---|
| `PUBLIC_STATUS_FEED_URL` | ∅ | vacío | Monitor **externo** al despliegue. HTTPS, puerto 443, sin credenciales, fragmento ni IP. Sin él, `/api/v1/status` responde 503 con estado `unknown` (fallo cerrado). |
| `PUBLIC_STATUS_FEED_BEARER` | ∅ | vacío | Credencial de sólo lectura del feed. |
| `PUBLIC_STATUS_CONNECT_TIMEOUT_SECONDS` | † | `2` | — |
| `PUBLIC_STATUS_TIMEOUT_SECONDS` | † | `4` | — |
| `PUBLIC_STATUS_MAX_AGE_SECONDS` | † | `300` | Antigüedad máxima aceptada del feed; un feed congelado se trata como ausente. |

La salud pública **nunca** se deriva de `/health` propio. Contrato:
[`public-status-feed.md`](public-status-feed.md).

---

## 17. Dominios personalizados y borde interno

| Variable | | Por defecto | Efecto |
|---|---|---|---|
| `CUSTOM_DOMAIN_CNAME_TARGET` | \* | — | Destino del CNAME, hostname válido y **distinto** de `APP_HOST`/`PUBLIC_HOST`. |
| `EDGE_INTERNAL_HOST` | \* | `edge` | Nombre interno simple usado por el *ask* de Caddy. |
| `EDGE_INTERNAL_CIDRS` | \* | — | CIDR IPv4 RFC1918 normalizados (/24–/32). Aísla el listener privado. |
| `DOMAIN_VERIFICATION_FRESH_HOURS` | \* | `24` | Rango 1–168. |
| `DOMAIN_REVALIDATION_HOURS` | \* | `24` | Rango 1–168. |
| `DOMAIN_FAILURE_RETRY_HOURS` | \* | `1` | Rango 1–24. |
| `DOMAIN_FAILURE_GRACE_HOURS` | \* | `2` | Rango 1–24. |
| `DOMAIN_MAX_FAILURES` | \* | `3` | Rango 2–10. |

Un dominio verificado pero aún no activo debe volver a probar propiedad pasado
`DOMAIN_VERIFICATION_FRESH_HOURS`.

---

## 18. Housekeeping y retención

Todas **\*** porque son decisiones legales/operativas verificadas por el gate,
cada una con su rango. `HOUSEKEEPING_INTERVAL_MINUTES` (1–1440) marca la cadencia
del ciclo, que además reanaliza destinos, drena exportaciones y reconcilia colas.

| Variable | Por defecto | Rango | Qué purga |
|---|---|---|---|
| `SESSION_PURGE_DAYS` | `30` | 1–365 | sesiones expiradas/revocadas |
| `LINK_TRASH_DAYS` | `30` | (config) | papelera de enlaces antes del borrado definitivo |
| `TOKEN_PURGE_DAYS` | `7` | 1–90 | tokens de email usados/caducados |
| `API_TOKEN_PURGE_DAYS` | `30` | 7–365 | tokens de API revocados |
| `DELIVERY_PURGE_DAYS` | `90` | 7–365 | entregas de webhook exitosas |
| `FAILED_JOB_PURGE_DAYS` | `30` | 1–365 | jobs agotados |
| `MAIL_OUTBOX_PURGE_DAYS` | `30` | 7–365 | outbox de correo terminal |
| `ACCOUNT_RECOVERY_PURGE_DAYS` | `90` | 30–3650 | solicitudes de recuperación |
| `OPERATIONAL_METRICS_PURGE_DAYS` | `30` | 7–365 | contadores operativos |
| `PRIVACY_REQUEST_PURGE_DAYS` | `1095` | 365–3650 | solicitudes de derechos |
| `EXPORT_PURGE_DAYS` | `7` | 1–30 | artefactos de exportación |
| `AUDIT_PURGE_DAYS` | `365` | 30–3650 | auditoría |
| `ANALYTICS_RETENTION_DAYS` | `180` | 1–730 | eventos de clic y rollups |

Una variable de esta área no es de retención sino de forma: `ANALYTICS_MAX_MAP_KEYS`
(† , `200`) limita cuántos valores distintos se conservan **por dimensión y día**
en el rollup (`countries`, `devices`, `browsers`, `os`, `referrers`, `campaigns`).
`referrers` lo controla quien visita —cualquier cabecera `Referer`—, así que el
tope es necesario; lo que importa es **cuál** cede el hueco: lo hace el valor
menos frecuente, y el recién llegado entra **siempre** (nadie queda fuera para
siempre). Los contadores son exactamente lo observado: ni estimados ni inflados,
porque el mapa viaja en la exportación de datos de quien los protagoniza. Entre
valores igual de frecuentes no se afirma que ceda el más antiguo —el almacén no
conserva el orden de inserción— y cada descarte suma
`analytics.map_keys_dropped`. Está acotado en el código entre 10 y 5000, así que
un valor pequeño no puede convertir el rollup en un resumen de dos entradas.

Los rangos y las políticas deben coincidir con lo declarado en la política de
privacidad; el gate impide valores fuera de rango, no decisiones incoherentes.
La retención de analítica se apoya en índices por `day` propios de cada tabla
(migración `2026_09_14_000001`); sobre una tabla con historia hay que crearlos
con `CONCURRENTLY`.

---

## 19. Interruptores de seguridad, todos juntos

Estos no ajustan rendimiento: cambian garantías. Revísalos antes de cada
despliegue.

| Variable | Valor seguro | Qué pierdes si lo cambias |
|---|---|---|
| `COOKIE_DOMAIN` | vacío | la cookie del panel alcanzaría la superficie pública |
| `COOKIE_SECURE` | `true` | la cookie viajaría sin TLS |
| `HSTS_ENABLED` | `true` con HTTPS real | protección contra degradación a HTTP |
| `TRUST_COUNTRY_HEADER` | `false` sin borde de confianza | analítica por país falsificable por el cliente |
| `VERIFIED_REQUIRED_TO_CREATE` | `true` | creación de enlaces sin cuenta verificada |
| `HCAPTCHA_DEV_FALLBACK` | `false` | la verificación antiabuso desaparece |
| `REPUTATION_AUTO_BLOCK` | `false` hasta tener umbrales | bloqueo automático sin datos de falsos positivos |
| `EDGE_DRY_RUN` | `off` tras dimensionar la tasa | el techo de volumen del borde deja de rechazar |
| `APP_DEBUG` | `false` | fuga de detalles internos |
| `CACHE_LIMITER_SECURITY` | `database` | continuidad de la ventana de credenciales |
| `CACHE_LIMITER` | `failover` | disponibilidad de la superficie pública con Redis caído |

`VERIFIED_REQUIRED_TO_CREATE` no aparece en la plantilla de producción porque su
valor por defecto (`true`) es el correcto; existe como escape para entornos
controlados.

---

## 20. Si falta o está mal: qué se rompe

| Síntoma | Causa habitual | Dónde mirar |
|---|---|---|
| `Configuración de seguridad de producción inválida: …` | el gate acumula **todos** los errores | §4–§18; el mensaje nombra cada variable |
| El contenedor no arranca y el `.env` parecía correcto | la variable está fijada además en el bloque `environment` del compose, que prevalece | §1 |
| Nginx sirve el placeholder `${EDGE_...}` literal | falta la variable en `NGINX_ENVSUBST_FILTER` | §12 |
| Todos los clientes comparten cubo de rate limit | `TRUSTED_PROXIES` vacío o mal | §12, §8 |
| Un worker reclama un job que otro ejecuta | `REDIS_QUEUE_RETRY_AFTER` por debajo de 200 s | §10 |
| Login bloqueado durante una incidencia de Redis | `CACHE_LIMITER_SECURITY` apuntando a Redis | §9 |
| `/status` responde 503 `unknown` | feed externo ausente, caducado o inválido | §16 |
| La reputación aparece como «no verificada» | sin proveedor, o configurado pero sin veredictos recientes | §15 |

---

## 21. Añadido por las tareas recientes

- **`CACHE_LIMITER_SECURITY`** (nueva, obligatoria en producción) y la
  separación de limiters. `app/Support/UvhLimiters.php`,
  `app/Http/Middleware/UvhThrottleRequests.php`,
  `app/Cache/UvhRateLimiter.php`.
- **Bloque `REPUTATION_*`** completo (7 variables, 2 de ellas interruptores) con
  la integración opcional de reputación y la moderación por destino.
- **Bloque `EDGE_*`** (5 variables) con el techo de volumen del borde, más la
  restauración de la IP real desde `TRUSTED_PROXIES`.
- **Pool `security`** (`queue-security`) para las comprobaciones que llaman a un
  tercero.
- Los **índices de retención** de analítica (migración, sin variable).
- **Bloque del aparcadero de credenciales** (6 variables):
  `PENDING_INVITATION_COOKIE`, `PENDING_INTENT_COOKIE`, `INVITATION_TTL_DAYS`,
  `INTENT_TTL_HOURS`, `PENDING_LIMIT`, `PENDING_READ_LIMIT`. Sustituye el
  `localStorage` donde vivían el bearer de invitación y el del link intent; ver
  `docs/api.md` y `docs/security.md`.
- **Secreto de edición de registro** (2 variables): `REGISTRATION_EDIT_COOKIE`
  y `REGISTRATION_EDIT_TTL_HOURS`. Acredita que quien corrige la dirección de
  una inscripción sin verificar es el navegador que la creó; la contraseña que
  deja ese registro es una propuesta y no autoriza nada.

Los cambios de esquema se aplican con `php artisan migrate`; las migraciones son
idempotentes donde importa y los índices de tablas con historia se crean antes
con `CONCURRENTLY`.

---

## 22. Verificación automatizada de esta página

| Qué | Dónde |
|---|---|
| Cada variable de la plantilla llega a Nginx | `EdgeLimitContractTest` |
| La plantilla de producción no contradice `config/uvh.php`, y ninguna clave suya queda sin lector | `EnvTemplateContractTest` |
| El borde nunca es más estricto que Laravel | `EdgeLimitContractTest` |
| El limiter de credenciales cuenta en su store y no se reinicia | `SecurityLimiterStoreTest` |
| Cada limiter clasificado está registrado y se usa | `UvhLimitersTest` |
| Producción rechaza una configuración insegura | `ProductionSecurityTest` |
| Esquema, tablas e índices | `DatabaseSchemaTest` |
| La reputación nunca afirma «seguro» sin proveedor | `DestinationReputationTest` |

Lo que **no** acredita ninguna de ellas: que los valores concretos de un
despliegue real sean los adecuados. Eso se decide en
[`release-evidence-template.md`](release-evidence-template.md) y en
[`production-readiness.md`](production-readiness.md).
