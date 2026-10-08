# O71 — Ledger parcial S07/S13: creación de tokens y contexto

Código completo TS/HTML/SCSS de Tokens y TokenController leído. Métodos seleccionados de ApiService (mutationGuard/mutate/retryOnRejectedCsrf), WorkspaceService (select/currentRole/selectionGeneration), SessionContext, LatestRequest y decoders conciliados. Rutas token GET/POST/DELETE exigen verified+editor; permisos write de public API incluyen eliminación/restauración según endpoint. No se completa S07 ni todas las dependencias por este lote.

19 rojos históricos con Auth/Api/interceptor/HTTP reales simulados;35 controles nuevos y13 anteriores conservados. La primera versión del foco añadió dos defectos de retorno, reproducidos y corregidos con query ElementRef explícita. Primer intento de reparación no compiló (sobrecarga viewChild);0casos no se cuentan como bug histórico.

## frontend/src/app/panel/tokens/tokens.component.ts

SHA-256: `527eb6bb96fa57e5df665032b4cd15a74006b8ea299be97280496260cdadc77e`.

| Función | Línea | Revisión / límite |
| --- | --- | --- |
| `contextKey` | 119 | Pregunta viva: workspace/selectionGeneration/rol, generación de sesión/id/verificación/MFA. La generación numérica se consulta sin cachearla en computed. |
| `currentView` | 125 | Lifetime, capability de UI y contexto renderizado antes de admitir comandos/reads. |
| `constructor` | 129 | Effect retira proyección/borrador/credenciales/tickets ante contexto nuevo. Deadline reutiliza ReadDeadline fuera de zona, conserva límites y microsegundos O63; cleanup y secreto al destruir. |
| `load` | 175 | Read propio cancelable, pregunta viva antes de publicar/finalizar. Retiene filas ante fallo; ACK local de revocación no pierde autoridad por lectura retrasada. |
| `openCreate` | 198 | Creación bajo demanda, guarda secreto no reconocido/operación incierta y foco tras render. |
| `cancelCreate` | 205 | Borra credenciales/borrador y devuelve foco; advertencia incierta persiste para no dejar CTA bloqueado sin recuperación. |
| `clearDraft` | 214 | Reset de inputs; sólo para cancelar/cambiar contexto. ACK limpia campos enviados sólo si no cambiaron. |
| `finishIssued` | 219 | Acuse explícito retira secreto, tickets de copia y feedback. No nuevo comando backend. |
| `acknowledgeUnconfirmed` | 228 | Sólo tras lectura fresca correcta y decisión explícita; no afirma recuperar secret perdido. |
| `focusOrigin` | 235 | Captura control activo al iniciar interacción, antes de desmontar sección. |
| `focusAfterRender` | 239 | Queries con read:ElementRef explícito (Material devuelve componente por defecto). No roba foco a quien ya eligió otro control ni a otro contexto. |
| `expiryError` | 249 | Strict local datetime; deadline futuro/hasta un año revalidado con reloj vivo, server validExpiry conserva autoridad. |
| `canCreate` | 260 | UI verified/editor+, exclusión única crear/revocar, secreto/resultado incierto, nombre Unicode/scope allowlist/bytes password-factor y fecha. No sustituye validación backend. |
| `toggleScope` | 270 | Selección reversible por checkbox; canCreate valida allowlist/duplicados antes del transporte. |
| `create` | 274 | Captura payload/ticket/contexto antes del await; no aborta ni reintenta write. ACK retira read anterior, limita ventana100, entrega secreto independiente y conserva draft posterior. Feedback refresh propio. 0/502 se describen como incierto y requieren read+acuse. |
| `expiresAtIso` | 323 | Instante local estricto, null sólo sin fecha; canCreate verifica rango en admisión. |
| `revoke` | 330 | Captura intención antes de diálogo; revalida cuenta/rol/selección/lifetime/fila/lectura/slot al resolver. Ticket evita finally anterior. ACK conserva row como historial con overlay confirmado y GET, sin inventar timestamp; secreto revocado se retira. |
| `copyPlain` | 365 | Copia con ticket/contexto/secreto propio; single flight, feedback local, manual fallback y no publicación tardía. |
| `isRevoked` | 382 | Revoked_at servidor o ACK local confirmado; prioridad sobre vencimiento. |
| `trackByToken` | 386 | Identidad de fila por id; backend garantiza ids distintos. |
| `refreshClock` | 390 | Estado UI al volver a pestaña y próximo expiry; no HTTP polling ni autoridad de autenticación. |
| `state` | 395 | O63 conservado, ACK de revocación prioritario, Date.now vivo; no backend admission claim. |

## backend-laravel/app/Http/Controllers/TokenController.php

SHA-256: `c83f1df0b48d80ac1fdd1342a86d81e18589e407f8bb34936c54fcf5cc8e7cba`.

| Función | Línea | Revisión / límite |
| --- | --- | --- |
| `index` | 32 | Cuenta100 más recientes, incluidos revocados. Revocar no hace aparecer la página siguiente: copy anterior corregida. GET requiere verified+editor por rutas. |
| `store` | 45 | Contrato nombre/scopes/password/factor/rango; SecurityContext y WorkspaceAccess editor bajo TX, revalida expiry tras step-up; cap y notice durable; 201 plain sólo tras commit. Lectura de código, sin nueva DB/gate backend. |
| `destroy` | 184 | Cuenta/workspace/editor bajo TX, conserva revoked_at e historial. Cliente solicita GET después de ACK. |
| `validExpiry` | 219 | now<expiry<=addYear(now), varias revalidaciones alrededor de operaciones lentas; cliente sólo prevalidación. |
| `dto` | 226 | Sólo metadatos; GET no devuelve secreto. Un DTO inválido de creación puede dejar credencial emitida sin secreto utilizable. |
| `iso` | 239 | Formateador IsoDate compartido; no cambio de precisión. |

Plantilla/SCSS: registro primero, form por acción, cancelación, Enter, permisos humanos con consecuencias, fechas localizadas, autenticación al final y secreto separado con acuse. Progress/última lectura conserva registros y desarma decisiones. Reveal220ms y reduced-motion; código CSS reducido respecto a fuente previa. Componentes Material redundantes eliminados; deadline compartido, no nuevo helper paralelo.

E2E token-lifecycle conserva contrato Bearer/revocación; sólo adapta apertura y label. No se ejecuta aquí porque requiere cuentas y backend; lint comprueba fuente y QA local usa únicamente API ficticia. Global S01–S13 y release/operación abiertos.

ACK y confianza: dos casos adicionales reproducen una regresión de la implementación (no histórica). Crear una credencial no valida un GET fallido/cancelado; registro conserva error/aviso y bloquea revocaciones hasta GET propio correcto, con nuevo token/secreto disponibles.56dirigidos y1696frontend finales; QA45 estados en build final, cinco comandos ficticios.

Pendientes de revisión S07: contrato de cuerpo del DELETE y recuperación de proyección de usuario tras respuesta incierta de emisión que pudo consumir factor de recuperación. Son candidatos de código, sin nuevo BugID/reproducción/afirmación de bypass en este lote; revisar en continuación. No atribuir cancelación del efecto físico de una copia ya solicitada a un guard de feedback.


## O72 — Revisión posterior del ACK (fuente actual)

El contrato de DELETE pendiente de O71 queda reproducido/corregido en B256; el snapshot previo tras write incierto, en B257. La tabla yhash O71 son históricos. TS actualSHA256 `c48e67dae6276cd563fcb9448b15be1c4dbe30d0c44d7552f551381aed2c4307`; HTML `133657bf00ff8d2d58bef2e911ffb28d1fd200070336fb7ed4db3c2b4dfafb06`. Lectura por función de create/requireRegistryRefresh/revoke/load, transporte/decoder y controlador: `2026-10-08-token-revocation-ack.md`. No cambio backend. Proyección de usuario/factor y secreto tras lectura de revocación siguen candidatos; no completar S07 ni dependencias.


O73 resuelve candidatos de proyección/factor ysecreto con B258/B259. Hash/líneas actuales ylectura por función en2026-10-08-stepup-account-projection.md; tablasO71/O72 históricas. S07/S01/global abiertos; no gate backend real nuevo.
