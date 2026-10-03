# Contrato de mutaciones de seguridad

Este documento establece el contrato que deben preservar las correcciones y las extracciones de servicios de UVH. No certifica que todos los subsistemas ya lo cumplan: la cobertura y los pendientes se registran en `superpowers/plans/2026-10-01-system-review-coverage.md`.

## Unidad transaccional

Una operación que concede, cambia o elimina autoridad debe revalidar su autoridad y admitir su evento de éxito en la misma transacción que modifica el recurso:

```text
transacción → locks ordenados → revalidación → cambio
            → admisión de avisos obligatorios → admisión de auditoría → commit
```

Los preflight y el middleware permiten rechazar temprano, pero no reemplazan la revalidación bajo bloqueo. El contexto debe comprobar la cuenta activa/verificada, la generación de seguridad, la sesión concreta vigente y los permisos pertinentes. La comprobación de MFA depende del contrato de la operación y no se deduce de la presencia de un secreto.

Los locks de usuarios se toman primero, en orden de ID cuando hay varios; después, sesiones cuando corresponda, workspace y recursos hijos. Antes de extraer un servicio hay que comprobar también el orden de los demás flujos que pueden tocar esas filas. Un objeto `readonly` que contiene modelos no prolonga los locks ni hace inmutables los modelos: el contexto bloqueado se utiliza sólo dentro de la transacción que lo obtuvo.

`SecurityContext::lock/lockWithUsers` centraliza la cuenta y la sesión concreta. Sus factories exigen una transacción y devuelven null ante autoridad obsoleta; verified es una política explícita del caller. Las doce mutaciones de WorkspaceController la requieren y devuelven409 mediante StaleSecurityContext. `WorkspaceAccess::getMembershipForContext` reutiliza las filas bloqueadas y conserva el gate del recurso/rol. No reutilizar el contexto en otra transacción ni asumir que la factory cubre automáticamente los restantes controladores.

El login aún no posee una sesión: `Auth\LoginAdmission::admit` exige un snapshot cuya contraseña haya verificado el caller, revalida ese mismo hash/email/generación/estado bajo lock y concede la nueva sesión o reto MFA con auditoría en esa transacción. `Auth\MfaChallengeStore` conserva los namespaces/TTL previos y el marker consumido ante rollback o cleanup fallido. HTTP/CAPTCHA, locks distribuidos y verificación final de TOTP/recovery conservan sus responsables actuales; no trasladar sólo el INSERT separándolo de sus comprobaciones.

`Auth\MfaLoginAdmission` agrupa ahora la revalidación SQL y la admisión final TOTP/recovery con sus eventos exactos. El caller conserva el lock distribuido, relee los claims del mismo owner/version y comprueba el presupuesto antes de invocarlo. Un cambio de identidad bajo lock devuelve `challenge`; no se cobra como un factor incorrecto ni se publica `auth.mfa_failed`. Los algoritmos compartidos viven en `Auth\MfaFactorVerification`; los requisitos de autoridad/frescura, los mensajes y la persistencia de recovery codes permanecen en cada operación. La reserva antirreplay de TOTP dura180s y el reto MFA300s; no unificar los TTL por similitud de nombres.

## Auditoría y avisos

`Audit::write` dentro de la transacción admite una fila en `audit_outbox`. Si la admisión falla, propaga el error y la operación debe revertirse. Si falla la materialización posterior en `audit_events`, el evento admitido permanece recuperable; no se informa que el cambio ya confirmado haya fallado. La recuperación puede repetirse sin duplicar el evento.

Un evento de éxito debe describir la operación confirmada, con actor, acción, recurso, workspace explícito y metadatos acotados. No incluye contraseñas, bearer, códigos de recuperación ni secretos. Una devolución de rechazo no puede publicar el evento de éxito. No reconstruir el evento después del commit a partir de un recurso que puede haber cambiado o desaparecido.

Cuando el aviso es obligatorio, su admisión en el outbox y el cambio forman una sola unidad. La entrega por proveedor, el envío de webhooks y el despacho de trabajos ocurren después del commit. Registrar durablemente el aviso no equivale a entregarlo; las dos etapas se verifican por separado.

`Audit::write` fuera de una transacción absorbe errores para no convertir una operación ya confirmada en un falso fracaso. Por eso no sirve como garantía de auditoría de una mutación sensible ya confirmada. Sigue siendo válido para señales informativas cuyo contrato admite esa pérdida.

## Credenciales y efectos no transaccionales

Un fallo de admisión SQL debe conservar los bearer y códigos de recuperación almacenados en la misma transacción. Los callbacks after-commit deben quedar descartados al hacer rollback. Una invitación guardada en una cookie se retira al consumirse o quedar inválida de forma definitiva, y se conserva ante un fallo transitorio de admisión.

Las reservas de replay TOTP, los presupuestos en cache y otros efectos externos no se revierten por un rollback SQL. Deben revisarse por separado: no afirmar que un factor sigue disponible sólo porque se revirtió la fila del usuario, ni liberar una reserva que podría permitir replay. Las regresiones identifican qué credencial y qué almacén están cubriendo.

Una pérdida de identidad no vuelve terminal un bearer de invitación todavía pendiente. Accept/reject devuelven409 sin retirar su cookie cuando falla el contexto; una sesión nueva puede reintentar. Un bearer consumido, cancelado o caducado conserva400 y retirada. La pérdida de identidad y el estado del bearer son decisiones distintas.

Las acciones protectoras, como cancelar un borrado de cuenta, pueden tener un contrato distinto: un fallo de entrega no debe dejar al usuario expuesto. Mantener su mecanismo explícito de auditoría y recuperación, en lugar de imponerles automáticamente el contrato de una concesión de permisos.

## Evidencia mínima para cambiar o extraer un flujo

- Lectura del flujo completo, sus llamadores y las operaciones que compiten por los mismos locks.
- Comportamiento permitido y rechazo por cuenta, sesión, generación y rol obsoletos, según el contrato.
- Fallo de admisión antes del INSERT y después del INSERT: rollback del cambio y de sus dependencias.
- Historial indisponible: cambio confirmado, evento exacto recuperable y recuperación sin duplicados.
- Ningún evento de éxito ni callback externo al rechazar o revertir la operación.
- Consumo de credenciales y estado del navegador coherentes con el resultado confirmado.
- Una extracción conserva estas pruebas antes de introducir cambios funcionales o de rendimiento.

Referencias: `WorkspaceAuditAtomicityTest` cubre las doce mutaciones explícitas, fallo de admisión/interrupción, historial, rechazos, sesión revocada/expirada/ajena/borrada/con otra generación y retry del bearer guardado. `LockedSecurityContextTest` comprueba las factories y dos conexiones PostgreSQL independientes. `LoginAdmissionTest`, `MfaChallengeAdmissionTest` y `MfaLoginAdmissionTest` conservan el contrato de la primera extracción Auth. No sustituyen la revisión de otras carreras, roles ni configuración de producción.


Registro y activación (O12): RegistrationAdmission conserva la TX completa de pending/bearer/outbox/audit y de identidad/workspace/consentimientos/consumo. El controlador exige input y aceptación de versiones explícitas antes de invocar el servicio; la activación revalida contraseña contra email/name vivos bajo lock. No se emite sesión. EmailAddressLock conserva namespace/clave y exige TX abierta; otros callers conservan su orden. RegistrationEdit rechaza expiración igual a ahora (B127) y sigue exigiendo comparación con pending bloqueado en mutaciones. Reloj de pruebas sólo existe en procesos aislados y no cambia el reloj productivo.


O13: correction mantiene secreto/pending/advisory/generación/bearer/mail/audit dentro de una TX. VerificationResend unifica emisión después de bloquear owner, conservando User deleted/verified y Pending existencia. Snapshot no concede mail; cooldown exacto60s, outbox y sustitución comparten commit. B128 emite payloadv3 de ancho fijo19ID/10sv y lee v2, con rechazo int64/int32 fuera de rango antes de autorizar. B129 abierto: privacidad debe comprobarse por composición de rutas, no sólo por opacidad ni JSON uniforme de signup.


## Intentos de registro — contrato actual O14/B129

`registration_attempts` es autoridad del navegador sobre su solicitud, nunca prueba del buzón ni propiedad de una cuenta. Todos los desenlaces del alta generan uno; email no es único. La cookie v4 liga ID/generación/deadline exacto almacenado y no puede autorizar el namespace pending de v2/v3. Claims viejos conservan su deadline: lineage privada tras backfill/activación; decoys auténticos se vinculan una sola vez por digest, sin adjuntar filas ajenas.

Cada corrección confirmada rota el contexto y la generación del pending propio si existe, también ante destino ocupado. El contexto conserva la dirección solicitada; el pending sólo cambia de dirección y bearer si el destino se puede reclamar. Un intento virtual puede crear un pending nuevo, sin modificar una cuenta o pending preexistente. Activación crea identidad y elimina pending/bearers; el FK SET NULL conserva el contexto hasta caducar para no anunciar la decisión del dueño del buzón. Contraseña correcta conserva prioridad en login; el aviso con cookie y contraseña incorrecta describe una solicitud, no existencia de cuenta.

Orden compartido: mutex transaccional de raíz estable → contexto → pending → bearer → advisory de dirección antes de su reclamación. La raíz legacy/original es inmutable; los contextos virtuales mantienen raíz de intento incluso al crear pending. Activación y retención bloquean el hijo antes del padre, porque el FK de borrado también actualiza el hijo. Reenvío bloquea pending/bearer y no espera contexto. Retención del intento revalida expiry en el DELETE final: una selección anterior al lock no puede borrar la renovación ya confirmada (B130).

La migración está preparada y probada sólo en uvh_test. Backfill no crea credenciales/cuentas/consentimientos. Down rechaza eliminar contextos activos. Aplicar esquema antes del nuevo código y coordinar el recambio de procesos Auth/housekeeping; no dar por compatible una convivencia indefinida entre escritores viejos y nuevos. Entrega real, capacidad de retención, rotación/configuración/despliegue y resto de sistemas conservan sus gates. Las respuestas uniformes y un floor temporal no acreditan tiempo constante bajo toda carga.


## Recuperación de contraseña — organización actual O15

PasswordRecovery::request bloquea la cuenta seleccionada y revalida email/verified/deleted antes de cooldown, emisión reset1h, outbox y sustitución de bearers. El hint público no autoriza. PasswordRecovery::reset conserva la TX completa cuenta→token: kind/dueño/unused/deadline exclusivo, cuenta activa/verificada y password contra identidad viva; después consumo, rotación de generación, cierre de sesiones/API, cancelación de recovery, aviso y exact audit. Controller valida sintaxis/CAPTCHA/fuerza general, calcula hash fuera del lock, aplica floor y convierte errores/respuesta. El reset no emite sesión y no adopta política de sesión del cambio autenticado.

SecurityIncidentNotice pertenece a Auth y comparte avisos password/individual/bulk. Exige transacción abierta; caller sostiene los locks de la mutación. Guard no certifica por sí solo que un caller nuevo haya adquirido esos locks. No abre TX independiente ni captura admisión; bearer24h/inbox/audit/mail quedan en commit de caller y publicación/delivery siguen after-commit. Conservar bearer nuevo en pruning, más cuatro anteriores y borrado acotado100. CredentialChangeResponse sólo adapta resultado HTTP y cookie propia, nunca autoriza mutación. Los seis cuerpos trasladados mantienen statements/política anteriores.

B131: conservar un handoff no acredita que el recurso todavía exista; la cookie tiene techo propio y no renueva el intent. El registro no puede prometer otras24h ni recuperación garantizada. Copy Auth ahora condiciona a caducidad/disponibilidad; no tratar ese cambio de texto como auditoría completa del lifecycle de handoffs.


## Revocación protectora — O16/B132 y cancelación B133

CompromisedAccessRevocation conserva la TX completa de revocación. SecurityIncidentAudit::record se ejecuta bajo lock de cuenta dentro de ese commit, tanto para rama activa/restaurable como para bloqueo administrativo conservado. El receipt mínimo es infraestructura de la mutación: si su INSERT falla, rollback conserva bearer/estado para reintentar. La indisponibilidad del audit outbox general, del historial o del warning de fallback no debe deshacer protección.

Audit::write y borrado del receipt comparten savepoint. Si audit admite y sólo falla limpiar receipt, rollback del savepoint impide duplicado; el commit protector conserva evidencia pendiente. Reconciliación adquiere cuenta antes de receipt y revalida tras lock; dos procesos reales prueban overlap y un evento. Se recuperan como máximo100 receipts por pasada; no hay TTL ni purga de pendientes. FK SET NULL permite cuenta eliminada con actor null y resource_id original; incident_at y incident_correlation_id registran origen. Down rechaza filas pendientes. No reconstruye incidentes perdidos antes de este cambio.

B133: AccountDeletionAudit captura también fallo del logger de fallback, preservando cancelación/marker cuando SQL/PHP de audit general y logging fallan juntos. No aplicar esa política de catch a admisiones obligatorias de credenciales: éstas mantienen rollback estricto. Esquema O16 sólo migrado uvh_test; rollout coordinado, scheduler/retención/capacidad y monitorización productivos siguen pendientes. El cleanup físico de artefactos conserva frontera previa, sin garantía nueva para TX exteriores que reviertan después de la respuesta.


## Recuperación de cuenta — O17/B134

AccountRecoveryAdmission conserva tres TX completas. request cuenta→case revalida dirección/verified/MFA/deleted y cooldown60s, renueva estado/bearer/mail/exact audit en un commit; confirm cuenta→case revalida owner/hash/status/deadlines/generación sin conceder sesión. complete bloquea todos los User conocidos ordenados por ID antes del case y relee approval set; si cambió no adquiere locks tardíos, retira el completion bearer y devuelve approval_changed para nueva revisión. Aprobadores deben ser distintos del dueño y seguir admin/MFA/verified/activos; target sigue recuperable y versión válida. Password usa identidad viva. Credenciales, democión admin, retiro MFA, sesiones/API, operaciones, completion bearer, notice y audit exacto comparten commit; hash/CAPTCHA/input/HTTP y cleanup externo conservan controlador.

B134: la posesión de un bearer de recuperación no autoriza cerrar la cookie de otra cuenta del navegador. CredentialChangeResponse compara identidad del request con ID recuperado, añade current booleano y sólo elimina cookie propia. La SPA exige mensaje/ok/current válidos; captura generación al enviar y reconcilia Auth sólo si current. Una respuesta tardía puede confirmar revocación después de destroy sin modificar pantalla/form retirados; AuthService no borra identidad nueva. El backend y SPA deben publicar juntos el nuevo contrato; cliente antiguo tolera campo extra, cliente nuevo no da éxito ante current ausente/no booleano.

Caracterizaciones antes/después preservan cuerpos y policy de admisión; prueba de rollback exterior no incluye archivo físico, por lo que no demuestra atomicidad de filesystem. Interleavings nuevos son deterministas en API real, no dos procesos de esta recuperación. Revisión de identidad externa/aprobadores productivos, entrega/capacidad, retenciones y otros sistemas siguen pendientes.


O18 — frontera de cleanup de exportaciones: los callers HTTP de Auth, Account y bloqueo Admin programan `PrivateArtifactCleanup::afterCommit`. El callback debe esperar el commit exterior y revalidar, bajo lock de la fila export, status downloaded/failed/cancelled/expired y la ruta concreta esperada; un callback obsoleto no consume un archivo ready/processing ni otra ruta. El puntero terminal durable permite recuperar una interrupción entre commit y callback mediante retención de housekeeping. El filesystem no es transaccional: si DELETE ocurre pero SQL de limpiar puntero revierte, el marcador permanece y el siguiente retry verifica ausencia y lo limpia. No se presenta ese DELETE como reversible.

`attempt` mantiene su booleano de resultado inmediato para workers, que necesitan retirar el archivo anterior antes de registrar otro; no es la API de callbacks de negocio. Su uso dentro de otras transacciones y los demás callers conservan revisión específica. retryTerminal relee status/ruta bajo lock después de seleccionar. Diagnostic/metrics no pueden convertir una revocación confirmada en500, incluso con SQL de métricas y logger fallidos. Ready, aviso, mail y admisión de account.data_export_ready comparten commit; fallo exacto revierte publicación y permite reintentar. La materialización posterior sigue el outbox existente. No nuevo contrato HTTP ni cambio de TTL/autoridad de descarga.


O19: `AuthenticatedPasswordChange::admit` posee la TX completa del cambio autenticado. El controller valida y calcula hash fuera de locks. SecurityContext conserva cuenta→sesión concreta, versión/expiry exclusivo y estado activo; PasswordStrength reevalúa identidad viva antes de gastar factor. MfaStepUp mantiene freshness/presupuesto/replay y consumption recovery dentro del update de password/generación. La sesión propia adopta generación, las otras se revocan; se retiran reset activos y cases. SecurityIncidentNotice, mail/notification y eventos exactos permanecen en el mismo commit. Un rollback exterior no publica jobs ni historial y permite retry con el recovery restaurado. Que se retire ese code en SQL no autoriza limpiar un replay TOTP fuera de SQL. Este traslado conserva las diferencias de policy con reset/recovery; no promete su misma revocación de API tokens. Interleavings nuevos son deterministas de una petición real, no procesos concurrentes.


O20: EmailChangeAdmission conserva request/cancel/confirm como TX completas. La solicitud valida autoridad y factor antes de exponer ocupación. Antes de borrar su reserva comprueba una reserva ajena con expires_at>now y provoca rollback completo por excepción controlada; mismo409/cuerpo, freshness y recovery restaurados. SQL unique permanece como última defensa. Un mutex por dirección no garantiza ausencia de ciclos entre direcciones distintas. B139 nativo verifica dos propietarios/reservas cruzadas: ambos409, sin40P01, filas/codes retenidos. Cancel mantiene consumo incluso sin pendiente. Confirmación revalida dueño/caso/verified/SV/expiry y cambia identidad/generación, revoca sesiones/API/bearers/cases y admite mail doble/exact audit en un commit. Rollback exterior no publica ni jobs ni historial y permite retry. No deshacer replay TOTP no-SQL por un rollback de DB.


O21: MfaConfigurationAdmission es propietario de los cinco commits MFA; no fragmenta estado/factor/generación/current/otras sesiones/caso/mail/notification/exact audit. Setup conserva factor activo mientras prepara el nuevo, cancel retira sólo pending sin step-up, enable prueba pending antes de cambiar activo, regenerate reemplaza todos los hashes y disable exige factor concreto y ausencia de rol admin. SecurityContext account→exact session y verified/version/expiry se reevalúa bajo lock.30 cambios reales tras hydrate y12outer commit/rollback complementan contratos previos. Un rollback conserva SQL/recovery y permite retry correspondiente; no retira el counter TOTP compartido. First/reconfigure esperan una prueba nueva cuando la anterior fue gastada aun sin commit SQL. Infraestructura503 conserva handler global; ausencia de catch local no autoriza factor ni cambia estado. API-token policy se conserva, no se homogeneiza con recuperación.


O22/O23: ReauthenticationAdmission mantiene renovación freshness, recuperación y evento exacto dentro de su TX, sin nueva sesión ni requisito de ventana fresca previa. ProfileAdmission actualiza nombre y audit juntos bajo cuenta/sesión activa, verified y generación vigente; no incorpora step-up. Seis nuevos casos outer commit/rollback complementan contextos/audit/expiry existentes. AccountReadContext es una proyección para lecturas por petición; readonly no hace inmutables los modelos ni extiende vigencia. Los commands deben adquirir SecurityContext dentro de su propia TX. AccountQueries conserva SQL/payload/limits/order/minimización, sin FOR UPDATE/TX de negocio; no constituye snapshot serializable de toda la respuesta. Cuatro GET nuevos verifican el aislamiento de lectura. Logout conserva su política protectora frente a fallo de auditoría; no debe homogeneizarse con las tres TX de revocación explícita.


O24/O25: SessionRevocationAdmission conserva tres transacciones protectoras completas, requireVerifiedEmail=false original, owner/current/counts/idempotencia y mail/bearer/inbox/exact audit. Los tres nuevos casos sin verified vivo simulan una petición ya autorizada; nueva petición sigue401y revocación en hydrate. Logout mantiene cierre aun si audit falla.

NotificationController revalida GET mediante AccountReadContext antes de leer; no hay locks de commands ni snapshot serializable de toda proyección. Commands read/readAll/updatePreferences obtienen SecurityContext verified dentro de su TX antes de cambiar filas; cuenta/owner/SV/revoked/expiry>now se comprueban bajo locks. Pérdida de contexto devuelve401GET/409command sin cookies/cambios. Preferencias y retirada digest sólo confirman con exact audit admitido en su misma TX, también sin wrapper exterior. Historial caído conserva éxito y evidencia recuperable; audit ausente/interrumpido revierte. Duplicados HTTP se rechazan422antes de validación de mapa/cambios. No nuevo audit para marcar leído ni step-up; mandatory permanece inmediato. Batch de delivery evita13lookups en cada vista y conserva normalización/scopes, sin cachear autoridad.


O28 — intención local y autoridad cookie: X-Uvh-Account-Id opcional se compara con el actor hidratado en UvhAuth, antes del controller/tenant/step-up; nunca selecciona User ni autentica. Valor decimal canónico de 1 a19 dígitos; malformed400/invalid_account_context y mismatch409/session_context_changed sin IDs ni cookie/session business effects. Logout recibe nivel optional para conservar el cierre anónimo y comprobar el actor cuando existe. Public bearer/token routes no incorporan este gate. Las transacciones deben conservar SecurityContext y su revalidación; este preflight no congela la cuenta ni sustituye locks/verified/roles/CSRF.

Frontend: LatestRequest propia para init/me, abort de lecturas anteriores y comprobación también inmediatamente antes de publicar, después del await del helper. Confirmed profile/email DTO cancela probes anteriores. Cuenta observada distinta avanza generación, limpia lista/selección anterior y recarga workspaces con su nuevo epoch; misma cuenta conserva generación/command válido. Ante409 exacto del server sólo se limpia la proyección de la petición originaria, incluido Blob pequeño con reason válido; error tardío no borra login posterior, no retry/logout/storage announcement. Set-Cookie de respuestas ya enviadas y clientes legacy sin header conservan limitaciones explícitas; no se afirma solución universal a concurrencia entre pestañas.
