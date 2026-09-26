# UVH — API

API REST bajo `/api/v1` (panel en `app.uvh.es`). Las mutaciones realizadas
desde navegador requieren `X-CSRF-Token`; las rutas protegidas además requieren
cookie de sesión. La API de integración bajo `/api/v1/public/*` usa
`Authorization: Bearer` y no depende de cookies ni de CSRF. El esquema se
acepta en cualquier caja (`bearer`, `BEARER`), como manda RFC 9110 §11.1; el
token en sí se compara carácter a carácter. Las rutas de workspace requieren
`X-Workspace-Id` y autorizan por rol en backend.

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
| POST | `/register` | — | Registro multistep. Requiere `name`, `email`, `password`, `captchaToken`, `acceptTerms: true`, `termsVersion` y `privacyVersion`; el honeypot `website` debe estar vacío. Crea un **registro pendiente** (solo la dirección) y envía email de verificación sin crear sesión: hasta que el buzón se demuestra no hay cuenta —ni nombre, ni workspace, ni aceptación legal, ni contraseña que heredar—, y la activación (`/verify-email`) crea todo desde cero. Audita por separado la aceptación contractual y el aviso de privacidad mostrado. La contraseña se **valida** con el mismo contrato que la activación (feedback temprano en el formulario), pero no se guarda: sin propuesta en disco, `login` no puede distinguir el registro de una dirección desconocida y ninguna señal de «sigue pendiente / ya no» se filtra por el servidor. Un registro anónimo sobre una dirección ya inscrita no la sustituye (ni su fila, ni su bearer); todos los desenlaces contestan igual y emiten la cookie `REGISTRATION_EDIT_COOKIE`. |
| POST | `/login` | — | Login con `email`, `password` y `captchaToken`, sólo para cuentas con email verificado. Si MFA: `{ mfaRequired: true, challenge, recoveryAvailable }`; si no: `{ user }`. Una inscripción pendiente no es una cuenta: recibe el mismo `401` de «Credenciales incorrectas» que una dirección desconocida —mismo bcrypt de señuelo, sin sesión, sin reto MFA—, de modo que el servidor nunca responde «sigue pendiente / ya no». La guía al buzón es la entrada pública `/resend-verification`, siempre visible en el panel de acceso. |
| POST | `/change-registration-email` | cookie de edición | Corrige una dirección de registro no verificada con `{ currentEmail, newEmail, captchaToken }`. La autoridad es la cookie `REGISTRATION_EDIT_COOKIE` emitida por el `register` que creó esa inscripción (no la contraseña propuesta, que cualquier registro anónimo puede mintear); el secreto viaja sellado con cifrado autenticado —opaco: no revela la cuenta, la versión de seguridad ni el desenlace que lo emitió, así que un señuelo y un secreto real son indistinguibles— y queda ligado al registro pendiente y a su versión de seguridad, revalidados dentro del lock de la corrección y rotados con cada una, así que un secreto gastado no vuelve a servir. Invalida el bearer anterior, emite uno nuevo y no crea sesión. Sin el secreto, dirección desconocida y registro ya consumido contestan lo mismo: `403` genérico. |
| POST | `/mfa/verify` | — | Completa login MFA con `{ challenge, code }` → `{ user }`. El challenge dura cinco minutos, está ligado a la versión de seguridad y se consume una sola vez. |
| POST | `/mfa/recovery` | — | Completa el mismo challenge con `{ challenge, code }`; consume atómicamente el challenge y un recovery code de un solo uso. |
| POST | `/logout` | sesión | Revoca la sesión actual. |
| POST | `/verify-email` | — | `{ token, password, name, acceptTerms, termsVersion, privacyVersion }` → decide la identidad definitiva (nombre), registra la aceptación de las versiones legales vigentes con la fecha de ESTA activación, decide la contraseña definitiva de la cuenta y crea la cuenta desde cero: usuario verificado, workspace autogenerado con el nombre definitivo, cuota y membresía. Consume el bearer token y deja morir la inscripción entera —fila pendiente y todos sus bearers— en la misma transacción. Nada de lo que el registro anónimo propuso —nombre, workspace, evidencia contractual ni contraseña— llega a la cuenta: lo decide quien abre el buzón tras la prueba de posesión (anti pre-hijack). El acceso posterior exige un login nuevo. |
| POST | `/resend-verification` | — / sesión | Reenvía el correo de verificación con `{ email }` cuando no hay sesión: es la entrada diseñada para recuperar un registro pendiente, visible siempre en el panel de acceso (no depende de ninguna señal del servidor). La respuesta pública es genérica (anti-enumeración) y aplica cooldown de 60 s. |
| POST | `/forgot-password` | — | `{ email }` → envía enlace (respuesta idéntica siempre, anti-enumeración). |
| POST | `/reset-password` | — | `{ token, password }` → restablece y revoca sesiones; el token se consume atómicamente y solo puede funcionar una vez. |
| POST | `/account-recovery/complete` | — | `{ token, password, confirmation: "RECUPERAR MI CUENTA" }`; finaliza un expediente con dos aprobadores vigentes, rota credenciales, retira MFA y rol admin, y admite el aviso de incidente en el mismo commit. |
| GET | `/me` | sesión | `{ user }`. |
| GET | `/mfa/session` | sesión | `{ enabled, fresh, verifiedAt, expiresAt }`; sólo expone la frescura del factor de la sesión actual. |
| POST | `/mfa/reauthenticate` | sesión verificada | `{ password, factorCode }`; renueva la ventana administrativa con TOTP o recovery actual sin rotar la cookie. |
| PATCH | `/profile` | sesión | `{ name }`. |
| POST | `/change-password` | sesión | `{ current, newPassword, factorCode? }`; step-up si MFA está activo (ver «Verificación reforzada»), revoca las demás sesiones y avisa por email. |
| POST | `/change-email` | sesión verificada | `{ newEmail, password, factorCode? }`; step-up si MFA está activo, reserva el buzón una hora y envía confirmación sin cambiar todavía el acceso. |
| POST | `/change-email/cancel` | sesión verificada | `{ password, factorCode? }`; step-up si MFA está activo, cancela la reserva pendiente. |
| POST | `/confirm-email-change` | — | `{ token }`; confirma el nuevo buzón, cambia la identidad y cierra todas las sesiones. La SPA exige clic explícito. |
| GET | `/sessions` | sesión | `{ sessions[], truncated }`, hasta 100, incluyendo `current` para identificar el navegador actual. |
| POST | `/sessions/:id/revoke` | sesión | Revoca una sesión; si es la actual devuelve `current: true`, borra la cookie y el panel cierra sesión inmediatamente (también sincroniza otras pestañas). |
| POST | `/sessions/revoke-others` | sesión | Cierre masivo conservando la actual; `{ ok, revoked }` con el recuento real de filas cerradas (cero si no había otras) e idempotente. Si cierra sesiones, admite en la misma transacción el aviso de seguridad por email (enlace de incidente 24 h); sin aviso entregable no se cierra nada (`503`). |
| POST | `/sessions/revoke-all` | sesión | Cierre total incluida la actual; `{ ok, revoked }`, borra la cookie y la cuenta queda fuera en todos los dispositivos. Mismo aviso de seguridad atómico que `revoke-others`. |
| POST | `/mfa/setup` | sesión | `{ password, code? }` → `{ secret, uri }`; `code` es obligatorio al reconfigurar MFA activo y la configuración pendiente caduca a los diez minutos. |
| POST | `/mfa/enable` | sesión | `{ code }` → `{ recoveryCodes[] }`; los códigos sólo se entregan en esta respuesta y después se almacenan mediante hash. |
| POST | `/mfa/cancel-setup` | sesión | Invalida un secreto MFA pendiente que todavía no se ha activado. |
| POST | `/mfa/recovery-codes/regenerate` | sesión + MFA | `{ password, factorCode }`; invalida el juego anterior, entrega `recoveryCodes[]` nuevos una sola vez y revoca otras sesiones. |
| POST | `/mfa/disable` | sesión | `{ password, code }`; exige contraseña y TOTP o recovery actual (step-up con ventana fresca). |
| GET | `/data-export` | sesión verificada | Estado de la solicitud de exportación más reciente, con `stage` (`collecting\|analytics\|encoding\|encrypting\|finalizing`) mientras se genera y `failureReason` (`automated_size_limit`, `generation_error`, `stalled`) cuando falló. |
| GET | `/data-export/history` | sesión verificada | `{ exports[] }`, las últimas diez exportaciones con la misma forma que `/data-export` (`stage` sólo en las vivas). Sólo estado y fechas: sin rutas de artefacto ni generaciones de correo. |
| POST | `/data-export` | sesión + step-up | `{ password, factorCode? }`; tras el step-up encola el job directamente y devuelve `processing`. El email posterior sólo anuncia que el archivo está listo, no autoriza nada. |
| POST | `/data-export/download` | sesión + step-up | `{ password, factorCode? }`; sirve el artefacto cifrado por bloques descifrando al vuelo (`streaming`, `no-store`) a la sesión que acaba de demostrar contraseña y segundo factor. Contenido según [`data-export-matrix.md`](data-export-matrix.md): incluye expedientes/mensajes RGPD propios, sin secretos ni identificadores internos del personal. Una transferencia interrumpida se puede reintentar con un step-up nuevo mientras no caduque; el artefacto caduca a los 2 días de estar listo. |
| POST | `/data-export/download/acknowledge` | sesión verificada | Sin cuerpo; exige que el servidor haya preparado antes una descarga válida y el navegador lo invoca sólo después de recibir el cuerpo completo. Entonces marca `downloaded` y purga el artefacto. Es lo único que consume la exportación y no afirma que el usuario haya abierto o guardado el fichero. |
| POST | `/data-export/cancel` | sesión verificada | Cancela solicitud/worker/artefacto activo. |
| GET | `/account-deletion` | sesión verificada | Impacto y bloqueos: admin, workspaces propios y confirmación pendiente. |
| POST | `/account-deletion` | sesión verificada | `{ confirmation: "ELIMINAR MI CUENTA", password, factorCode? }`; envía doble confirmación. |
| POST | `/account-deletion/confirm` | — | `{ token }`; cierra acceso y programa anonimización a siete días. |
| POST | `/account-deletion/cancel` | — | `{ token }`; restaura el acceso durante el periodo de gracia, sin restaurar tokens revocados. |
| GET | `/notifications` | sesión verificada | `{ notifications[], unread, nextCursor }`: página de 20, de más reciente a más antigua, paginada por cursor (`?before=<id>`). Cada fila trae `id`, `kind` del catálogo cerrado, `subject` (nombre visible capturado en el momento del evento), `workspaceId`, `route` (ruta interna del panel), `createdAt` y `readAt`. Sin secretos, URLs bearer ni contenido de correo. |
| GET | `/notifications/unread` | sesión verificada | `{ unread }`; sólo el contador, para la campana del panel. |
| POST | `/notifications/:id/read` | sesión verificada | Marca una notificación propia como leída y devuelve `{ unread }`. Una notificación ajena no existe (`404`). |
| POST | `/notifications/read-all` | sesión verificada | Marca la bandeja entera como leída → `{ unread: 0 }`. |
| GET | `/notifications/preferences` | sesión verificada | `{ preferences[] }` con el catálogo completo: `kind`, `category` (`mandatory|operational`) y la entrega efectiva (`immediate|daily_digest|in_app_only|disabled`). |
| PATCH | `/notifications/preferences` | sesión verificada | `{ preferences: [{ kind, delivery }] }`; valida el lote entero antes de escribir nada, registra el cambio en auditoría y rechaza (`422`) cualquier modificación de un kind obligatorio: los avisos críticos de credenciales, MFA, email, exportación o eliminación de cuenta llegan siempre. |

La exportación es una **copia de acceso a la cuenta** de autogestión (art. 15
RGPD): el propio documento lo declara en `rights.document:
"account_access_copy"`. El ejercicio formal de los derechos de acceso y
portabilidad (art. 15 y 20 RGPD) va por el flujo de expedientes de privacidad,
con verificación de identidad proporcional y plazo legal; el límite del proceso
automático (`automated_size_limit`) deriva ahí, no a soporte. El techo operativo
de 256 MiB de texto plano protege al worker y no es un límite del producto.

El centro de notificaciones separa los **avisos obligatorios** —seguridad y
respuestas a solicitudes propias: credenciales, MFA, email, exportación,
eliminación de cuenta y privacidad— de los **operativos**, configurables por
cuenta: `immediate` (bandeja y email al momento), `daily_digest` (bandeja ya;
email en el resumen diario), `in_app_only` («Solo UVH», sólo bandeja) o
`disabled` (nada). El resumen diario (`uvh:notifications-digest`, programado a
las 08:00) manda cada aviso una sola vez; cambiar de preferencia retira del
resumen lo pendiente del kind y todo cambio queda auditado.

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

### Verificación reforzada (step-up)

Toda operación que pide contraseña y un factor (`factorCode`, o `code` en
`/mfa/disable`) —tokens API, purga, transferencia/eliminación de workspace,
cambio y cancelación de email, cambio de contraseña, desactivación de MFA,
exportación y eliminación de cuenta, regeneración de recovery codes y
reautenticación— aplica el mismo contrato:

- **Presupuesto por cuenta y operación**: 10 fallos de verificación cada 15
  minutos, contados por cuenta —no por sesión— e incluyendo fallos de
  contraseña. Rotar de sesión no lo renueva. Tokens, purga, transferencia y
  eliminación de workspace y regeneración de recovery codes comparten un mismo
  presupuesto; cambio de email (incluida su cancelación), cambio de contraseña,
  desactivación de MFA, exportación, eliminación de cuenta y reautenticación
  tienen el suyo propio, y el login MFA el suyo, de modo que los fallos de una
  operación nunca bloquean el acceso a la cuenta. Agotado → `429` con `Retry-After` y
  `{ "error": "Demasiados intentos. Espera unos minutos.",
  "retryAfterSeconds": n }`. Un éxito restaura el presupuesto completo.
- **Ventana fresca**: exige que `mfa_verified_at` sea reciente
  (`ADMIN_MFA_FRESH_MINUTES`, 15 minutos por defecto). Si caducó → `403` con
  `details.reason = "mfa_reauthentication_required"` y el factor no se consume;
  el remedio es `POST /mfa/reauthenticate` (único paso que no exige ventana).
  Un step-up exitoso renueva la ventana.
- El factor se verifica con antirreplay por contador (TOTP) y los recovery
  codes son de un solo uso salvo que la operación reemplace el juego completo.

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
| POST | `/claim` | sesión verificada | `{ intent }` → `{ destination, expiresAt }`. La primera reclamación vincula la intención al usuario; el índice de revocación no guarda destino ni bearer y limita a 100 pendientes por cuenta. Sin `intent` en el cuerpo se lee la cookie del aparcadero (ver más abajo). |
| POST | `/complete` | sesión verificada | `{ intent }` → `{ ok: true }`. Invalida la intención después de crear o descartar el enlace. Sin `intent` en el cuerpo se lee la cookie del aparcadero, y una respuesta terminal la retira. |

## Aparcadero de credenciales — `/api/v1/pending`

El panel **no guarda ningún bearer en `localStorage`**. Un enlace de invitación
vive 7 días y un link intent 1 día; sostenerlos en almacenamiento legible por
script los expone a cualquier JavaScript del origen. En su lugar el navegador los
entrega una vez y recibe una cookie `HttpOnly` firmada por el servidor
(`PendingHandoff`), y a partir de ahí sólo pregunta si hay una aparcada.

| Método | Ruta | Auth | Descripción |
| ------ | ---- | ---- | ----------- |
| POST | `/pending/invitation`<br>`/pending/link-intent` | — | `{ token, expiresAt? }` → `201 { pending: true, expiresAt }` y cookie del aparcadero. `422` si el token no tiene la forma que emite la aplicación o si la caducidad anunciada ya pasó. |
| GET | `/pending` | — | `{ invitation: { pending, expiresAt }, linkIntent: { pending, expiresAt } }`. Sólo un booleano y una fecha: nunca el bearer. |
| DELETE | `/pending/invitation`<br>`/pending/link-intent` | — | `{ pending: false }` y cookie borrada. |

Propiedades del aparcadero, todas medidas por `PendingHandoffTest`:

- **Forma, no existencia.** El aparcado nunca consulta la base de datos ni
  pregunta si el bearer existe: un `404` para una invitación real y un `201` para
  una inventada convertirían un endpoint público en un oráculo. El mismo `201`
  para un token vivo, gastado o inventado.
- **El cliente acorta, nunca alarga.** `expiresAt` sólo puede reducir el techo del
  servidor (7 días para la invitación, 24 h para el intent); un valor imposible o
  malformado cae al techo, y uno ya pasado responde `422` sin aparcar nada.
- **La firma cubre el tipo.** Copiar la cookie de invitación al nombre de la de
  intent no produce nada utilizable.
- **Host-only.** Sin atributo `Domain`, igual que la sesión: la cookie pertenece al
  origen que la va a consumir.
- **Un final terminal desaparca.** Aceptar, rechazar, reclamar o completar deja el
  aparcadero limpio; un fallo transitorio (`503`, `429`) lo deja intacto para que
  un reintento siga siendo posible. Un bearer del cuerpo nunca toca la cookie.

Sólo se activa el limitador de volumen `uvh-pending` (escritura) y
`uvh-pending-read` (lectura); ver `docs/configuration.md`.

## Enlaces — `/api/v1/links` (workspace)

| Método | Ruta | Rol | Descripción |
| ------ | ---- | --- | ----------- |
| GET | `/` | viewer | Listado con `q, state, tag, sort, page, perPage` → `{ links, total, page, perPage }`. |
| POST | `/` | editor | Crear enlace (destino, alias, dominio, colección, UTM, notas, programación, expiración, contraseña, máx. clics, uso único, fallback, reglas, tags). Toda clave ajena a ese contrato —incluido `state` y `version`— → `422` nombrándola. |
| POST | `/check-alias` | viewer | `{ alias, domainId }` → `{ available, reason? }`. |
| GET | `/export.csv` | viewer | Export del workspace en CSV (BOM UTF-8, celdas anti-fórmulas). Máx. 5.000 enlaces: más allá → `409` con el total. Columnas: `id, alias, domain, destination, fallback_destination, state, click_count, max_clicks, single_use, scheduled_at, expires_at, notes, tags` (separadas por `;`), `created_at`. Auditoría `link.export`. |
| POST | `/import` | editor | `{ dryRun, csv }` (texto, máx. 256 KiB / 500 filas). Columnas permitidas: `alias, destination, fallback_destination, notes, tags` (`;`), `scheduled_at, expires_at, max_clicks, single_use`; una desconocida → `422` nombrándola. `dryRun: true` no escribe nada y devuelve el mismo informe `{ dryRun, valid, created, errors[{row, error}], truncated }` (máx. 100 errores reportados). La importación real exige cabecera `Idempotency-Key`: un reintento reproduce la respuesta original sin duplicar enlaces. Cada fila se valida con las reglas de creación; una fila inválida se reporta sin frenar al resto. |
| POST | `/bulk` | editor | Acciones masivas (máx. 100 enlaces) sobre la selección entera o ninguna: `{ action, linkIds[], tags? , collectionId? }` con `action` ∈ pause/activate/archive/trash/restore/tag/untag/move → `{ ok, action, applied }`. Exige cabecera `Idempotency-Key` (scope `links.bulk`): la respuesta se sella en la misma transacción que el efecto y una repetición responde con `Idempotent-Replay: true` sin volver a aplicar. `404` si algún id no es del workspace, `403` sobre enlaces bloqueados, `409` al activar un enlace programado o caducado, `429` si la cuota no admite la restauración. |
| GET | `/:id` | viewer | `{ link, rules[], appeal, blockReason }`; `appeal` es `null` o `{ status, createdAt, decidedAt, decisionNote }` de la última apelación —la nota de la decisión es del propietario, que es quien la sufre— y `blockReason` es `null` o el motivo del bloqueo vigente, tomado de la decisión que lo produjo. |
| PATCH | `/:id` | editor | Editar enlace (`version` obligatoria). Claves admitidas: `destination`, `alias`, `domainId`, `collectionId`, `fallbackDestination`, `password`, `maxClicks`, `singleUse`, `scheduledAt`, `expiresAt`, `notes`, `utm`, `tags`, `rules`, `version`; cualquier otra → `422` nombrándola. `collectionId` sigue semántica PATCH: omitido conserva la colección, `null` explícito desagrupa. `alias` no se puede vaciar (`""`/`null` → `422`); omitirlo conserva el actual. `state` no se acepta aquí: se cambia con `POST /:id/state`. |
| POST | `/:id/state` | editor | `{ state }` (active/paused/archived). |
| DELETE | `/:id` | editor | Soft delete. |
| POST | `/:id/restore` | editor | Restaura. |
| POST | `/:id/appeal` | editor | `{ message? }` → `{ ok, appealId }`. Solo si el enlace está bloqueado y una sola apelación abierta por enlace (`409` si ya existe, `409` si no está bloqueado). Rate limit por sesión e IP. |
| GET | `/:id/activity` | viewer | `{ events[] }` (auditoría del enlace). |

## Etiquetas — `/api/v1/tags` (workspace)

| Método | Ruta | Rol | Descripción |
| ------ | ---- | --- | ----------- |
| GET | `/` | viewer | `{ tags[] }` con `{ id, name, links }`; `links` cuenta sólo enlaces vivos. |
| POST | `/:id/rename` | editor | `{ name }` → `{ ok, id, name }`. `409` si el nombre (sin distinguir mayúsculas) ya existe en el workspace. |
| POST | `/merge` | editor | `{ sourceIds[], targetId }` (máx. 50 orígenes) → `{ ok, id, name, moved }`. Las adhesiones se mueven sin duplicar las que ya tenían ambas etiquetas y las de origen se borran: un enlace nunca pierde ni gana grupos por una fusión. |

## Colecciones — `/api/v1/collections` (workspace)

Agrupación plana de un solo nivel; los nombres son únicos por workspace sin distinguir mayúsculas.

| Método | Ruta | Rol | Descripción |
| ------ | ---- | --- | ----------- |
| GET | `/` | viewer | `{ collections[] }` con `{ id, name, links }` (enlaces vivos). |
| POST | `/` | editor | `{ name }` (1–60) → `201 { collection }`. `409` si el nombre está tomado. |
| PATCH | `/:id` | editor | `{ name }` → `{ ok, id, name }`. |
| DELETE | `/:id` | editor | Borra la colección **sin tocar enlaces**: quedan sin agrupar (`collection_id` a `NULL`) → `{ ok, moved }`. |

## Plantillas de enlace — `/api/v1/link-templates` (workspace)

Valores por defecto con los que empezar un enlace. El `payload` sólo contiene campos del contrato de creación (`destination`, `fallback_destination`, `notes`, `tags`, `utm`, `max_clicks`, `single_use`, `scheduled_at`, `expires_at`, `collection_id`) y **nunca un alias**; se valida con las mismas reglas que un enlace real al guardar la plantilla.

| Método | Ruta | Rol | Descripción |
| ------ | ---- | --- | ----------- |
| GET | `/` | viewer | `{ templates[] }` con `{ id, name, payload, createdAt }`. |
| POST | `/` | editor | `{ name, payload }` → `201 { template }`. Un campo desconocido o un alias en el payload → `422` nombrándolo; nombre tomado (sin distinguir mayúsculas) → `409`. |
| DELETE | `/:id` | editor | `{ ok }`. |

## Analítica — `/api/v1/analytics`

| Método | Ruta | Auth | Descripción |
| ------ | ---- | ---- | ----------- |
| GET | `/overview` | sesión + workspace viewer | `period` (`24h`,`7d`,`30d`,`90d`,`custom`), `linkId?` → resumen + series + topLinks + desgloses. `custom` exige `from` y `to`; una `to` sin hora cubre el día completo («hasta el 30» incluye el 30) y el rango queda limitado a 180 días. |
| GET | `/export` | sesión + workspace viewer | Mismos parámetros que `/overview` + `format` (`csv`\|`json`). Descarga (`Content-Disposition: attachment`, `Cache-Control: no-store`) del mismo resumen. El contrato de privacidad es el punto: **sólo agregados**, nunca un hash de visitante (el CSV lleva `section, key, day, clicks, visitors`); el JSON declara `visitorMetric: daily_pseudonyms` en vez de sugerir identificación de personas. |
| GET | `/public/overview` | API token `analytics:read` | Igual que arriba para integraciones. |

## Workspaces — `/api/v1/workspaces`

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| GET | `/` | `{ workspaces[] }` del usuario. |
| POST | `/` | Crear workspace. |
| GET | `/:id` | `memberPage`, `memberPerPage`, `invitationPage`, `invitationPerPage` → `{ workspace, members[], membersPage, invitations[], invitationsPage }`; cada `perPage` admite hasta 100. Invitaciones sólo se exponen desde rol `admin`. |
| GET | `/:id/members` | Búsqueda remota de miembros para el selector de transferencia de propiedad: `q` (nombre o email, comodines escapados) y `perPage` (1–25, 10 por defecto) → `{ members[], total }`. Cubre todos los miembros del workspace, no sólo la página cargada en Equipo. Cualquier miembro puede consultarla. |
| PATCH | `/:id` | Renombrar (admin/owner). |
| PATCH | `/:id/members/:userId` | Cambiar rol (admin/owner). |
| POST | `/:id/transfer-ownership` | Owner + step-up `{ targetUserId, password, factorCode? }`; el owner anterior pasa a admin. |
| DELETE | `/:id/members/:userId` | Eliminar miembro. |
| POST | `/:id/leave` | Abandonar (no owner). |
| DELETE | `/:id` | Eliminar (owner) con body `{ confirmation, password, factorCode? }`; `confirmation` debe coincidir exactamente con el nombre. |
| POST | `/:id/invitations` | Invitar `{ email, role }`. |
| POST | `/invitations/accept` | Aceptar invitación. El bearer llega en el cuerpo (`{ token }`) **o**, si el cuerpo no trae ninguno, en la cookie del aparcadero: es lo que envía el panel. Una aceptación terminal la borra. |
| POST | `/invitations/reject` | Rechazar invitación. Mismas dos fuentes de bearer que `accept`. |
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

PATCH `/:id/getting-started` con `{ hidden }` (booleano obligatorio; `422` si
falta) guarda sólo el estado de presentación de la guía en la membresía que
llama (`memberships.onboarding_dismissed_at`), con lo que sigue a la cuenta en
cualquier dispositivo. Devuelve `{ ok, dismissedAt }`; sin membresía: `403`.
No guarda hechos, progreso ni visitas: ocultar la guía no cambia nada medible.

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

Cuando una comprobación **pedida por una persona** (`verify` o `revalidate`)
confirma a la vez propiedad y ruta, y el dominio no estaba deshabilitado ni
tiene certificado previo, la propia comprobación admite la emisión TLS
(`state: provisioning`) sin esperar a `activate`. El barrido periódico nunca
inicia ACME por su cuenta; sólo las comprobaciones con actor disparan ese paso.

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
| GET | `/users` | `q`, `status`, `page`, `perPage` → `{ users[], total, page, perPage }`. Estados: `active`, `blocked`, `admin`, `mfa`. Sin `unverified`: una fila de usuario está verificada por definición y el registro sin verificar vive en `/pending-registrations`. |
| PATCH | `/users/:id` | `{ isAdmin?, blocked? }`. |
| GET | `/pending-registrations` | `q`, `page`, `perPage` → `{ registrations[], total, page, perPage }`. Registros que aún no han demostrado su buzón: `email`, `created_at`, `last_mail_at` (último correo de verificación emitido) y `link_expires_at` (caducidad de su enlace). Sin propuestas de contraseña ni bearers; sólo esta consola admin-gated lista estas direcciones. |
| GET | `/reports` | `q`, `status`, `page`, `perPage` → `{ reports[], total, page, perPage }`. |
| PATCH | `/reports/:id` | `{ status }`. |
| POST | `/reports/:id/moderate` | `{ action, reason? }`, con `action=block|unblock|review|dismiss`. Actualiza denuncia y enlace en una única transacción. |
| GET | `/domains` | `q`, `state`, `page`, `perPage` → `{ domains[], total, page, perPage }`; nunca devuelve el token DNS. |
| GET | `/audit` | `q`, `action`, `resourceType`, `page`, `perPage` → `{ events[], total, page, perPage }`. |
| GET | `/operations` | Estado no sensible de entorno, cola, trabajos fallidos, webhooks, sesiones y dominios. No sustituye al sistema externo de monitorización. |
| POST | `/links/:id/block` | `{ reason }` → bloquea. |
| POST | `/links/:id/unblock` | Desbloquea. |
| POST | `/links/:id/block-destination` | `{ reason, scope }`, con `scope=url|host` → bloquea el **destino** del enlace (no solo el enlace), lo añade a la denylist y reanaliza los enlaces que ya apuntaban a ese host. |
| GET | `/destinations` | `q`, `page`, `perPage` → `{ entries[], total, page, perPage }`. Las entradas `url` se devuelven como hash, nunca en claro. |
| DELETE | `/destinations/:id` | Retira una entrada de la denylist. |
| GET | `/appeals` | `status` (`open|upheld|restored`), `page`, `perPage` → `{ appeals[], total, page, perPage }`. |
| POST | `/appeals/:id/decision` | `{ decision: "restore"|"uphold", note? }` → `{ ok, state, removedEntries }`. Restaurar devuelve el enlace a su estado natural y retira las entradas de denylist que aplicaban a sus destinos. |

## Denuncias / público — `/api/v1`

| Método | Ruta | Descripción |
| ------ | ---- | ----------- |
| POST | `/report` | `{ reportedUrl, reason, details?, email? }` (público, CSRF y rate limit). `reportedUrl` admite alias, URL de `uvh.es`, ruta legacy `/r/:alias` o un dominio personalizado registrado; la API sólo resuelve la referencia en base de datos y nunca visita el destino. `alias` se mantiene como compatibilidad interna, pero no se aceptan identificadores numéricos globales. |
| GET | `/status` | Estado del módulo antiabuso. `externalAnalysis` separa `configured` (¿hay URL?), `enabled` (¿hay adaptador?) y `operational` (¿ha respondido un veredicto utilizable recientemente?); `status` vale `not_configured`, `not_verified` u `operational`, de modo que nunca presenta configuración como análisis ejecutado. Incluye `denylistEntries` (un recuento; nunca las entradas). Contrato de reputación: `docs/url-reputation-runbook.md`. |

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
| POST | `/r/:alias/unlock` | `{ password }` para enlaces protegidos. Con `Accept: application/json`: `{ ok: true }` 200 y la cookie de desbloqueo, o el sobre `{ error }` con 403/404/422/429 sin cambios. Con `Accept: text/html` el formulario se sirve y contesta como página en todos sus estados —contraseña incorrecta (403), contraseña fuera de rango (422), enlace inexistente (404) y límite de intentos agotado (429)—, y el acierto responde **200** con una pantalla que continúa al enlace: un `302` no sirve ahí porque `form-action 'self'` se comprueba en cada salto de la cadena de un envío de formulario y el destino está en otro origen, así que el navegador rechazaba el salto final y dejaba al visitante en la puerta. El presupuesto de intentos es **por enlace**: la clave normaliza el alias (`/r/ADV-X/unlock` y `/r/adv-x/unlock` comparten límite). El documento vive en `app/Support/VisitorPage.php`. |
