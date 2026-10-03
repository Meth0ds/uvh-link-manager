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

### Cuenta esperada en peticiones del navegador

La SPA adjunta `X-Uvh-Account-Id` a las rutas de sesión cuando ya muestra una
cuenta. Laravel compara ese ID decimal positivo con el usuario autenticado por
la cookie **antes de entrar en el controller**. Si difieren, devuelve
`409 { error, reason: "session_context_changed" }`, sin incluir IDs ni revocar o
reemplazar la cookie; un valor mal formado devuelve `400` con
`reason: "invalid_account_context"`. El header jamás autentica ni elige al actor,
y no sustituye CSRF, roles, verificación de email ni revalidación bajo lock.
Su ausencia conserva la compatibilidad con clientes existentes.

Ante ese conflicto exacto la SPA descarta únicamente su proyección local,
workspaces y operaciones obsoletas y vuelve al acceso; no repite la mutación,
no envía un logout y no anuncia una revocación a otras pestañas. También aplica
a errores JSON recibidos como Blob en una descarga privada. Otros `409`
conservan su tratamiento propio. Login, registro y acciones públicas con
bearers de email/recuperación, así como la API de integración con Authorization,
conservan su autoridad específica y no dependen de esta expectativa.

Logout admite el cliente anónimo y sigue siendo idempotente. Con una sesión
vigente comprueba la expectativa antes de revocar; sin header conserva el
contrato anterior. Esta precondición evita una intención enviada con la cookie
de otra cuenta; no puede retirar una mutación o un Set-Cookie ya despachados.

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
| POST | `/register` | — | Registro multistep con name/email/password/CAPTCHA/consentimientos. Nombre y contraseña se validan, pero no se guardan. Siempre crea un intento propio del navegador, con caducidad y generación, y responde `201 { user: null }` con cookie de edición opaca v4. Si la dirección está libre, crea además pending y bearer de verificación; si está ocupada o reservada, no modifica al ocupante y la admisión huérfana se suprime. Cuenta, credencial, workspace y aceptación legal sólo nacen tras probar el buzón. |
| POST | `/login` | — | Requiere email/password/CAPTCHA. Una contraseña correcta conserva el acceso verificado con o sin MFA; una cuenta heredada sin verificar recibe `403 reason: email_verification_required`. Ante contraseña incorrecta o cuenta ausente, un contexto propio vigente para esa dirección recibe `403 reason: pending_registration` para revisar la solicitud, independientemente de la ocupación del email. Este reason histórico no afirma que exista una cuenta o pending. Sin contexto válido, `401` genérico. Nunca concede sesión/reto por una cookie de registro. |
| POST | `/change-registration-email` | cookie de edición | `{ currentEmail, newEmail, captchaToken }` corrige la dirección elegida en el intento propio. Revalida cookie/generación/dirección/caducidad contra contexto bloqueado y responde `200 { ok: true }` con nueva cookie v4 en todos los destinos. Cada ACK gasta la generación anterior, incluso si el destino está ocupado. Sólo mueve el pending asociado a ese intento o crea uno nuevo si está libre; nunca altera User ni pending ajeno. En un conflicto conserva el bearer del pending propio y su dirección real, pero el contexto adopta la dirección solicitada para permitir otra corrección privada. Sin autoridad vigente o con currentEmail ajeno al contexto, `403` genérico. No crea sesión. |
| POST | `/mfa/verify` | — | Completa login MFA con `{ challenge, code }` → `{ user }`. El challenge dura cinco minutos, está ligado a la versión de seguridad y se consume una sola vez. |
| POST | `/mfa/recovery` | — | Completa el mismo challenge con `{ challenge, code }`; consume atómicamente el challenge y un recovery code de un solo uso. |
| POST | `/logout` | sesión | Revoca la sesión actual. |
| POST | `/verify-email` | — | `{ token, password, name, acceptTerms, termsVersion, privacyVersion }` → decide la identidad definitiva (nombre), registra la aceptación de las versiones legales vigentes con la fecha de ESTA activación, decide la contraseña definitiva de la cuenta y crea la cuenta desde cero: usuario verificado, workspace autogenerado con el nombre definitivo, cuota y membresía. Consume el bearer token y deja morir la inscripción entera —fila pendiente y todos sus bearers— en la misma transacción. Nada de lo que el registro anónimo propuso —nombre, workspace, evidencia contractual ni contraseña— llega a la cuenta: lo decide quien abre el buzón tras la prueba de posesión (anti pre-hijack). El acceso posterior exige un login nuevo. |
| POST | `/resend-verification` | — / sesión | Reenvío público con email/CAPTCHA desde la pantalla de verificación o la pestaña de registro. Respuesta genérica `200 { ok: true }` para conocido, desconocido, consumido, cooldown o fallo de admisión de mail; cooldown60s y floor temporal común. Sólo el destinatario elegible recibe correo. Un caller autenticado ya verificado conserva400. No deriva autoridad del contexto de registro. |
| POST | `/forgot-password` | — | `{ email }` → envía enlace (respuesta idéntica siempre, anti-enumeración). |
| POST | `/reset-password` | — | `{ token, password }` → `{ ok: true, current: boolean }`. Restablece y revoca sesiones del dueño; el token debe vencer después de `now`, se consume atómicamente y sólo funciona una vez. Sólo borra cookie/reconcilia identidad del navegador si `current` es true. |
| POST | `/account-recovery/complete` | — | `{ token, password, confirmation: "RECUPERAR MI CUENTA" }`; finaliza un expediente con dos aprobadores vigentes, rota credenciales, retira MFA y rol admin, y admite el aviso en el mismo commit. Responde `{ ok: true, message, current }`; sólo borra la cookie de la cuenta recuperada. |
| POST | `/security-incident/revoke` | bearer de emergencia | `{ token }` → `{ ok: true, message, current: boolean }`. Requiere bearer `security_revoke` sin consumir y con `expires_at > now`. Revoca accesos y operaciones pendientes del dueño; sólo borra la cookie y reconcilia la identidad del navegador si `current` es true. No autentica, cambia el email, desactiva MFA ni levanta un bloqueo administrativo. |
| GET | `/me` | sesión | `{ user }`. |
| GET | `/mfa/session` | sesión | `{ enabled, fresh, verifiedAt, expiresAt }`; sólo expone la frescura del factor de la sesión actual. |
| POST | `/mfa/reauthenticate` | sesión verificada | `{ password, factorCode }`; renueva la ventana administrativa con TOTP o recovery actual sin rotar la cookie. |
| PATCH | `/profile` | sesión | `{ name }`. |
| POST | `/change-password` | sesión | `{ current, newPassword, factorCode? }`; step-up si MFA está activo (ver «Verificación reforzada»), revoca las demás sesiones y avisa por email. |
| POST | `/change-email` | sesión verificada | `{ newEmail, password, factorCode? }`; step-up si MFA está activo, reserva el buzón una hora y envía confirmación sin cambiar todavía el acceso. |
| POST | `/change-email/cancel` | sesión verificada | `{ password, factorCode? }`; step-up si MFA está activo, cancela la reserva pendiente. |
| POST | `/confirm-email-change` | — | `{ token }` → `{ ok: true, current: boolean }`; confirma el nuevo buzón, cambia la identidad y cierra las sesiones del dueño. Requiere caducidad exclusiva. La SPA exige clic explícito y sólo reconcilia la sesión afectada; otra cuenta abierta conserva su cookie. |
| GET | `/sessions` | sesión | `{ sessions[], truncated }`, hasta 100, incluyendo `current` para identificar el navegador actual. |
| POST | `/sessions/:id/revoke` | sesión | Revoca una sesión; si es la actual devuelve `current: true`, borra la cookie y el panel cierra sesión inmediatamente (también sincroniza otras pestañas). |
| POST | `/sessions/revoke-others` | sesión | Cierre masivo conservando la actual; `{ ok, revoked }` con el recuento real de filas cerradas (cero si no había otras) e idempotente. Si cierra sesiones, admite en la misma transacción el aviso de seguridad por email (enlace de incidente 24 h); sin aviso entregable no se cierra nada (`503`). |
| POST | `/sessions/revoke-all` | sesión | Cierre total incluida la actual; `{ ok, revoked }`, borra la cookie y la cuenta queda fuera en todos los dispositivos. Mismo aviso de seguridad atómico que `revoke-others`. |
| POST | `/mfa/setup` | sesión vigente + email verificado bajo lock | `{ password, code? }` → `{ secret, uri }`; con MFA activo exige factor actual y ventana fresca. Preparación con límite por cuenta; pendiente válido durante diez minutos, hasta su fecha de caducidad exclusiva. |
| POST | `/mfa/enable` | sesión vigente + email verificado bajo lock | `{ code }` → `{ recoveryCodes[] }`; exige pendiente no caducado, TOTP no consumido y presupuesto por cuenta disponible. Códigos nuevos sólo en esta respuesta; se almacenan como hash. |
| POST | `/mfa/cancel-setup` | sesión vigente + email verificado bajo lock | Invalida sólo el secreto pendiente; devuelve `{ ok: true }`. |
| POST | `/mfa/recovery-codes/regenerate` | sesión vigente + email verificado + MFA | `{ password, factorCode }`; invalida el juego anterior, entrega `recoveryCodes[]` nuevos una sola vez y revoca otras sesiones. |
| POST | `/mfa/disable` | sesión vigente + email verificado bajo lock | `{ password, code }`; contraseña y TOTP o recovery actual con ventana fresca; devuelve `{ ok: true }`. Rol de administrador de plataforma debe retirarse antes. |
| GET | `/data-export` | sesión verificada | Estado de la solicitud de exportación más reciente, con `stage` (`collecting\|analytics\|encoding\|encrypting\|finalizing`) mientras se genera y `failureReason` (`automated_size_limit`, `generation_error`, `stalled`) cuando falló. |
| GET | `/data-export/history` | sesión verificada | `{ exports[] }`, las últimas diez exportaciones con la misma forma que `/data-export` (`stage` sólo en las vivas). Sólo estado y fechas: sin rutas de artefacto ni generaciones de correo. |
| POST | `/data-export` | sesión + step-up | `{ password, factorCode? }`; tras el step-up encola el job directamente y devuelve `processing`. El email posterior sólo anuncia que el archivo está listo, no autoriza nada. |
| POST | `/data-export/download` | sesión + step-up | `{ password, factorCode? }`; sirve el artefacto cifrado por bloques descifrando al vuelo (`streaming`, `no-store`) a la sesión que acaba de demostrar contraseña y segundo factor. Contenido según [`data-export-matrix.md`](data-export-matrix.md): incluye expedientes/mensajes RGPD propios, sin secretos ni identificadores internos del personal. Una transferencia interrumpida se puede reintentar con un step-up nuevo mientras no caduque; el artefacto caduca a los 2 días de estar listo. |
| POST | `/data-export/download/acknowledge` | sesión verificada | Sin cuerpo; exige que el servidor haya preparado antes una descarga válida y el navegador lo invoca sólo después de recibir el cuerpo completo. Entonces marca `downloaded` y purga el artefacto. Es lo único que consume la exportación y no afirma que el usuario haya abierto o guardado el fichero. La confirmación está ligada a **la sesión que realizó la descarga**: el servidor guarda qué sesión sirvió el artefacto y cualquier otra recibe `409` («Confirma la descarga desde la sesión que la realizó»); por compatibilidad, una descarga servida sin registro de sesión aún se puede confirmar dentro de la ventana de 48 h. |
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
| PATCH | `/notifications/preferences` | sesión verificada | `{ preferences: [{ kind, delivery }] }`; exige kinds únicos (`422` ante duplicados), valida el lote entero antes de escribir nada, registra el cambio en auditoría y rechaza (`422`) cualquier modificación de un kind obligatorio: los avisos críticos de credenciales, MFA, email, exportación o eliminación de cuenta llegan siempre. |

Las seis rutas de notificaciones revalidan cuenta/sesión activa, ownership,
generación, caducidad exclusiva y email verificado al iniciar el trabajo. Si el
contexto cambia después del middleware, los GET responden `401` sin datos y
los commands `409`, sin retirar la cookie ni aplicar cambios. Las escrituras
adquieren locks dentro del mismo commit; preferencias, sellado del resumen y
evento exacto de auditoría son atómicos. Si no se admite ese evento, falla la
operación y se conserva el estado; una caída sólo del historial mantiene éxito
y evidencia recuperable. No requieren step-up.

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

Si la cuenta cambia entre el preflight y la admisión bajo lock (generación,
bloqueo, verificación o MFA), TOTP y recovery responden `401` con «Sesión MFA
caducada». No conceden sesión ni gastan el presupuesto de factores fallidos.
Un factor realmente incorrecto sí consume un intento del propósito y otro del
presupuesto global; estos cambios de identidad no se registran como
`auth.mfa_failed`.

Cambio/reset de contraseña y finalización de recuperación guardan su aviso de
incidente junto con las credenciales. Un fallo de admisión del outbox devuelve
`503` y revierte la operación, incluido el consumo de bearers/recovery codes
persistidos; el reintento exige que sigan vigentes. Un TOTP consumido en caché
mantiene su marca antirreplay incluso si SQL revierte: usar el siguiente código.
Un `200` no acredita recepción del email; el proveedor se invoca posteriormente.

El control de emergencia se ejecuta tras una acción explícita. Una respuesta
inválida nunca acredita éxito. El navegador permite reintentos manuales tras
fallos de conexión, `429` o errores `5xx`; un bearer consumido o caducado devuelve
`400` y ofrece recuperación. La revocación guarda en su propia transacción una constancia mínima de auditoría.
Si falla admitir el evento en el outbox general, conserva esa constancia sin
restaurar accesos; housekeeping reintenta hasta admitirlo. Si sólo falla el
historial, el evento queda en el outbox. La constancia conserva hora e identidad
originales, sin guardar el bearer, y se elimina junto con la admisión del evento.
Una cuenta administrativamente bloqueada sigue bloqueada.

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
`/mfa/disable` y la reconfiguración `/mfa/setup`) —tokens API, purga, transferencia/eliminación de workspace,
cambio y cancelación de email, cambio de contraseña, desactivación de MFA,
exportación y eliminación de cuenta, regeneración de recovery codes y
reautenticación y preparación de un factor— aplica el mismo contrato:

- **Presupuesto por cuenta y operación**: 10 fallos de verificación cada 15
  minutos, contados por cuenta —no por sesión— e incluyendo fallos de
  contraseña. Rotar de sesión no lo renueva. Tokens, purga, transferencia y
  eliminación de workspace y regeneración de recovery codes comparten un mismo
  presupuesto; cambio de email (incluida su cancelación), cambio de contraseña,
  desactivación de MFA, exportación, eliminación de cuenta y reautenticación
  tienen el suyo propio, como preparación y activación de MFA y login MFA.
  Además, todos cargan un límite global de 20 fallos por cuenta cada 15 minutos;
  alcanzarlo bloquea temporalmente también otras superficies, incluido login MFA. Agotado → `429` con `Retry-After` y
  `{ "error": "Demasiados intentos. Espera unos minutos.",
  "retryAfterSeconds": n }`. Un éxito restaura el presupuesto completo.
- **Ventana fresca**: exige que `mfa_verified_at` sea reciente
  (`ADMIN_MFA_FRESH_MINUTES`, 15 minutos por defecto). Si caducó → `403` con
  `details.reason = "mfa_reauthentication_required"` y el factor no se consume;
  el remedio es `POST /mfa/reauthenticate` (único paso que no exige ventana).
  Un step-up exitoso renueva la ventana.
- El factor se verifica con antirreplay por contador (TOTP) y los recovery
  codes son de un solo uso salvo que la operación reemplace el juego completo.

La primera configuración sin MFA activo sólo exige contraseña válida. Activar
un factor pendiente tiene su presupuesto propio (`mfa-enable`): 10 fallos/15 min
y el mismo límite global de 20. Rechaza la igualdad exacta de caducidad, conserva
el factor vigente hasta éxito y no publica códigos nuevos si falla el commit.
Una caída del contador o del control de replay falla de forma cerrada.


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
| GET | `/export.csv` | viewer | Export del workspace en CSV (BOM UTF-8, celdas anti-fórmulas). Máx. 5.000 enlaces: más allá → `409` con el total. Columnas: `id, alias, domain, destination, fallback_destination, state, click_count, max_clicks, single_use, scheduled_at, expires_at, notes, tags_json` (array JSON de nombres, reversible incluso con `;`), `created_at`. El archivo es reimportable tal cual vía `POST /import` (round-trip). Auditoría `link.export`. |
| POST | `/import` | editor | `{ dryRun, csv }` (texto, máx. 256 KiB / 500 filas). **Round-trip portable**: un `export.csv` de UVH se puede volver a importar tal cual. Columnas de creación: `alias, destination, fallback_destination, notes, tags` (`;`) o `tags_json` (lista JSON), `scheduled_at, expires_at, max_clicks, single_use`; las de sólo lectura del propio export (`id, state, click_count, created_at`) se aceptan y se ignoran, y `domain` se resuelve como hostname dentro del workspace destino (inexistente → error de fila). El guard anti-fórmulas del export se deshace al leer (`'=SUM(1)` entra como `=SUM(1)`). Una columna desconocida → `422` nombrándola. `dryRun: true` no escribe nada y devuelve el mismo informe `{ dryRun, valid, created, failed, errors[{row, error}], truncated }` (máx. 100 errores reportados). Los contadores nunca se solapan: `valid` son las filas que se importaron —o importarían en dry run— y **no** incluye las que fallaron al crear, `created` son los enlaces de verdad creados y `failed` las filas que superaron la validación pero no llegaron a crear su enlace; los motivos de `failed` y los rechazos de validación van juntos en `errors`, cada uno con su fila. La importación real exige cabecera `Idempotency-Key` (scope `links.import`): un reintento reproduce la respuesta original sin duplicar enlaces. Además es **reanudable**: cada fila creada se registra junto a su enlace en la misma transacción, y un reintento tras una caída reproduce las filas ya registradas en vez de duplicarlas. Cada fila se valida con las reglas de creación; una fila inválida se reporta sin frenar al resto. |
| POST | `/bulk` | editor | Acciones masivas (máx. 100 enlaces) sobre la selección entera o ninguna: `{ action, linkIds[], tags? , collectionId?, domainId? }` con `action` ∈ pause/activate/archive/trash/restore/tag/untag/move/set-domain → `{ ok, action, applied }`. `set-domain` re-apunta la selección al dominio `domainId` (`null` = dominio de plataforma): exige un destino sirviendo (`403` si no), rechaza la operación entera si un alias chocaría en el destino (`409` nombrándolo) y nunca toca enlaces bloqueados (`403`). `applied` es exacto: cuenta sólo los enlaces que de verdad cambiaron —`untag` sobre un enlace que no llevaba la etiqueta no cuenta ni sube su `version`—. Exige cabecera `Idempotency-Key` (scope `links.bulk` por workspace): la respuesta se sella en la misma transacción que el efecto y una repetición responde con `Idempotent-Replay: true` sin volver a aplicar. `404` si algún id no es del workspace, `403` sobre enlaces bloqueados, `409` al activar un enlace programado o caducado, `429` si la cuota no admite la restauración. |
| GET | `/:id` | viewer | `{ link, rules[], appeal, blockReason }`; `appeal` es `null` o `{ status, createdAt, decidedAt, decisionNote }` de la última apelación —la nota de la decisión es del propietario, que es quien la sufre— y `blockReason` es `null` o el motivo del bloqueo vigente, tomado de la decisión que lo produjo. |
| PATCH | `/:id` | editor | Editar enlace (`version` obligatoria). Claves admitidas: `destination`, `alias`, `domainId`, `collectionId`, `fallbackDestination`, `password`, `maxClicks`, `singleUse`, `scheduledAt`, `expiresAt`, `notes`, `utm`, `tags`, `rules`, `version`; cualquier otra → `422` nombrándola. `collectionId` sigue semántica PATCH: omitido conserva la colección, `null` explícito desagrupa. `alias` no se puede vaciar (`""`/`null` → `422`); omitirlo conserva el actual. `state` no se acepta aquí: se cambia con `POST /:id/state`. |
| POST | `/:id/state` | editor | `{ state }` (active/paused/archived). |
| DELETE | `/:id` | editor | Soft delete. |
| POST | `/:id/restore` | editor | Restaura. |
| POST | `/:id/appeal` | editor | `{ message? }` → `{ ok, appealId }`. Solo si el enlace está bloqueado y una sola apelación abierta por enlace (`409` si ya existe, `409` si no está bloqueado). Rate limit por sesión e IP. |
| GET | `/:id/activity` | viewer | `{ events[] }` (auditoría del enlace). |

El CSV es una transferencia de los campos documentados, **no un backup semántico completo**: no transporta colecciones, contraseñas, reglas de redirección ni configuración UTM completa. `id`, `state`, `click_count` y `created_at` son informativos y se ignoran al importar. `tags_json` contiene una lista JSON escapada con las reglas de CSV; la columna antigua `tags` sigue aceptando nombres separados por `;`, pero no puede representar un nombre que contenga ese separador —ese nombre se parte en varias etiquetas—. Las dos columnas se excluyen **sin precedencia**: enviarlas juntas es `422` «Usa tags o tags_json, no ambas columnas», nunca una que gane sobre la otra.

El dry-run comprueba validación, permisos vigentes, disponibilidad de alias (también duplicados del archivo), cuota acumulada y preparación del dominio. Es una comprobación del estado actual, no una reserva ni una garantía frente a cambios posteriores. La importación revalida cada fila y conserva un registro persistido de sus resultados. Renueva su reserva durante el trabajo; un intento desplazado devuelve `409` y el cliente debe repetir **el mismo cuerpo y la misma Idempotency-Key**. El sellado de la respuesta exige conservar la reserva y nunca sustituye un resultado ya sellado. El registro del lote y la reserva extienden juntos su ventana de 24 horas mientras hay actividad.

## Etiquetas — `/api/v1/tags` (workspace)

| Método | Ruta | Rol | Descripción |
| ------ | ---- | --- | ----------- |
| GET | `/` | viewer | `{ tags[] }` con `{ id, name, links }`; `links` cuenta sólo enlaces vivos. |
| POST | `/:id/rename` | editor | `{ name }` → `{ ok, id, name }`. `409` si el nombre (sin distinguir mayúsculas) ya existe en el workspace. |
| POST | `/merge` | editor | `{ sourceIds[], targetId }` (máx. 50 orígenes) → `{ ok, id, name, moved }`. Las adhesiones se mueven sin duplicar las que ya tenían ambas etiquetas y las de origen se borran: un enlace nunca pierde ni gana grupos por una fusión. Las etiquetas se bloquean en orden determinista y se revalidan al ejecutar: una fuente ya fundida por una fusión concurrente → `404` y nada se mueve. Un nombre que otra petición tomó en el hueco de un rename → `409`, no `500`. |

## Colecciones — `/api/v1/collections` (workspace)

Agrupación plana de un solo nivel; los nombres son únicos por workspace sin distinguir mayúsculas.

| Método | Ruta | Rol | Descripción |
| ------ | ---- | --- | ----------- |
| GET | `/` | viewer | `{ collections[] }` con `{ id, name, links }` (enlaces vivos). |
| POST | `/` | editor | `{ name }` (1–60) → `201 { collection }`. `409` si el nombre está tomado. |
| PATCH | `/:id` | editor | `{ name }` → `{ ok, id, name }`. |
| DELETE | `/:id` | editor | Borra la colección **sin tocar enlaces**: quedan sin agrupar (`collection_id` a `NULL`) y las plantillas que apuntaban a la colección pierden esa referencia, en la misma transacción → `{ ok, moved }`. |

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

Las doce mutaciones revalidan bajo lock la cuenta verificada, su generación y
la sesión concreta del navegador, antes de cambiar el workspace o gastar un
factor. Si esa sesión se revoca, caduca o cambia entre middleware y operación,
devuelven `409` con «La sesión cambió. Vuelve a iniciar sesión», sin borrar
cookies. Aceptar/rechazar conserva entonces la invitación guardada para
reintentar con una sesión nueva. Un bearer terminal sigue devolviendo `400` y
se retira del aparcadero. Los permisos de miembro/rol se comprueban además del
contexto de identidad.

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
| GET | `/` | viewer | `{ domains[] }`; `verificationToken` sólo tiene valor para `editor` o superior. Incluye host TXT, destino CNAME, marcas DNS/TLS, errores seguros, `linksCount` y `isDefault`. |
| POST | `/` | editor | `{ domain }` → crea estado `pending` y genera TXT en `verificationHost` con valor `verificationToken`. Máximo 20 dominios por workspace. |
| PATCH | `/:id` | editor | `rootDestination`, `notFoundMode` (`platform`/`redirect`/`branded`) e `isDefault`, con semántica de clave presente: `null`/vacío explícito limpia, clave ausente no toca. `redirect` sin destino raíz → `422`. `isDefault: true` marca el dominio predeterminado del workspace (exclusivo, exige dominio sirviendo). |
| POST | `/:id/verify` | editor | Admite la comprobación DNS y devuelve `202 { ok, state: "verifying" }`; el worker confirma TXT de propiedad y CNAME de ruta de forma asíncrona. |
| POST | `/:id/activate` | editor | Exige verificación reciente de propiedad/ruta y admite la emisión TLS; devuelve `202 { ok, state: "provisioning" }` hasta que el dominio quede `active`. |
| POST | `/:id/disable` | **admin** | Desactiva (corta todos los enlaces del dominio a la vez). |
| POST | `/:id/revalidate` | editor | Revalida DNS de forma asíncrona conservando el estado visible anterior; devuelve `202`. |
| DELETE | `/:id` | **admin** | Elimina (exige que ningún enlace —ni en papelera— lo use). |
| GET | `/:id` | viewer | `{ domain }` con el diagnóstico completo; `verificationToken` sólo tiene valor para `editor` o superior. |
| GET | `/:id/activity` | viewer | `{ events[] }`, los 50 eventos más recientes del dominio: `{ id, event, payload, createdAt }`. El `payload` está **proyectado** por tipo de evento: sólo `reason`, `failureCount` y `graceExpiresAt` (degradación/caída) o `notAfter` y `daysRemaining` (caducidad TLS); nunca IDs de otros workspaces ni campos internos del outbox. |

`POST /`, `/:id/activate` y `/:id/disable` aceptan una `Idempotency-Key` opcional
(8–64 caracteres): una repetición exacta recibe la respuesta original con la
cabecera `Idempotent-Replay: true` sin volver a aplicar el efecto; la misma
clave con otro cuerpo → `409`, y los errores liberan la clave para reintentar.

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

Eventos de enlaces: `link.created`, `link.updated`, `link.deleted`,
`link.threshold_reached`. Eventos de dominios: `domain.claimed`,
`domain.claim_transferred`, `domain.verified`, `domain.degraded`,
`domain.offline`, `domain.recovered`, `domain.activated`, `domain.disabled`,
`domain.tls_failed`, `domain.tls_expiring`, `domain.deleted`. Y `ping` para
pruebas manuales. Un webhook puede suscribirse a cualquiera de ellos (máximo
uno por evento, sin duplicados). El body tiene
`{ event, event_id, timestamp, data }`. UVH considera correcta una respuesta
HTTP 2xx; en los demás casos reintenta hasta cinco intentos con backoff. La
entrega es **al menos una vez**: si el receptor procesó la petición pero UVH no
pudo persistir el éxito, el mismo `event_id` puede volver a recibirse. El
`event_id` es la identidad estable del evento —todos los reintentos y las
reeentregas llevan el mismo—, así que el receptor debe deduplicar por
`event_id` y hacer idempotente su efecto.

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
| GET | `/domains` | `q`, `state`, `page`, `perPage` → `{ domains[], total, page, perPage }`; nunca devuelve el token DNS. Cada fila lleva `state` (etiqueta derivada) y la salud completa: `traffic_status`, `desired_state`, `ownership_status`, `routing_status`, `tls_status`, `edge_eligible`, `dns_error`, `tls_error`, `verified_at`, `tls_not_after` y `links_count`. |
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


Las pantallas de activación/reset/cambio de email validan el acuse `ok: true`;
reset y cambio exigen además `current` booleano. Un cuerpo incompleto o HTML no
acredita éxito. Tras `400` por bearer inválido/caducado, activación y reset
retiran el formulario y ofrecen otro enlace. Errores de validación conservan
el formulario y los temporales permiten reintento explícito. El foco de teclado
sigue la acción de reintento o el enlace siguiente. Las rutas con autoridad
capturada al entrar renuevan el componente y destruyen tareas del anterior al
navegar a otro enlace: no conservan el bearer ni credenciales del primero.


Solicitudes públicas de correo: forgot-password y resend-verification devuelven {ok:true} sin revelar existencia. El frontend exige ese contrato en ejecución. Forgot sólo admite reset de cuentas activas verificadas; reset-password rechaza bearers de cuenta sin verificar. Todas las respuestas genéricas de forgot comparten uvh.password_reset_min_duration_ms (PASSWORD_RESET_MIN_DURATION_MS,250ms por defecto); validación422/CAPTCHA no están dentro de esa respuesta genérica. El suelo mitiga diferencias temporales sin garantizar latencia idéntica bajo carga. Perfil y reautenticación exigen sesión con expires_at estrictamente posterior al momento de revalidación bajo lock.


CAPTCHA: el widget no concede autoridad por un mensaje de iframe. Sólo recibe source/canal del documento vigente; comprobación invisible exige ejecución actual despachada. Backend mantiene verificación de token con sitekey/hostname/replay del proveedor y fallback local limitado. Retirar/resetear un reto crea documento y canal nuevos; un resultado antiguo no completa una solicitud posterior. El guard de navegación administrativa revalida el rol local tras esperar MFA; la autorización efectiva sigue en backend.


Confirmaciones de cliente: register exige {user:null} (resultado pendiente, sin sesión; forma uniforme también para destinos ocupados). change-registration-email, logout, change-password, data-export/cancel y data-export/download/acknowledge exigen {ok:true}, con booleano true. Un 2xx con cuerpo inválido genera ApiRequestError502 sin conservar el cuerpo ni afirmar éxito o rollback. Sólo la confirmación válida de logout limpia la identidad/workspace local y anuncia invalidación entre pestañas; resultados tardíos de operaciones autenticadas respetan la generación de sesión.


Cliente MFA: un código incompleto/tras borrar un slot no puede enviar el valor anterior. OTP conserva posiciones hasta completar seis dígitos y sólo entonces notifica completado; reset del formulario inicia otro ciclo de completado. MFA/recovery no cambian método durante una verificación pendiente; errores conservan su paso y caducidad exige login nuevo. Estos estados cliente no sustituyen validación de challenge/factor/replay/usuario/sesión en backend.


Contrato MFA (B120): `fresh` requiere que `expiresAt` sea estrictamente posterior al instante actual. En la igualdad se exige `mfa_reauthentication_required`; un step-up caducado no consume su factor. El frontend distingue autenticación confirmada de navegación fallida (B119): el reintento sólo abre la ruta y no repite login/verificación.


B121: un fallo de navegación después de reautenticar MFA se reintenta sin otro POST de factor ni otra sonda de sesión. Si la generación cambia, debe comprobarse de nuevo el contexto antes de seguir. B122: el comando `uvh:admin:promote` requiere secreto MFA que UvhCrypto pueda leer y Totp pueda usar; presencia de ciphertext no prueba elegibilidad. Se conserva compatibilidad keyring/legacy.


### Consistencia de mutaciones de workspace (02/10)
Crear/renombrar, roles, transferencia, expulsión/salida/borrado e invitaciones admiten su evento de éxito en el mismo commit del cambio. Un fallo de audit_outbox rechaza y revierte la operación; un fallo posterior del historial audit_events conserva el evento durable para recuperación. La respuesta de éxito no requiere entrega del proveedor ni materialización inmediata del historial. Transferencia y borrado vuelven a comprobar expires_at > now() al bloquear la sesión, antes de gastar credenciales; una sesión caducada durante la petición devuelve409. Un fallo transitorio de admisión no retira el bearer de invitación guardado. No volver a enviar un TOTP automáticamente: su reserva de replay en cache no comparte rollback SQL. Detalle del contrato y límites: SECURITY_MUTATION_CONTRACT.md; ledger parcial S03 del02/10.


Registro/verificación (O12): contrato HTTP sin cambio. Register crea sólo pending y responde201 user:null con cookie opaca uniforme; verify-email fija identidad/contraseña/consentimientos y consume el bearer bajo TX, sin abrir sesión. AuthController delega en RegistrationAdmission; EmailAddressLock compartido conserva reclamos de dirección. La cookie de edición deja de autorizar al alcanzar exactamente su deadline (B127). Full1451/10213 y calidad434/PHPStan0 comprobados; no implica cierre del resto de Auth.


O13 mantiene HTTP de corrección/reenvío durante extracción: RegistrationEmailCorrection::admit y VerificationResend::admit poseen TX completas. Reenvío común conserva owner/cooldown60s/expires/mail/rollback; cookie edición emite payloadv3(19ID/10sv), lee v2 y mantiene TTL/reloj/crypto. Full habitual1480/10386 y Pint437/PHPStan0 verificados. B129 abierto requiere cambiar privacidad del protocolo compuesto: receipt anónimo permite distinguir ocupación mediante los403/401 de login y200/403 de corrección; no se acredita contrato privado por JSON201 uniforme. Próximo cambio debe preservar orientación de cuentas sin verificar con contraseña correcta y edición de typo, sin modificar User/pending ajeno ni crear credenciales antes de probar buzón.


O14/B129/B130 (03/10): intento de registro durable independiente de ocupación, cookie v4 y compatibilidad v2/v3, corrección coherente y single-use para todos los ACK. El aviso de login describe la solicitud; contraseña correcta conserva prioridad. Activación y retención comparten raíz estable/contexto antes de pending; purga conserva una renovación confirmada durante su espera. Probe original B129 ahora es regresión permanente; B130 reproducido rojo y corregido. Suite completa1527/1527 backend,11020aserciones,348,85s sólo uvh_test (s01-registration-attempt-full-backend.log), exit0;47 casos nuevos frente a1480.198/2255 contratos dedicados (98,94s, s01-registration-attempt-contracts-definitive.log). Pint442/PHPStan0 (s01-registration-attempt-quality-final.log), exit0, baseline sin ampliar. Frontend885/885 y lint/tipos/build correctos, sin nueva revisión visual manual/browser de API local. Inventario452/2176con nombre/1134callbacks/3firmas,452hashes y136anchors S01/28archivos más16S03/2archivos verificados; captura actual03/10, nombre histórico02/10. AuthController2488→2438líneas; no se atribuye ahorro de latencia global. Migración aplicada/verificada sólo uvh_test con guard explícito; NO aplicada uvh_local. Esquema y recambio coordinado de código/procesos pendientes antes de usarlo en otro entorno. S01–S13 y objetivo global siguen abiertos; próximo bloque admisión forgot/reset y helpers compartidos, más gates externos/CI billing sin cambio. Sin entrega real, worker/scheduler productivo, commit/push ni despliegue.


Organización Auth O15 (03/10): forgot/reset conservan endpoints, códigos, payloads, CAPTCHA, suelo temporal y política de cookie. La TX completa se ejecuta en PasswordRecovery; SecurityIncidentNotice conserva los avisos comunes en el commit del caller. CredentialChangeResponse sólo borra cookie cuando el usuario del request coincide con el afectado.1544/11155 backend y151/1246 contratos antes/después; ninguna sesión concedida por reset. En frontend (B131) el ACK de registro no promete renovar la URL preparada: retomar antes de caducar y si sigue disponible. El TTL/API de intent y su cookie de aparcado no cambia.
