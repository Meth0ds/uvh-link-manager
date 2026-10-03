# Revisión parcial S03 y trazabilidad S13 — 2026-10-02

Se adelanta el contrato compartido de auditoría de autoridad. Este registro acredita lectura del cuerpo completo de las doce mutaciones explícitas y pruebas de las fronteras indicadas; no cierra todos sus roles, sesiones, concurrencia, UI ni los sistemas S03/S13. S01 y S02–S13 conservan el alcance del plan maestro.

## WorkspaceController

B123 (P2): los eventos de éxito se admitían después del commit; al faltar audit_outbox o fallar después del INSERT, Audit::write absorbía el error fuera de la transacción y las doce operaciones respondían con éxito. Se mueve la admisión al commit de negocio, sin cambiar nombre, metadatos ni atribución del evento. Las señales de fallo de correo siguen fuera del commit rechazado: no son eventos de éxito.

B124 (P2): transferOwnership y destroy bloqueaban la sesión sin exigir expires_at > now(). Una sesión caducada después del middleware todavía podía gastar recovery y confirmar el cambio. Se revalida la caducidad antes de verificar el factor. Control determinista después de autenticar: deadline -1/0/+1 segundos; cuatro rechazos reproducidos frente a dos controles válidos. No demuestra todas las revocaciones concurrentes de cada mutación restante.

| Función | Línea actual | Evidencia y pendientes |
| --- | --- | --- |
| `store` | 62 | B123/B125: sesión concreta revalidada; admisión ausente/interrumpida, recuperación exacta y rechazo. UI, concurrencia y resto de autoridad pendientes S03. |
| `rename` | 151 | B123/B125: sesión concreta revalidada; admisión ausente/interrumpida, recuperación exacta y rechazo. UI, concurrencia y resto de autoridad pendientes S03. |
| `changeRole` | 176 | B123/B125: sesión concreta revalidada; admisión ausente/interrumpida, recuperación exacta y rechazo. UI, concurrencia y resto de autoridad pendientes S03. |
| `transferOwnership` | 259 | B123/B125: sesión concreta revalidada; admisión ausente/interrumpida, recuperación exacta y rechazo. B124: deadline bajo lock. UI, concurrencia y resto de autoridad pendientes S03. |
| `removeMember` | 396 | B123/B125: sesión concreta revalidada; admisión ausente/interrumpida, recuperación exacta y rechazo. UI, concurrencia y resto de autoridad pendientes S03. |
| `leave` | 453 | B123/B125: sesión concreta revalidada; admisión ausente/interrumpida, recuperación exacta y rechazo. UI, concurrencia y resto de autoridad pendientes S03. |
| `destroy` | 495 | B123/B125: sesión concreta revalidada; admisión ausente/interrumpida, recuperación exacta y rechazo. B124: deadline bajo lock. UI, concurrencia y resto de autoridad pendientes S03. |
| `invite` | 590 | B123/B125: sesión concreta revalidada; admisión ausente/interrumpida, recuperación exacta y rechazo. UI, concurrencia y resto de autoridad pendientes S03. |
| `acceptInvitation` | 724 | B123/B125: sesión concreta revalidada; admisión ausente/interrumpida, recuperación exacta y rechazo. Bearer guardado conservado ante fallo y retirado al confirmar. UI, concurrencia y resto de autoridad pendientes S03. |
| `rejectInvitation` | 804 | B123/B125: sesión concreta revalidada; admisión ausente/interrumpida, recuperación exacta y rechazo. Bearer guardado conservado ante fallo y retirado al confirmar. UI, concurrencia y resto de autoridad pendientes S03. |
| `cancelInvitation` | 849 | B123/B125: sesión concreta revalidada; admisión ausente/interrumpida, recuperación exacta y rechazo. UI, concurrencia y resto de autoridad pendientes S03. |
| `resendInvitation` | 889 | B123/B125: sesión concreta revalidada; admisión ausente/interrumpida, recuperación exacta y rechazo. UI, concurrencia y resto de autoridad pendientes S03. |

Dependencias leídas para esta frontera: Audit::write/drain/reportFailure, WorkspaceAccess::getMembershipLocked/roleAtLeast, MfaStepUp::verify/success y deactivaciones de WebhookService; los demás consumidores mantienen sus gates. Los after-commit de mail/audit no se ejecutan al revertir el commit. Los efectos de cache TOTP no son transaccionales y no se certifica su reversión.

WorkspaceAuditAtomicityTest: 56 casos nuevos (36 admisión/interrupción/historial, 12 rechazos, 2 bearer guardado, 6 deadline). Snapshot completo de usuarios, workspaces, membresías, cuotas, tokens, webhooks, invitaciones, inbox, mail, presupuesto SQL y prueba MFA; SessionManager puede actualizar last_used_at fuera de esta unidad y se excluye de ese snapshot. Historial recuperado dos veces sin duplicado, metadatos exactos sin credenciales y retry con el mismo recovery/bearer/presupuesto.

Baseline B123:24 fallos/12 controles correctos (s03-workspace-audit-red.log). Primera corrección36/348 (s03-workspace-audit-green.log). Baseline B124 y correlación4 fallos/6 controles correctos (s03-workspace-expiry-correlation-red.log). Definitivo conjunto131/954 aserciones,34,22s (s03-workspace-audit-contracts-final.log). Pint423 archivos/PHPStan0 con baseline todavía activo (s03-workspace-audit-quality-final.log). Suite completa definitiva:1334/1334 backend,9474 aserciones,279,36s en uvh_test (s03-workspace-audit-full-backend.log), exit0. Pint423/PHPStan0 con baseline activo;diff--check0. No modificación PHP posterior. Frontend no modificado en este bloque, no se acredita nueva ejecución de su suite. Inventario440 archivos/2148 funciones con nombre/1129 callbacks/3 firmas;440 hashes actuales comprobados. S03/S13 parciales y objetivo global activo.

## Trazabilidad S13 — candidato descartado en el recorrido probado

Leídos CorrelateRequest::handle, RequestTrace::push/current/pop y pipelines HTTP/routing de la versión instalada de Laravel. El pipeline de Routing captura, reporta y renderiza excepciones antes de devolver la respuesta al middleware. RequestCorrelationTest tiene cuatro casos: excepción de ruta, excepción en middleware global posterior a CorrelateRequest, callback de stream, header del cliente ignorado. Se conserva correlation_id al reportar y X-Request-ID en la respuesta; siguiente request y log fuera del request no heredan el contexto. El stream reinstala el ID al emitir y lo limpia. No se modifica producción sin reproducción. Excepciones anteriores a CorrelateRequest, fallos al reportar/renderizar, canales alternativos, terminación y stream interrumpido quedan fuera de estos cuatro casos.

Primer harness agregó rutas después de los catch-all API y obtuvo cuatro404; se corrigió la fixture a rutas fuera de esa colección, conservando middleware/handler reales. No era un defecto de correlación. OperationalNoticesTest mantiene prueba histórica de stack anidado; no confundirla con nueva evidencia de todos los casos pendientes.

## CI remoto — bloqueo externo confirmado

Consulta de HEAD b93185de832255d30e75f4d423a97658296a8b8e el02/10 mediante conector GitHub y página pública. Tres runs push terminados en failure; CI36950477409 tiene nueve jobs sin steps. La página muestra para los nueve: «The job was not started because your account is locked due to a billing issue.» Fuente: https://github.com/Meth0ds/uvh-link-manager/actions/runs/36950477409

Debe resolverse la facturación/bloqueo de la cuenta en GitHub y después verificarse una ejecución real. No se ha reintentado un job que todavía no puede arrancar, cambiado billing, alterado los workflows ni enviado código. La suite local prueba el árbol modificado; no afirma que el commit remoto histórico sea verde. gh no está instalado; el wrapper fetch_commit_workflow_runs filtra sólo PR y devolvió vacío para este push; se consultó la colección de runs por head_sha. fetch genérico del job rechazó endpoint no admitido; el wrapper de jobs y la página pública aportaron evidencia, sin inferir billing de la duración ni intentar el endpoint otra vez.


## B125 — sesión concreta después del middleware; O09 (02/10)

La revocación individual/otras sesiones no rota security_version de cuenta. Diez mutadores sólo revalidaban cuenta/permisos; un request admitido antes de revocar su sesión podía confirmar una mutación después. Baseline60 casos:50 fallos/10 correctos (transferencia/borrado ya rechazaban los cinco cambios por B124). Revocada, expiry exacta, generación de sesión distinta, owner ajeno y fila eliminada inyectados entre middleware y locks de negocio. No se afirma acceso mediante una nueva petición con una cookie ya revocada.

Las doce mutaciones ahora obtienen SecurityContext dentro de su TX antes de negocio/MFA. Usuarios relacionados siguen ordenados por ID; sesión exacta se bloquea antes de workspace/recursos. Fallo del contexto lanza StaleSecurityContext, mapeado a409 sin retirar cookies. En accept/reject se conserva la invitación guardada ante cambio de identidad; token terminal mantiene400 y retirada. Dos pruebas pasan con una sesión nueva sin reenviar bearer desde JS.

O09: WorkspaceAccess::getMembershipForContext reutiliza autoridad bloqueada; getMembershipLocked conserva el contrato de tokens API para otros callers. lockMembership comparte el gate workspace/role. Doce controles positivos miden un SELECT FOR UPDATE de usuarios (batch cuando corresponde) y uno de sesión por mutación. Se evita volver a bloquear cuenta en changeRole/destroy; no se atribuye mejora de latencia ni ahorro global de consultas, porque se añade la comprobación de sesión que faltaba.

WorkspaceAuditAtomicityTest contiene133 casos (56 anteriores +60 invalidaciones de sesión +12 queries +2 retry cookie +3 IDs inexistentes). LockedSecurityContextTest16 valida factory y dos conexiones PDO. Conjunto final251/1636 aserciones,61,68s, incluye Auth y dependencias Workspace. Pint428/PHPStan0 con baseline activo; full final1431/10041 correcto, detalle al final del registro. Otros endpoints/UI, carreras de roles/permisos, expiración durante esperas prolongadas y orden entre controladores mantienen gate de S03.

| Función | Línea actual | Estado |
| --- | --- | --- |
| `lockSecurityContext` | 983 | Wrapper del controlador: verified requerido, session ID del request;409 distinguido de bearer terminal |

## backend-laravel/app/Support/WorkspaceAccess.php

| Función | Línea actual | Estado |
| --- | --- | --- |
| `getMembershipLocked` | 40 | Contrato histórico de cuenta/token/roles preservado, nuevo helper compartido |
| `getMembershipForContext` | 85 | TX requerida; sólo autoridad del contexto, policy workspace/role todavía local |
| `lockMembership` | 94 | Parent workspace bloqueado antes de leer membership/role; no certifica todos sus otros callers |

StaleSecurityContext no tiene métodos; bootstrap/app.php renderiza409 JSON para API y no limpia cookies. La garantía de locks de SecurityContext se revisa en ledger S01 y no convierte la enumeración de todos los demás consumidores en cobertura.

Errores de harness/edición: dos scripts iniciales abortaron asserts antes de escribir (ocho membership callers, closures con request ya añadido); un test se lanzó antes de aplicar el cambio y repitió50 fallos. Pint cambió espacios de PHPDoc y un patch posterior no coincidió, sin modificación parcial. PHPStan señaló validación runtime de IDs con doc demasiado estrecho y rama stale muerta de store; corregidas sin nuevos ignore/baseline. Dos primeras pruebas cookie esperaban tabla audit vacía pero parking tiene su propio evento; se captura baseline y se exige ningún evento de mutación. Primer mock MFA no compartía repository y dio503 antes de consumo; fixture ahora enruta get/add/lock/store al mismo array store, verificando marker y retry reales. No se contabilizan estos errores como bugs de producto.


Revisión final de migración: ID de miembro0/000 aceptado por la ruta no es un relatedUserId válido de la factory. Baseline de la regresión introducida2fallos/1control; caller evita ese lock imposible y conserva target_inactive409.3/15 aserciones correctas (s03-context-zero-target-green.log). Full anterior1428/10026,260,56s correcto; después del último cambio PHP1431/10041,249,51s también correcto. No atribuir este hallazgo de QA a un bug histórico ni cerrar el árbol final con evidencia anterior.


Verificación definitiva del árbol final B125/O09–O10:1431/1431 backend,10041 aserciones,249,51s en uvh_test (s01-auth-extraction-full-backend-final.log), exit0. Pint428/PHPStan0 con baseline existente y sin ampliación (s01-auth-extraction-quality-final.log), exit0. Último cambio PHP ID0/000 incluido en esta suite. Inventario444/2158 con nombre/1130 callbacks/3 firmas;444 hashes y anchors de ambos ledgers actuales, Node --check y git diff --check correctos. Backend97 regresiones nuevas frente al full1334 anterior; frontend no modificado en este lote y no se acredita nueva ejecución de su suite. S01–S13 y objetivo global abiertos; siguiente extracción admisión final TOTP/recovery según plan. CI billing permanece externo pendiente. No DB local, migración, proveedor, worker/scheduler, commit/push ni despliegue.
