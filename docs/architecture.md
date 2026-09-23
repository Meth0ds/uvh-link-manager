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
| Backend       | Laravel 13 (PHP 8.4), Eloquent/Query Builder, colas en Redis, scheduler                                 |
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

La redirección **no visita** el destino. El clic se registra con `UPDATE ... WHERE` atómico para `single_use` y `max_clicks`, de modo que dos peticiones simultáneas solo consumen una. La prueba es `backend-laravel/tests/Feature/RedirectConcurrencyTest.php`: procesos reales liberados desde una barrera común, con una aserción que falla si no llegan a solaparse. (Una versión anterior de este documento atribuía esa cobertura a `ApiParityTest`, que solo comprueba la forma del payload.)

Un enlace **sin** límites no toma bloqueo exclusivo: lee bajo `SELECT ... FOR SHARE` y suma su contador en una sentencia propia fuera de la transacción, de modo que los redirects del mismo alias no se bloquean entre sí. El reparto y sus límites están en `docs/redirect-and-webhook-availability-policy.md`.

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

Al **serializar**, esa regla es una sola forma para todos los endpoints: `IsoDate::format()` responde `YYYY-MM-DDTHH:MM:SS.sssZ` tanto si el valor llegó como objeto de fecha (un modelo o `now()`) como si llegó como cadena ISO, y convierte —no reenvía— la forma de PostgreSQL (`2026-09-16 12:00:00+00`) con la que el *query builder* devuelve una columna `timestamptz` sin modelo que la caste. Antes se reenviaba tal cual, así que dos endpoints contestaban el mismo campo en dos formatos y uno de ellos no era ISO: los decodificadores del panel exigen `T`. Un valor que no es un instante (un entero, un booleano, una palabra) devuelve `null` en lugar de escribirse como texto.

## 6. Autenticación y autorización

- **Sesión SPA:** cookie `HttpOnly` + `SameSite` + `Secure` en producción (implementación propia en `SessionManager`, hash SHA-256 del token en BD), CSRF de doble envío en mutaciones, regeneración de sesión tras login, reautenticación para operaciones sensibles y MFA (TOTP + códigos de recuperación).
- **Nunca** `localStorage`/`sessionStorage` para credenciales o tokens (solo se usa `localStorage` para preferencias no sensibles: workspace seleccionado y tema).
- **Autorización 100% en backend** con comprobación de pertenencia al workspace y rol (`WorkspaceAccess`). Los guards de Angular son solo UX; nunca son una frontera de seguridad.
- Los endpoints administrativos exigen `is_admin` + MFA activado (`uvh.mfa`).

## 6.b Almacenes de estado

Dos almacenes, con responsabilidades que no se solapan:

| Almacén | Qué guarda | Por qué ahí |
|---|---|---|
| PostgreSQL | Fuente de verdad: cuentas, enlaces, dominios, auditoría, `mail_outbox`, `webhook_deliveries`, `data_export_requests`, `failed_jobs` y las sesiones propias (`uvh_sessions`) | Necesita transacciones, integridad referencial y restauración con RPO/RTO medibles |
| Redis | Caché de aplicación, rate limits, locks distribuidos y las colas (`mail`, `webhooks`, `domains`, `exports`, `analytics`, `default`) | Es el estado efímero que comparten procesos: PHP-FPM, un worker por cola y el scheduler. No sobrevive como verdad: lo que importa se reconstruye desde PostgreSQL |

El camino de un redirect público (la operación más frecuente del producto) sólo
toca PostgreSQL para leer el enlace y actualizar su contador. Antes, el throttle
`uvh-resolve` contaba cada intento en la tabla `cache`, con un `SELECT ... FOR
UPDATE` por petición y por IP; con el limiter en Redis esa escritura desaparece
del camino crítico.

Las sesiones **no** se mueven a Redis a propósito. La sesión propia es la fuente
de verdad de la revocación inmediata: cerrar sesión o revocar accesos debe
efectarse en el mismo sitio que los consulta, sin caché intermedia. Además el
stack de sesión de Laravel está desactivado (`bootstrap/app.php` retira
`StartSession`), así que `SESSION_DRIVER` no interviene.

El rate limiter tiene stores propios porque es el único consumidor de caché que
no puede caer con su backend, y no todas sus clases pueden degradarse igual.

Los límites de **volumen** (redirects, API, panel) apuntan a `CACHE_LIMITER`, un
store `failover` (Redis y, si no responde, PostgreSQL): la superficie pública
sigue contando y sirviendo durante una caída. Se degrada con una métrica
(`cache.failed_over`), no en silencio.

Los límites de **credenciales** (login, MFA, verificación, recuperación,
restablecimiento, reautenticación, registro) cuentan en `CACHE_LIMITER_SECURITY`,
un store único que no puede ser la cadena `failover` ni Redis. Para ellos un
segundo backend no es un respaldo sino una segunda ventana vacía: la caída del
primero regalaría presupuesto al atacante y, al volver, sus contadores antiguos
podrían bloquear a una cuenta legítima. La clasificación está en
`app/Support/UvhLimiters.php` y la aplica `UvhThrottleRequests`; el gate de
producción rechaza una configuración que reintroduzca cualquiera de las dos
cosas, y el login sigue funcionando con Redis caído porque ese store no es Redis.

Los locks no usan ninguno de los dos: mover un lock a otro backend permitiría que
dos procesos lo creyeran suyo.

## 7. Trabajos programados (scheduler)

El backend ejecuta cada 60 s un job (`UvhHousekeeping`) que:

1. activa enlaces `scheduled` vencidos;
2. caduca enlaces `expired`;
3. purga `click_events` y `metric_rollups` según retención;
4. reintenta `webhook_deliveries` pendientes con backoff;
5. limpia sesiones/tokens revocados y expirados.

En local corre con `php artisan schedule:work` (contenedor `schedule` del
Compose). Producción separa las cargas `mail`, `webhooks`, `domains`, `exports`,
`analytics` y `security` en workers y heartbeats independientes; `default` queda
sólo como cola de compatibilidad para drenar jobs serializados antes del
despliegue. Esta separación evita que una exportación, una consulta DNS/TLS o
una llamada a un proveedor de reputación con timeout propio bloquee correo de
cuenta o entregas webhook.

La purga por fecha de las dos tablas de analítica se apoya en índices por `day`
propios (`metric_rollups`, `metric_unique_visitors`): sus claves
(`link_id, day[, visitor_hash]`) nunca llevan `day` delante, así que sin ellos
cada barrido de retención recorre la tabla entera, una vez por minuto y sobre las
mismas tablas que escribe el camino del clic. Sobre una tabla con historia hay
que crearlos con `CONCURRENTLY`; la migración es idempotente después. La
contención de los rollups —una fila por enlace y día compartida por todos los
workers de `analytics`— y su techo medido están en
[`analytics-rollup-capacity.md`](analytics-rollup-capacity.md).

El mismo tick reanaliza los destinos cuya valoración falta o está caducada y
vigila la reputación de los hosts propios. Ese barrido es acotado y se omite por
completo si no hay proveedor configurado: sin proveedor no hay nada que
preguntar y barrer sólo gastaría un job por enlace y ciclo.

## 7 bis. Moderación a nivel de destino

La unidad de moderación es el **destino**, no el enlace. Bloquear sólo el enlace
dejaba el abuso intacto: la misma URL volvía como otro enlace minutos después y
también era alcanzable por una regla de redirección. Hay por tanto dos capas
independientes:

- **Denylist local** (`destination_denylist`): determinista y síncrona, sin red.
  Se aplica en el único punto por el que pasa toda escritura (`LinkService`),
  incluida la superficie de tokens de API que no toca el panel. Empareja por
  etiqueta (`evil.example` cubre sus subdominios, nunca `notevil.example`) y
  guarda las URLs como hash canónico, no en claro. Puede caducar y reactivarse.
- **Proveedor de reputación opcional** (pool `security`): asíncrono, nunca
  decide una escritura. `suspicious` abre un caso de moderación; `malicious`
  sólo bloquea si el despliegue ha activado `REPUTATION_AUTO_BLOCK`. `unknown`
  nunca se presenta como «seguro». Contrato y operación:
  [`url-reputation-runbook.md`](url-reputation-runbook.md).

Un enlace bloqueado automáticamente es auditable (`system.link_block`) y
apelable: el propietario abre una apelación y un moderador decide restaurar o
mantener. Restaurar retira las entradas de denylist que aplicaban al destino, de
modo que una persona puede anular una decisión automática.

### 7 bis.1 Quién es dueño de qué en la consola

La pestaña **Moderación** son tres colas con tres dueños, no una pantalla:

| Cola | Dueño del estado | Dónde |
|---|---|---|
| Denuncias (y bloqueo de destino) | `AdminReportsComponent` | `frontend/src/app/panel/admin/admin-reports.component.*` |
| Apelaciones | `AdminAppealsComponent` | `.../admin-appeals.component.*` |
| Destinos bloqueados | `AdminDestinationsComponent` | `.../admin-destinations.component.*` |

Cada cola tiene su filtro, su paginación, su estado de carga y error, sus
acciones y su señal de «hay una acción en vuelo». El contrato entre ellas y la
consola es de dos líneas y va en una sola dirección:

- `reloadToken` (entrada): la consola dice **cuándo volver a leer**.
- `changed` (salida): la cola dice **que algo cambió**, sin decidir qué
  invalida.

La política de refresco vive en un único punto (`AdminComponent::refreshModeration`):
cualquier decisión de moderación incrementa `moderationRevision` —la entrada que
escuchan las tres colas— y relee los contadores, la operación y el registro. Así
una decisión no puede quedar aplicada en una vista y olvidada en otra, y ninguna
cola necesita saber quién actuó. El contenido de cada pestaña se instancia al
abrirse, de modo que una cola cerrada no pide nada.

El aspecto compartido tampoco se escribe dos veces: `queue-primitives.scss` y
`moderation-card.scss` son **bibliotecas de mixins**, no parciales de reglas, y esa
diferencia es la que hace que la regla se aplique. `@use` compila todo lo que el
fichero contiene, y la encapsulación de Angular da a cada nodo el atributo del
componente que lo *declara*: una regla escrita para un nodo proyectado (el
resumen, la barra de filtros, los chips, las filas) no puede casar en la hoja del
marco, y una regla del marco (encabezado, vacío, paginador) no puede casar en la
hoja de una cola. Por eso cada componente incluye exactamente los bloques que
dibuja —el marco, cuatro; una cola, los suyos—, y los matices (`spaced`,
`compact`, `boxed`) son modificadores, no copias. El reparto verificado: la hoja
del marco emite `.empty`, `mat-paginator` y `.section-heading`; las de las colas
emiten `.filters`, `.badge` y el resumen proyectado; nadie compila lo que no
puede alcanzar.

`core/date-time-label.ts` es el único formateador de fechas del panel, y lee las
dos formas que la API manda (ISO 8601 y el texto propio de PostgreSQL, cuyo
desfase puede venir corto: `+00` → `+00:00`). Decide las dos lecturas que el
panel usa: `dateTimeLabel` (numérica, con segundos: la consola) y
`dateTimeMediumLabel` (mes en palabra y sin segundos: cuenta, seguridad,
papelera, webhooks y detalle de dominio, cada una con su texto de reserva).

### 7 bis.2 Las colas del panel: un motor, un marco, seis declaraciones

`core/queue-paging.ts` (`QueuePaging`) es el **motor de lectura** de una lista
paginada: qué página está en pantalla, si está llegando, qué falló y qué
respuesta es la vigente (cancela la anterior al cambiar de pregunta). No sabe
nada de filas ni de aspecto. Una cola se declara con tres cosas —sus filtros
(`filters`, que son la identidad de la petición), su lectura (`read`) y el texto
de reserva si el fallo no trae mensaje— y recibe el resto. `panel/queue-section.component.ts`
es su **marco de presentación**: encabezado, progreso, aviso con «Reintentar»,
vacío y paginador. La cola proyecta en él sus cuatro piezas propias
(`[queue-summary]`, `[queue-actions]`, `[queue-filters]`, `[queue-rows]`).

Con eso, las seis colas que viven en la consola —usuarios, recuperaciones,
dominios, auditoría, correo y privacidad— son seis declaraciones en
`AdminComponent`, no seis copias de la misma contabilidad (eran ~150 líneas de
cargadores, banderas, guardas y manejadores de paginador; ahora son ~90 líneas de
declaración). El parpadeo del progreso en cada cambio de filtro se cierra con
`patch` de test en el marco, no cola a cola.

**Quién es dueño de qué** en la consola, tras la pasada:

| Estado | Dueño |
|---|---|
| Resumen, operación y su registro de reintentos | `AdminComponent` (no son colas de filas) |
| Página, banderas, aviso y cancelación de cada lista paginada | `QueuePaging`, una instancia por cola |
| Cuándo relee la pestaña de moderación | `AdminComponent::refreshModeration` (`moderationRevision`) |
| Contadores de estado, etiquetas y opciones de filtro | los módulos de vocabulario en `core/*-label.ts` y `core/*-status-label.ts` |
| Mensaje de un fallo | `core/api-message.ts`: `apiMessage` y su lectura de consola `adminMessage` (un 403 es sesión cerrada) |

Un cambio de comportamiento en la paginación (la regla de cancelar al
superponerse, qué bandera espera una acción) aterriza ahora en `queue-paging.ts`
y no en siete sitios.

Del lado del backend, tres piezas tienen también un solo dueño:

- `app/Support/LinkBlockReason.php` responde «por qué se está rechazando este
  enlace» leyendo la transición más reciente del registro (una decisión de
  moderación se registra contra la denuncia, de ahí que lea los dos ámbitos).
- `app/Support/AdminText.php` contiene las reglas del texto libre que firma un
  operador —UTF-8 válido, sin caracteres de control, con límite— para el motivo de
  un bloqueo, el de un destino y la nota de una apelación; el mensaje que explica
  cada rechazo sigue en su endpoint.
- `app/Support/VisitorAnswer.php` decide **qué se le contesta a un visitante**.
  Cada desenlace de la puerta —contraseña requerida, formulario caducado,
  contraseña fuera de rango, incorrecta, acierto, enlace que no resuelve y límite
  agotado— tiene un método con sus dos caras leídas juntas: la página que ve un
  navegador y el sobre que recibe un cliente JSON, con los mismos códigos, los
  mismos cuerpos y las mismas cabeceras del contrato congelado (incluido el
  `Retry-After` y los `X-RateLimit-*` del limitador, que viajan en las dos). El
  controlador decide la admisión; el limitador `uvh-unlock` declara el hecho;
  ninguno de los dos compone el documento, que es de
  `app/Support/VisitorPage.php`. El acierto responde 200 con su pantalla de
  continuación y no un 302 porque la política `form-action 'self'` se comprueba en
  cada salto de un envío de formulario y el destino de un enlace está en otro
  origen.

## 8. Decisiones de seguridad destacadas

- Validación de destino: solo `http`/`https`, rechazo de `javascript:`, `data:`, `file:`, credenciales embebidas, CR/LF.
- SSRF en webhooks (`app/Support/Ssrf.php`): bloqueo de loopback, redes privadas, link-local y metadata cloud, IPs fijadas con `CURLOPT_RESOLVE` y sin redirecciones.
- Hash de tokens de API, sesiones y tokens de email (SHA-256); secretos de webhook y TOTP cifrados en reposo (AES-256-GCM).
- Auditoría append-only de acciones sensibles.
- Rate limiting diferenciado por endpoint (login, registro, recuperación, MFA, creación de enlaces, alias, API, webhooks, denuncias, admin).
- Ver `docs/security.md` y `docs/security-audit-2026-08-19.md`.
