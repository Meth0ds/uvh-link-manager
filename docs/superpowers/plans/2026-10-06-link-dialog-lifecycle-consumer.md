# Consumidor frontend de fechas de enlaces

**Goal:** continuar el objetivo completo S01–S13 y comprobar que una edición ajena a las fechas no cambia su instante ni bloquea el formulario por su representación a minutos.

**Architecture:** cambios graduales en el consumidor real. Conservar autoridad de workspace, generación, versión, alias/password PATCH, validación estricta, carga de reglas y cierre del diálogo. No reformular todos los controles ni introducir biblioteca de estado. El backend O59 conserva seis dígitos al fusionar campos omitidos y responde DTO UTC milisegundos; el input datetime-local representa minutos.

**Spec:** plan maestro e informe O59. Corrección nativa ygates frontend completados O60; QA visual aislada completada en O61 junto al rediseño solicitado. Después retomar despacho auxiliar bajo TX exterior/CSV del plan `2026-10-06-link-lifecycle-dates-and-auxiliary-commit.md`. La auditoría no se reduce a estas dos fronteras.

## Entrada y restricciones

- [x] Full O59 handle2405 terminal exit0:2714/22466; JUnit0errores/fallos/omitidos,2599identidades retenidas más115/466. Gate íntegro backend actual pasa;815/816hashes coinciden. Cambio concurrente de usuario sólo controlS13,16/19comparadores verdes y tres rechazos correctos, registrado sin cambiar hashes históricos. Backend/frontend/tests/config no tienen drift; se puede reproducir el consumidor independiente tras terminal.
- [ ] Reconciliar por separado la herramienta controlS13 modificada por el usuario y los gates globales que señalan su drift (O59tres;O60dos tras refrescar inventario yprobar fuente del consumidor); no sustituir sus hashes para fabricar verde. Esta revisión sigue dentro del objetivo, aunque no es dependencia del formulario ni de la suite SQL terminada.
- [x] Revalidar árbol compartido y snapshot propio de consumidor/tests/modelos/decoders/plantillas. Conservar cambios y servicios del usuario. Sin uvh_local/cuentas/correo/providers/worker/scheduler productivos/migraciones externas/commit/push/deploy/agentes/worktrees. PHP destructivo sólo testing/*_test.

## Fuente y reproducción

LinkDialogComponent602líneas y funciones datetime de strict-wire leídas completas en O59. `patchFromLink` proyecta fechas a minutos, `save` reenvía ambos campos siempre y `lifecycleOrderValidator` compara sus proyecciones. `applyTemplate` sustituye fechas programáticamente sin marcar necesariamente dirty; no basar la intención únicamente en pristine/dirty. Reproducidos O60:B202/B203,13fallos/5controles antes de producto.14transformaciones exactas y25casos nuevos; fuente actual646líneas. Los candidatos de despacho/reglas mantienen su reproducción independiente pendiente.

- [x] Leer completos spec actual, modelos/decoders de link y consumidores de templates/rules; releer cuerpos actuales antes de editar. Revisar HTML/SCSS para errores, accesibilidad, foco y estados del formulario.
- [x] Reproducir con componente y transporte reales de tests la edición sólo de notas cuando fechas tienen segundos/milisegundos: los campos no editados deben quedar omitidos en PATCH y el backend mantiene su precisión. Probar ventana válida cuyo inicio/fin caen en el mismo minuto, conservación de fechas pasadas durante edición y creación futura. Rojo antes de fix/ID.
- [ ] Añadir controles de edición explícita, clear/null, un campo cambiado y otro preservado, aplicar plantilla y revertir valores. Una plantilla seleccionada puede tener segundos diferentes dentro del mismo minuto: la intención debe conservarse aunque el texto visible coincida. Mantener rechazo calendario inválido, orden verdaderamente invertido, reglas inválidas, versión ausente, workspace cambiado, respuesta tardía y doble envío.

## Corrección y gates

- [x] Si hay rojo, corregir intención/validación en el consumidor mínimo: conservar fechas originales cuando no se editan, enviar null al borrarlas y valores nuevos al elegirlas/plantilla. Mantener el instante original separado de la proyección para que la validación no invente un conflicto; no relajar validadores globales ni fingir precisión no disponible en DTO. La validación final de pareja permanece en backend.
- [x] Regresión/frontend full, tipos/lint/build y comparación íntegra de fuente/test con aserciones anteriores conservadas. Browser aislado con respuestas simuladas explícitas, teclado/foco y viewports/claro-oscuro pertinentes para los errores afectados; no usar cuentas reales ni el puerto4200 del usuario para entregar datos de prueba.
- [x] Actualizar inventario/ledgers/matriz/informe y alcance explícito. Pendiente: continuar despacho auxiliar bajo commit exterior/CSV; reglas horarias de redirect capturan now antes del lock y necesitan su reproducción separada. Todas las otras funciones/roles/UI/diseño/optimización/retención/capacidad/CI/operación siguen abiertas según plan maestro.


## O60 — fechas del formulario y plantillas

B202/B203corregidos en el consumidor: fechas intactas omitidas en PATCH; plantillas conservan segundos/microsegundos y ventanas válidas se comparan por su instante.13rojos previos/5controles;2rojos adicionales por microsegundos antes de la corrección final.25casos nuevos,67regresión,1432frontend completo ytypes/lint/build exit0;817hashes post-terminal. Un componente completo con14transformaciones,107specs antiguos/HTML/SCSS/backend intactos. Ver informe O60 yplan de consumidor para evidencia/límites. QA visual aislada ydespacho auxiliar/CSV pendientes; cambios concurrentes de herramientas del usuario conservados,2gates de árbol completo correctamente rechazan su drift. Objetivo S01–S13 activo; ningún cierre global/producción ni ejecución de control compartido.

Control de versión ausente conserva la autoridad backend ysu payload original; no se atribuye nuevo rechazo GUI específico. Controles de edición/clear/revert/plantillas/orden/calendario/workspace/doble envío/wrong-id nativos yreglas/destrucción de specs antiguos pasan. La casilla de controles queda abierta para revisar cualquier frontera faltante durante QA, sin convertir comparación literal en una prueba nueva de todos los escenarios. Gates de source/test/tipos/lint/build/full completados; la casilla combinada de browser permanece abierta por ese requisito pendiente.


## O61 — rediseño del editor de enlaces y B204 (06/10)

Creación y edición rediseñadas conforme a la prioridad del usuario: cinco secciones, vista previa del recorrido, acciones visibles, altura estable, móvil y ambos temas. Cuatro archivos de producto; controles, contratos, reglas, plantillas y autoridad conservados. B204/P2 corregido: una ventana válida con microsegundos podía representarse con fechas iguales en el DTO y bloquear una edición ajena a las fechas. Sólo se conserva la igualdad de ambos originales intactos, que se omiten de PATCH; el backend mantiene su validación definitiva. Fechas nuevas/plantillas iguales o invertidas siguen rechazadas.

Rojo previo: 29 casos, 1 fallo y 28 controles, handle55918 exit1. Seis casos nuevos: 31 lifecycle, 44 dirigidos y 1438 frontend completo, handle50394 exit0 (10.534s / 9.838s de casos). Tipos66239, lint92456 y build12102 exit0. 817 hashes finales comprobados; 812 fuentes previas ajenas y 107 specs anteriores conservados. QA con Angular compilado real y API ficticia en memoria8436: creación/edición, desktop/móvil, claro/oscuro, tabs, foco/teclado, reglas/fechas/errores y conservación exacta de fechas de la fixture. Capturas y evidencia en `.uvh-runtime/s04-link-dialog-browser/report.md`; sin vídeo completo por ffmpeg no disponible.

Inventario estático499/2365named/1226anonymous/3firmas/0provisional, enumeración no equivalente a revisión. S04:71anclas/10archivos. Matriz185rutas conserva owners/status/contratos y amplía sólo tres celdas de evidencia. Prueba íntegra `.uvh-runtime/verify-link-editor-redesign.py` exit0. El comparador histórico O60 sigue rechazando el cambio concurrente del control del usuario; no se cambia ese digest ni se ejecuta el control. Backend2714/22466 sigue evidencia histórica O59, sin nueva suite SQL. Objetivo S01–S13 activo: siguiente despacho auxiliar bajo TX exterior/CSV; revisión de AuthService frontend, reglas horarias, S13, release/migraciones externas y demás sistemas pendientes. Ninguna escritura en DB/cuentas/correo/proveedores reales ni commit/push/deploy.

La casilla combinada de browser queda completada por O61. La casilla de controles amplios mantiene pendiente su frontera específica de versión GUI ausente; no se atribuye esa nueva prueba por inferencia de la autoridad backend.
