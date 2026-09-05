# Operación y recuperación del outbox de correo

Revisión estática: 5 de septiembre de 2026. Procedimiento preparado, no ensayado.
No se ejecutaron suites, migraciones, reintentos ni envíos reales en esta pasada.
El ensayo requiere autorización y una base aislada `uvh_test`, nunca `uvh_local`.

## Qué acredita cada confirmación

La admisión de `UvhMail` confirma que existe un sobre cifrado durable; no que
se haya enviado. La publicación posterior sólo pone un ID en la cola. El estado
`sent` acredita la aceptación del transporte mediante `SentMessage`, no llegada
al buzón, ausencia de rebote ni lectura. La entrega es **al menos una vez**: una
caída entre aceptación y escritura de `sent` puede duplicar el correo.

En desarrollo, un transporte independiente `log` o `array` simula aceptación sin
invocar el transporte ni registrar destinatario, asunto, contenido o enlaces.
Un `sent` obtenido así no es evidencia de entrega real.

Cambio de contraseña, reset y finalización de recuperación reforzada admiten su
aviso de incidente en la misma transacción que las credenciales. Si esa admisión
se rechaza, responden `503` y revierten la operación; no hay que generar un token
nuevo sólo por ese rollback. El bearer debe seguir vigente al reintentar. Un
recovery code persistido se restaura, pero un TOTP consumido en caché no: esperar
al siguiente código, sin borrar marcas antirreplay. La caída del proveedor no
equivale a fallo de admisión y se gestiona después mediante el outbox.

Los avisos de MFA y cambio de email también forman parte del commit de su
mutación. Solicitud/confirmación de email admiten juntos los dos sobres previstos;
un fallo del segundo revierte el primero y su publicación pendiente. Tras un
`503` de admisión MFA conserva sus factores/códigos anteriores y no devuelve
recovery codes nuevos. Un aviso de una transición confirmada es un hecho histórico:
no debe suprimirse sólo porque después cambió otra vez el email o el factor.

Emisión de tokens API y transferencia/borrado de workspace también exigen admitir
su aviso en el commit. `503` de admisión revierte el recurso/roles/borrado y no
devuelve un secreto nuevo. Un rechazo por webhook ocupado no gasta el recovery
code persistido; un contador TOTP externo mantiene su regla antirreplay habitual.

Excepción protectora: cancelar una eliminación de cuenta intenta el aviso dentro
de un savepoint. Si falla, descarta sólo ese intento y conserva la cancelación:
no puede dejar programada una eliminación porque el correo no pudo admitirse.
Se audita el fallo de mejor esfuerzo; si no existe sobre, no hay nada que
reintentar desde el outbox y no se promete una entrega futura. Confirmar el estado
`cancelled` y la cuenta restaurada, no deducirlos de la llegada del aviso.

## Configuración de entrega

La plantilla de producción utiliza `MAIL_MAILER=resend`. Configurar su clave y
remitente en el gestor de secretos, sin copiarlos a incidencias o logs. SMTP y
otros transportes de entrega admitidos necesitan su propia configuración real.

`MailTransportPolicy` resuelve alias, `MAIL_URL` y ramas de `failover`/`roundrobin`.
El arranque de producción y el envío rechazan cualquier rama `log`/`array`,
referencia inexistente, ciclo o transporte no reconocido. El formato legado
`mail.driver` no está admitido. Cada rama Resend exige su clave durante el gate
de producción. La consola operativa comprueba la misma topología, pero no hace
una conexión de prueba ni certifica credenciales, DNS del remitente o entrega.

El `failover` de ejemplo contiene sólo SMTP; una segunda rama debe ser otro
proveedor real configurado. No añadir `log` como respaldo: persistiría enlaces
bearer y convertiría una caída de SMTP en falso éxito. La persistencia y los
reintentos del outbox ya permiten esperar a que el proveedor se recupere.

Tras un cambio de configuración, todos los procesos PHP deben usar la misma
versión/configuración: aplicación, workers y scheduler. Seguir el despliegue
controlado habitual; este runbook no ha reiniciado servicios ni cambiado secretos.

## Estados, plazos y conservación

| Estado | Significado y recuperación | Sobre cifrado |
|---|---|---|
| `pending` | Espera `available_at`; housekeeping publica el ID | Conservado |
| `queued` | Publicación reclamada; si queda atascada 10 minutos vuelve a `pending` | Conservado |
| `processing` | Worker posee un lock generacional; a los 10 minutos se recupera como `pending` | Conservado |
| `sent` | Transporte aceptó el mensaje, o simulación explícita de desarrollo | Vaciado |
| `obsolete` | Recurso/bearer ya no vigente; no se envía | Vaciado |
| `failed` | Intentos agotados sin compensación de ciclo de vida | Conservado para reintento acotado |
| `comp_pending` | Entrega agotada; reversión de ciclo de vida pendiente | Conservado |
| `compensating` | Reversión en curso; un lock atascado 10 minutos vuelve a `comp_pending` | Conservado |
| `compensated` | Reversión completada o generación ya sustituida; no se reenvía | Vaciado |

Cada ciclo normal permite cinco intentos del outbox. Tras los cuatro primeros
fallos programa esperas de 60, 300, 900 y 1.800 segundos. Son tiempos mínimos:
carga, scheduler, disponibilidad de cola y recuperación de procesos pueden
ampliarlos. La política de infraestructura del job (`tries=3`, backoff 60/300)
es distinta del contador durable; no equivale a tres envíos nuevos automáticos.
Una caída puede recuperar una reclamación sin haber alcanzado el transporte.

El scheduler invoca housekeeping cada minuto. Su etapa de correo intenta hasta
25 compensaciones y publica hasta 50 pendientes vencidos por pasada. Si falla
una compensación, queda recuperable y se programa para un minuto después; no se
descarta por alcanzar un contador de intentos. La purga pesada tiene una cadencia
separada (`HOUSEKEEPING_INTERVAL_MINUTES`, por defecto 60).

`MAIL_OUTBOX_PURGE_DAYS` vale 30 por defecto y producción admite de 7 a 365. Sólo
se purgan `sent`, `failed`, `obsolete` y `compensated`, según `updated_at`. Estados
activos o sin compensar no se purgan automáticamente por antigüedad. La retención
de `failed` puede superar su ventana de reintento; aprobar esta conservación y
alertar sobre estados activos atascados antes del despliegue. Vaciar el sobre no
elimina las copias previas de backups, que necesitan una política independiente.

## Procedimiento ante una incidencia

1. Consultar la consola administrativa de operaciones y el listado de correo.
   Registrar únicamente ID del outbox, tipo, estado, intentos, horas y código
   genérico del error. Nunca descifrar/copiar el sobre para un diagnóstico rutinario.
2. Distinguir acumulación de `pending`, publicación `queued`, worker `processing`
   y compensación pendiente. Revisar heartbeats de worker/scheduler, acceso a DB,
   salud del proveedor y configuración sin volcar variables ni credenciales.
3. Corregir la causa mediante el procedimiento autorizado de infraestructura.
   Con scheduler/worker recuperados, observar transiciones y la edad del trabajo
   pendiente; no editar estados con SQL ni borrar filas para silenciar alertas.
4. Reintentar desde el control administrativo sólo un mensaje `failed` que
   indique `retryable`. La API vuelve a comprobar estado, vigencia y autorización
   bajo transacción. Un `202` significa admisión del reintento, no entrega.
5. Si ya está `obsolete`/`compensated`, caducó o consumió su presupuesto, usar el
   flujo funcional correspondiente para crear una solicitud nueva cuando proceda.
   No resucitar tokens ni generaciones antiguas ni utilizar `queue:retry all`
   como sustituto del reintento controlado del outbox.
6. Confirmar la recuperación con metadatos y métricas; una cola vacía no prueba
   recepción. La comprobación de buzón/proveedor necesita destinatarios de prueba
   propios y autorización para enviar, nunca cuentas reales elegidas al azar.

Superficie administrativa: `GET /api/v1/admin/operations`,
`GET /api/v1/admin/mail-outbox` y
`POST /api/v1/admin/mail-outbox/{id}/retry`. Mantener los controles de sesión,
rol, MFA/reauth y CSRF de la aplicación; no desactivarlos para diagnosticar.

El reintento manual exige `failed`, sobre no vacío, menos de tres reintentos
manuales, creación hace como máximo 168 horas y recurso todavía vigente. Reinicia
el contador de intentos del ciclo, pero no rejuvenece `created_at` ni el bearer.
Un conflicto de estado/rol, obsolescencia o presupuesto devuelve `409`; una
comprobación no disponible devuelve `503`. Volver a consultar el estado antes de
repetir una petición cuya respuesta se perdió.

Las compensaciones están ligadas a ID/generación: invitaciones se cancelan;
exports fallan y limpian su artefacto; recuperación reforzada cancela la solicitud
o devuelve una aprobación a `email_confirmed`; eliminación cancela la solicitud
o revierte únicamente su programación vigente. Una compensación antigua no debe
modificar una generación posterior. `email_token` no tiene esta compensación:
su entrega agotada queda `failed`, sujeta a vigencia y al reintento anterior.

## Señales y evidencia de cierre pendientes

La edad `uvh_mail_outbox_oldest_pending_age_seconds` incluye pendientes, en cola,
en procesamiento y compensaciones abiertas. La consola degrada su chequeo al
superar 600 segundos; también muestra fallidos/compensaciones. Contadores de
envío, reintento, fallo, obsolescencia y compensación no contienen destinatarios.
La edad se calcula desde creación, por lo que el backoff intencional también
puede elevarla: no interpretarla aisladamente como caída del proveedor.

Antes de cerrar `MAIL-002`, quedan por acreditar:

- Reglas, umbrales/receptores y llegada efectiva de alertas externas.
- Admisión y rollback conjunto de recursos; caída antes/después del commit;
  publicación perdida; worker detenido y aceptación seguida de caída.
- Contraseña/reset/finalización de recuperación: fallo después del INSERT del
  sobre, conservación de credenciales y bearers anteriores, repetición segura,
  rollback exterior y enlace nuevo protegido de la limpieza de tokens antiguos.
- MFA: fallo de su aviso sin cambiar factores/códigos. Cambio de email: fallo tras
  el segundo sobre, no publicación de ninguno, reserva/códigos/sesiones conservados
  y avisos correctos tras el reintento.
- Token/workspace: no entregar secreto ni cambiar propiedad/borrar sin admisión;
  webhook ocupado sin gastar recovery code. Cancelación de cuenta: conservarla
  ante fallo PHP/SQL del aviso sin dejar un sobre parcial o la transacción abortada.
- Proveedor caído, mensaje cancelado, transporte sin confirmación, recuperación
  y preservación de las dos partes HTML/texto; ausencia de contenido en logs.
- Obsolescencia, agotamiento, compensación repetida y generación sustituida;
  carrera entre reintentos administrativos y caducidad del bearer.
- Purga terminal, no purga de trabajo activo y retención aprobada para DB/backups.

Los contratos añadidos en `MailTransportPolicyTest`, `MailTransportTest` y
`ProductionSecurityTest` están preparados **sin ejecutar**. Las pruebas de
transporte sustituyen sólo la red por memoria; no son evidencia de Resend/SMTP.
`PasswordNoticeAtomicityTest` añade contratos transaccionales de credenciales y
aviso, también sin ejecutar y protegidos por la exigencia de base `*_test`.
`SecurityNoticeAtomicityTest` cubre MFA y los flujos de dos buzones con la misma
restricción y sin haber ejecutado los casos.
`WorkspaceNoticeAtomicityTest` añade siete casos de tokens/workspace, webhook
ocupado y cancelación protectora, preparados y sin ejecutar.

Referencias: [`todos.md`](todos.md),
[`project-radiography-2026-09-04.md`](project-radiography-2026-09-04.md),
[`production-readiness.md`](production-readiness.md) y
[`backend-audit-findings.md`](backend-audit-findings.md), BAF-122 a BAF-129.
