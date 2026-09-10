# UVH — API

API REST bajo `/api/v1` (panel en `app.uvh.es`). Las mutaciones realizadas
desde navegador requieren `X-CSRF-Token`; las rutas protegidas además requieren
cookie de sesión. La API de integración bajo `/api/v1/public/*` usa
`Authorization: Bearer` y no depende de cookies ni de CSRF. Las rutas de
workspace requieren `X-Workspace-Id` y autorizan por rol en backend.

- Roles: `owner` > `admin` > `editor` > `viewer`.
- `requireVerified` = email verificado.
- Errores: `{ "error": string, "details?": unknown }`.

### Convenciones de errores y listados

- `409 Conflict` indica estado concurrente o ya cambiado: challenge procesándose,
  configuración webhook en uso, recurso duplicado o sesión/generación obsoleta.
  El cliente debe recargar o reintentar la operación completa; no debe asumir
  que la mutación parcial se confirmó.
- `429 Too Many Requests` representa rate limit o una cuota/backlog acotado. El
  cliente debe respetar `Retry-After` cuando exista y aplicar backoff; no debe
  convertir automáticamente el mismo intento en varias solicitudes paralelas.
- `503 Service Unavailable` indica que una dependencia necesaria para preservar
  la operación —hCaptcha, cache/locks, cola u outbox— no está disponible. Estos
  flujos fallan cerrados y la respuesta no acredita que la mutación se guardara.
- Los listados paginados devuelven `total`, `page` y `perPage`. Otros endpoints
  son instantáneas deliberadamente acotadas: sesiones y tokens devuelven como
  máximo 100 elementos y `truncated`; actividad de enlace y entregas webhook
  devuelven las 50 más recientes sin paginación ni `total`.

## Autenticación — `/api/v1/auth`

| Método | Ruta | Auth | Descripción |
| ------ | ---- | ---- | ----------- |
| POST | `/register` | — | Registro multistep. Requiere `name`, `email`, `password`, `captchaToken`, `acceptTerms: true`, `termsVersion` y `privacyVersion`; el honeypot `website` debe estar vacío. Crea usuario + workspace + cuota, audita por separado la aceptación contractual y el aviso de privacidad mostrado, y envía email de verificación sin crear sesión. |
| POST | `/login` | — | Login con `email`, `password` y `captchaToken`, sólo para cuentas con email verificado. Si MFA: `{ mfaRequired: true, challenge, recoveryAvailable }`; si no: `{ user }`; una cuenta no verificada recibe `403` y no crea sesión. |
| POST | `/change-registration-email` | — | Corrige una dirección de registro no verificada con `{ currentEmail, newEmail, password, captchaToken }`; invalida el token anterior y envía uno nuevo, sin crear sesión. |
| POST | `/mfa/verify` | — | Completa login MFA con `{ challenge, code }` → `{ user }`. El challenge dura cinco minutos, está ligado a la versión de seguridad y se consume una sola vez. |
| POST | `/mfa/recovery` | — | Completa el mismo challenge con `{ challenge, code }`; consume atómicamente el challenge y un recovery code de un solo uso. |
| POST | `/logout` | sesión | Revoca la sesión actual. |
| POST | `/verify-email` | — | `{ token }` → verifica el email, consume el bearer token y revoca cualquier sesión legacy/preexistente; el acceso posterior exige un login nuevo. |
| POST | `/resend-verification` | — / sesión | Reenvía el correo de verificación con `{ email }` cuando no hay sesión. La respuesta pública es genérica (anti-enumeración) y aplica cooldown de 60 s. |
| POST | `/forgot-password` | — | `{ email }` → envía enlace (respuesta idéntica siempre, anti-enumeración). |
| POST | `/reset-password` | — | `{ token, password }` → restablece y revoca sesiones; el token se consume atómicamente y solo puede funcionar una vez. |
| POST | `/account-recovery/complete` | — | `{ token, password, confirmation: "RECUPERAR MI CUENTA" }`; finaliza un expediente con dos aprobadores vigentes, rota credenciales, retira MFA y rol admin, y admite el aviso de incidente en el mismo commit. |
| GET | `/me` | sesión | `{ user }`. |
| GET | `/mfa/session` | sesión | `{ enabled, fresh, verifiedAt, expiresAt }`; sólo expone la frescura del factor de la sesión actual. |
| POST | `/mfa/reauthenticate` | sesión verificada | `{ password, factorCode }`; renueva la ventana administrativa con TOTP o recovery actual sin rotar la cookie. |
| PATCH | `/profile` | sesión | `{ name }`. |
| POST | `/change-password` | sesión | `{ current, newPassword, factorCode? }`; exige TOTP/recovery si MFA está activo, revoca las demás sesiones y avisa por email. |
| POST | `/change-email` | sesión verificada | `{ newEmail, password, factorCode? }`; reserva el buzón una hora y envía confirmación sin cambiar todavía el acceso. |
| POST | `/change-email/cancel` | sesión verificada | `{ password, factorCode? }`; cancela la reserva pendiente. |
| POST | `/confirm-email-change` | — | `{ token }`; confirma el nuevo buzón, cambia la identidad y cierra todas las sesiones. La SPA exige clic explícito. |
| GET | `/sessions` | sesión | `{ sessions[], truncated }`, hasta 100, incluyendo `current` para identificar el navegador actual. |
| POST | `/sessions/:id/revoke` | sesión | Revoca una sesión; si es la actual devuelve `current: true`, borra la cookie y el panel cierra sesión inmediatamente (también sincroniza otras pestañas). |
| POST | `/mfa/setup` | sesión | `{ password, code? }` → `{ secret, uri }`; `code` es obligatorio al reconfigurar MFA activo y la configuración pendiente caduca a los diez minutos. |
| POST | `/mfa/enable` | sesión | `{ code }` → `{ recoveryCodes[] }`; los códigos sólo se entregan en esta respuesta y después se almacenan mediante hash. |
| POST | `/mfa/cancel-setup` | sesión | Invalida un secreto MFA pendiente que todavía no se ha activado. |
| POST | `/mfa/recovery-codes/regenerate` | sesión + MFA | `{ password, factorCode }`; invalida el juego anterior, entrega `recoveryCodes[]` nuevos una sola vez y revoca otras sesiones. |
| POST | `/mfa/disable` | sesión | `{ password, code }`; exige contraseña y TOTP o recovery actual (step-up). |
| GET | `/data-export` | sesión verificada | Estado de la solicitud de exportación más reciente. |
| POST | `/data-export` | sesión verificada | `{ password, factorCode? }`; solicita confirmación por email tras step-up. |
| POST | `/data-export/confirm` | — | `{ token }`; inicia el job sólo tras confirmación explícita en la SPA. |
| POST | `/data-export/download` | — | `{ token }`; sirve el JSON privado con `no-store` sin consumir el bearer. Incluye expedientes/mensajes RGPD propios, sin secretos ni identificadores internos del personal. Una transferencia interrumpida se puede reintentar mientras no caduque. |
| POST | `/data-export/download/acknowledge` | — | `{ token }`; exige que el servidor haya preparado antes una descarga válida y el navegador la invoca sólo después de recibir el cuerpo completo. Entonces marca `downloaded`, invalida el bearer y purga el artefacto. No afirma que el usuario haya abierto o guardado el fichero. |
| POST | `/data-export/cancel` | sesión verificada | Cancela solicitud/worker/artefacto activo. |
| GET | `/account-deletion` | sesión verificada | Impacto y bloqueos: admin, workspaces propios y confirmación pendiente. |
| POST | `/account-deletion` | sesión verificada | `{ confirmation: "ELIMINAR MI CUENTA", password, factorCode? }`; envía doble confirmación. |
| POST | `/account-deletion/confirm` | — | `{ token }`; cierra acceso y programa anonimización a siete días. |
| POST | `/account-deletion/cancel` | — | `{ token }`; restaura el acceso durante el periodo de gracia, sin restaurar tokens revocados. |

Los endpoints TOTP y recovery serializan el consumo del challenge. Una segunda
petición simultánea recibe `409`; si el store compartido o su lock no puede
garantizar el consumo único, responden `503` y no presentan el incidente como
un código incorrecto. Los recovery codes aceptan el formato mostrado por la SPA
o su forma normalizada de 16 caracteres; cada valor deja de ser válido al usarse.

Cambio/reset de contraseña y finalización de recuperación guardan su aviso de
incidente junto con las credenciales. Un fallo de admisión del outbox devuelve
`503` y revierte la operación, incluido el consumo de bearers/recovery codes
persistidos; el reintento exige que sigan vigentes. Un TOTP consumido en caché
mantiene su marca antirreplay incluso si SQL revierte: usar el siguiente código.
Un `200` no acredita recepción del email; el proveedor se invoca posteriormente.

La misma admisión obligatoria se aplica a alta/sustitución/desactivación MFA,
regeneración de recovery codes y solicitud/confirmación de cambio de email.
Si falla guardar un aviso, se devuelve `503` y no se confirma la mutación ni se
entregan recovery codes nuevos. En cambio de email, los avisos de ambos buzones
se guardan juntos: fallar el segundo revierte también el primero. Se conservan
la reserva y los códigos persistidos anteriores; el TOTP usado exige el siguiente
código del autenticador para reintentar, sin borrar su marca antirreplay.

La emisión de tokens API y la transferencia/eliminación de workspace también
responden `503` y revierten su operación si no admiten el aviso de seguridad;
no se devuelve `plainToken` en ese fallo. Cancelar una eliminación de cuenta es
distinto: se prioriza detener el borrado, por lo que puede devolver `200` aunque
falle admitir su aviso. El estado cancelado, no la recepción del correo, es la
confirmación autoritativa; no se reactivará la eliminación para reintentar un aviso.

## Derechos sobre datos — `/api/v1/auth/privacy-requests`

| Método | Ruta | Auth | Descripción |
| ------ | ---- | ---- | ----------- |
| GET | `/` | sesión verificada | Lista paginada de expedientes propios y sus mensajes descifrados. |
| POST | `/` | sesión verificada | `{ type, details? }`; registra acceso, rectificación, supresión, oposición, limitación o portabilidad. Sólo admite un expediente activo por tipo. |
| POST | `/:id/respond` | sesión verificada | `{ message }`; responde cuando el estado es `waiting_user` y devuelve el expediente a revisión. |
| POST | `/:id/cancel` | sesión verificada | Cancela un expediente propio todavía activo. |

La administración usa `/api/v1/admin/privacy-requests`, exige rol de plataforma,
MFA reciente y aplica transiciones de estado en backend. Los mensajes libres se
cifran en reposo; los listados nunca devuelven ciphertext ni generaciones de
idempotencia.

La configuración pública de hCaptcha y la identidad legal publicable se obtiene
de `GET /api/v1/config`. La identidad se devuelve como una unidad o `null`, nunca
parcial; producción no arranca con campos pendientes. El
`captchaToken` se verifica siempre en backend y el secreto nunca forma parte de
la respuesta pública. Login, registro y reenvío usan el modo invisible: cada
submit ejecuta un reto nuevo y no conserva tokens para intentos posteriores. El
proveedor aún puede mostrar un desafío cuando su evaluación de riesgo lo exige.
En desarrollo/test se reconoce `dummy-key-pass` únicamente para la sitekey
oficial de prueba; las claves reales y producción conservan la comparación
estricta con el hostname esperado.

## Intenciones de enlace — `/api/v1/link-intents`

| Método | Ruta | Auth | Descripción |
| ------ | ---- | ---- | ----------- |
| POST | `/` | — | `{ destination }` → `{ intent, expiresAt }`. Guarda temporalmente el destino y devuelve sólo un token opaco. |
| POST | `/claim` | sesión verificada | `{ intent }` → `{ destination, expiresAt }`. La primera reclamación vincula la intención al usuario; el índice de revocación no guarda destino ni bearer y limita a 100 pendientes por cuenta. |
| POST | `/complete` | sesión verificada | `{ intent }` → `{ ok: true }`. Invalida la intención después de crear o descartar el enlace. |

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
| GET | `/:id` | `memberPage`, `memberPerPage`, `invitationPage`, `invitationPerPage` → `{ workspace, members[], membersPage, invitations[], invitationsPage }`; cada `perPage` admite hasta 100. Invitaciones sólo se exponen desde rol `admin`. |
| PATCH | `/:id` | Renombrar (admin/owner). |
| PATCH | `/:id/members/:userId` | Cambiar rol (admin/owner). |
| POST | `/:id/transfer-ownership` | Owner + step-up `{ targetUserId, password, factorCode? }`; el owner anterior pasa a admin. |
| DELETE | `/:id/members/:userId` | Eliminar miembro. |
| POST | `/:id/leave` | Abandonar (no owner). |
| DELETE | `/:id` | Eliminar (owner) con body `{ confirmation, password, factorCode? }`; `confirmation` debe coincidir exactamente con el nombre. |
| POST | `/:id/invitations` | Invitar `{ email, role }`. |
| POST | `/invitations/accept` | Aceptar invitación (token). |
| POST | `/invitations/reject` | Rechazar invitación (token). |
| DELETE | `/:id/invitations/:invitationId` | Cancelar invitación. |
| POST | `/:id/invitations/:invitationId/resend` | Reenviar invitación. |

Cada cuenta puede poseer hasta 20 workspaces: tanto crear como recibir una
transferencia devuelve `429` al alcanzar ese máximo. Pertenecer como miembro a
workspaces ajenos no consume esta cuota. Un rechazo por cuota no consume el
factor MFA de la transferencia ni modifica roles o genera sus avisos. Las
cuentas con exceso histórico pueden transferir hacia fuera o borrar workspaces;
no se elimina ningún recurso automáticamente para ajustar el límite.

Los correos nuevos llevan el bearer en fragmento. La SPA lo retira de la URL,
lo conserva con TTL sólo en el mismo navegador durante el paso por login y exige
una decisión explícita de aceptar o rechazar. Los enlaces query antiguos se leen
temporalmente por compatibilidad.

La caducidad de una invitación es exclusiva: en `expires_at` ya no puede
aceptarse ni rechazarse. El listado proyecta `expired` para pendientes vencidas
sin modificar la base desde GET. Reinvitar al mismo email puede reutilizar esa
fila; reenviar admite estados pendientes o expirados, rota el enlace y renueva
siete días. Un `503` conserva token, estado y caducidad anteriores, pero no
prolonga su validez. Reenviar devuelve `409` si ya existe la pertenencia u otra
invitación pendiente; una aceptada, rechazada o cancelada no se reactiva desde
reenvío. Para una nueva invitación explícita se usa POST `/invitations`.

Perder autoridad revoca los enlaces pendientes afectados, no sólo su uso
temporal: transferir propiedad cancela las invitaciones de `admin` emitidas por
el antiguo propietario en ese workspace, conservando las de editor/visor.
Degradarlo por debajo de admin, expulsarlo o abandonar cancela todas las suyas
en ese workspace. Programar la eliminación de cuenta cancela las enviadas y
recibidas pendientes; cancelar la eliminación o restaurarla por fallo del correo
no las reactiva. Para volver a invitar se necesita una emisión explícita nueva.

Crear y reenviar comparten 20 intentos por cuenta/workspace cada 15 minutos;
cambiar sesión o escribir ceros iniciales en el ID no renueva ese presupuesto.
Los rechazos del controlador también consumen intentos; el `429` de throttling
incluye `Retry-After`. Esta capa requiere el store compartido de producción y
no representa un límite global diario ni por destinatario.

Cada workspace admite hasta 100 invitaciones pendientes con caducidad futura.
Se comprueba bajo lock antes de admitir recurso y correo. Una vencida/terminal
no ocupa plaza; su renovación sí necesita una. Reenviar una vigente conserva su
plaza, incluso con exceso histórico, sin aumentar el número activo. Sin plaza
se devuelve `429` de capacidad, sin rotar el bearer ni admitir correo; cancelar,
aceptar, rechazar o caducar libera plaza. No se borra historial automáticamente.

La admisión de correo añade presupuestos SQL compartidos: inicialmente 100 por
cuenta, 200 por workspace, 5 por destinatario, 200 por IP y 2000 globales en
ventanas de 24 horas desde la primera admisión; además, 1 por destinatario cada
60 segundos. Afectan crear y reenviar; el destinatario del reenvío siempre se
lee de la invitación bloqueada. Un rechazo `429` con `Retry-After` o un fallo de
admisión revierte reservas, bearer y sobre. Si no se puede comprobar presupuesto,
se devuelve `503`, sin envío sin límites. Requiere migración 000032, aún no
aplicada en esta revisión. Detalles y limitaciones en
[`invitation-mail-budget-runbook.md`](invitation-mail-budget-runbook.md).

Equipo conserva `Retry-After` en los errores API (segundos enteros o fecha HTTP
IMF-fixdate). Tras `429`, muestra una espera local compartida por crear/reenviar
al mismo destinatario y workspace; no afecta a cancelar ni supone que todos los
destinatarios estén bloqueados. No hay reintento automático. Al recargar/salir se
pierde la cuenta atrás, no el presupuesto del servidor. Cabecera ausente/inválida
no inventa un plazo. El fin de la espera permite otro intento, no garantiza admisión.

## Actividad — `/api/v1/workspaces/:id/activity`

GET de sesión verificada y rol owner/admin. `limit=1..100` (25 por defecto),
`cursor` opcional opaco de hasta 2048 caracteres. Respuesta `{ workspaceId,
events, nextCursor, coverage: "attributed_events_only" }`; sin total global.
Orden descendente por fecha/ID; IDs de eventos, actores y recursos como strings.
Cada evento contiene `{ id, action, label, outcome, actor: { id, label },
resource: { type, id }, createdAt }`. No hay nombres, emails, metadata, IP,
destinos ni detalles internos. Actor/recurso no disponible puede tener ID null.

`outcome` es `completed`, `pending`, `failed` o `unknown`; admisión no prueba entrega.
Sólo se publican acciones expresamente catalogadas y atribuidas al workspace.
El cursor está cifrado/autenticado, ligado a cuenta/workspace/versión y caduca
en una hora, sin renovarse al paginar. No concede permisos ni promete snapshot.
Reinicio manual ante `422`; `401/403` de acceso, `429` con espera, `503` genérico
de infraestructura. `no-store`; ningún fallo amplía el scope. Requiere 000033.
60/min por cuenta y 120/min por IP, caché compartida necesaria. API preparada,
sin pruebas ejecutadas. Pantalla `/app/activity` implementada con páginas de 25
y cota local de 500, cursor sólo en memoria, reinicio manual e invalidación por
contexto/error. Detalle en `workspace-activity-roadmap.md`.

## Primeros pasos — `/api/v1/workspaces/:id/getting-started`

GET de sesión verificada para miembros del workspace explícito de la ruta,
limitado por `uvh-api` y con `no-store`. Devuelve `{ workspaceId, role, facts,
capabilities }`. No acepta un workspace alternativo mediante cabeceras.

`facts`: `linkPresent` y `redirectObserved` excluyen enlaces borrados; el segundo
sólo acredita contador positivo de redirecciones admitidas, no llegada al destino.
`domainPresent` acredita un registro, no DNS/TLS. `teammatePresent` exige otro
miembro verificado no suspendido; `invitationPending` exige pendiente vigente y
autoridad actual del emisor y es `null` para roles por debajo de admin. `mfaEnabled`
pertenece al usuario que consulta. No se devuelven destinos, emails, challenges ni
secretos. Las capacidades `createLink`, `addDomain`, `inviteTeam` orientan la UI,
sin sustituir controles de cada mutación. No guarda progreso ni visita enlaces.

Sin sesión: `401`; sin acceso o workspace inexistente: `403` genérico. Base de
PRODUCT-001 implementada y conectada a la pantalla de primeros pasos; validación pendiente.

## Dominios — `/api/v1/domains` (workspace)

| Método | Ruta | Rol | Descripción |
| ------ | ---- | --- | ----------- |
| GET | `/` | viewer | `{ domains[] }`; `verificationToken` sólo tiene valor para `editor` o superior. Incluye host TXT, destino CNAME, marcas DNS/TLS y errores seguros. |
| POST | `/` | editor | `{ domain }` → crea estado `pending` y genera TXT en `verificationHost` con valor `verificationToken`. Máximo 20 dominios por workspace. |
| POST | `/:id/verify` | editor | Admite la comprobación DNS y devuelve `202 { ok, state: "verifying" }`; el worker confirma TXT de propiedad y CNAME de ruta de forma asíncrona. |
| POST | `/:id/activate` | editor | Exige verificación reciente de propiedad/ruta y admite la emisión TLS; devuelve `202 { ok, state: "provisioning" }` hasta que el dominio quede `active`. |
| POST | `/:id/disable` | editor | Desactiva. |
| POST | `/:id/revalidate` | editor | Revalida DNS de forma asíncrona conservando el estado visible anterior; devuelve `202`. |
| DELETE | `/:id` | editor | Elimina. |

El alta normaliza IDN a Punycode y soporta únicamente hostnames que puedan usar
un CNAME directo hacia el edge configurado. Apex, ANAME/ALIAS flattening, proxies
DNS y wildcards quedan fuera de este contrato hasta disponer de validación propia.

## API tokens — `/api/v1/tokens` (workspace)

| Método | Ruta | Rol | Descripción |
| ------ | ---- | --- | ----------- |
| GET | `/` | editor | `{ tokens[], truncated }`, hasta 100 y sin el secreto. |
| POST | `/` | editor | `{ name, scopes[], expiresAt?, password, factorCode? }` → `{ token, plainToken }`; exige step-up y el bearer se muestra **una sola vez**. |
| DELETE | `/:id` | editor | Revocar. |

Scopes: `links:read`, `links:write`, `analytics:read`, `domains:read`, `domains:write`. Autenticación de API: cabecera `Authorization: Bearer <token>`.

## Webhooks — `/api/v1/webhooks` (workspace)

| Método | Ruta | Rol | Descripción |
| ------ | ---- | --- | ----------- |
| GET | `/` | viewer | `{ webhooks[] }`. |
| POST | `/` | editor | `{ url, events[], secret? }` → `{ webhook, secret }`; si se omite el secreto se genera uno y siempre se muestra **una sola vez** en la respuesta de creación. |
| PATCH | `/:id` | editor | Editar. |
| DELETE | `/:id` | editor | Eliminar. |
| GET | `/:id/deliveries` | viewer | `{ deliveries[] }`, las 50 más recientes. Sólo incluye metadatos de estado/intentos; nunca payload ni secreto. |
| POST | `/:id/deliveries/:deliveryId/resend` | editor | Reenvío manual. |
| POST | `/:id/test` | editor | Entrega de prueba. |

Eventos: `link.created`, `link.updated`, `link.deleted`,
`link.threshold_reached`, `domain.verified` y `ping` para pruebas. El body tiene
`{ event, event_id, timestamp, data }`. UVH considera correcta una respuesta
HTTP 2xx; en los demás casos reintenta hasta cinco intentos con backoff. La
entrega es **al menos una vez**: si el receptor procesó la petición pero UVH no
pudo persistir el éxito, el mismo `event_id` puede volver a recibirse. El
receptor debe deduplicar por `event_id` y hacer idempotente su efecto.

Cada intento envía `X-UVH-Event`, `X-UVH-Event-Id` y:

```text
X-UVH-Signature: t=<epoch_milliseconds>,v1=<hex_hmac_sha256>
```

La entrada del HMAC es `<epoch_milliseconds>.<raw_body>` usando el secreto del
webhook. El timestamp forma parte de la firma —no existe una cabecera
`X-UVH-Timestamp` separada—, por lo que el receptor puede limitar antigüedad
antes de deduplicar `event_id` y debe comparar la firma en tiempo constante.

## Administración — `/api/v1/admin` (admin + MFA reciente)

El middleware exige que `mfa_verified_at` esté dentro de
`ADMIN_MFA_FRESH_MINUTES` (15 minutos por defecto). Si caduca devuelve `403`
con `details.reason = "mfa_reauthentication_required"`; la SPA abre el flujo
de reautenticación y vuelve a la ruta interna original tras confirmar.

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| GET | `/overview` | Contadores globales. |
| GET | `/users` | `q`, `status`, `page`, `perPage` → `{ users[], total, page, perPage }`. Estados: `active`, `blocked`, `unverified`, `admin`, `mfa`. |
| PATCH | `/users/:id` | `{ isAdmin?, blocked? }`. |
| GET | `/reports` | `q`, `status`, `page`, `perPage` → `{ reports[], total, page, perPage }`. |
| PATCH | `/reports/:id` | `{ status }`. |
| POST | `/reports/:id/moderate` | `{ action, reason? }`, con `action=block|unblock|review|dismiss`. Actualiza denuncia y enlace en una única transacción. |
| GET | `/domains` | `q`, `state`, `page`, `perPage` → `{ domains[], total, page, perPage }`; nunca devuelve el token DNS. |
| GET | `/audit` | `q`, `action`, `resourceType`, `page`, `perPage` → `{ events[], total, page, perPage }`. |
| GET | `/operations` | Estado no sensible de entorno, cola, trabajos fallidos, webhooks, sesiones y dominios. No sustituye al sistema externo de monitorización. |
| POST | `/links/:id/block` | `{ reason }` → bloquea. |
| POST | `/links/:id/unblock` | Desbloquea. |

## Denuncias / público — `/api/v1`

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| POST | `/report` | `{ reportedUrl, reason, details?, email? }` (público, CSRF y rate limit). `reportedUrl` admite alias, URL de `uvh.es`, ruta legacy `/r/:alias` o un dominio personalizado registrado; la API sólo resuelve la referencia en base de datos y nunca visita el destino. `alias` se mantiene como compatibilidad interna, pero no se aceptan identificadores numéricos globales. |
| GET | `/status` | Estado del módulo antiabuso. `externalAnalysis` separa `configured`, `enabled` y `operational`; permanece `not_implemented` aunque exista una URL candidata, por lo que nunca presenta configuración como análisis ejecutado. |

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
