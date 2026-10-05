# O38 — Data export response consistency

Continuación del plan O36 después de B165–B173. Ejecución secuencial, árbol compartido preservado, sin agentes/worktree/commit. No completar el objetivo global por esta fase.

La fuente actual publicExport sólo emite stage no nulo con processing y failureReason no nulo con failed. Un processing recién creado puede tener stage=null; filas failed heredadas pueden tener failureReason=null. Fechas nullable y fechas de un terminal conservan historia; no inventar igualdad de readyAt/expiry/version ni autorización por DTO. Los seis estados vigentes son processing/ready/downloaded/failed/cancelled/expired; migración self-service cancela los requested históricos con reason confirmation_retired y añade failure_reason nullable. No requiere stage/failure en ninguna fila heredada.

1. Leer emisor, modelos/migraciones pertinentes, decoder, API error mapping, seis facade methods y callers completos. No acreditar un archivo a partir de búsquedas o lectura truncada.
2. Reproducir contradicciones de stage/status y failureReason/status en decoder y HTTP/API/interceptor/Auth reales; conservar positivos de cada formato vigente/legacy, null confirmado y stage processing=null. Controles de GET/history/request; los comandos ya enviados pueden haber confirmado aunque el decoder rechace. No auto-replay, rollback falso ni limpieza de owner posterior.
3. Sólo si el rojo justifica la corrección, validar relaciones en dataExport compartido con error genérico502 antes de publicación. Mantener los literales y nullable actuales; no devolver secrets ni rutas internas ni añadir restricciones temporales por conjetura.
4. Verificar callerSettings ante error y last known snapshot, recuperación GET, teardown y reemplazo legítimo de identidad (invalidarA→me headerlessB→workspacesB). TestStateFixture inicial es admisible, reemplazar user directamente no representa una transición legítima.
5. Dedicado/full frontend/lint/tipos/build; no browser nuevo si no cambia UI, y ninguna suite backend nueva por un TS decoder solamente. Si cambia DOM, QA aislada. Inventario/hash/anchors/matriz/reportes/planning después de gates; globalS01–S13/CI/operación/roles/retención siguen abiertos.
6. Después de caracterizar los seis contratos de exportaciones, preparar fase propia AccountDataExportService: transporte puro, Auth conserva generación/assertCurrent/returns/lifecycle/options/timeout/CSRF. Comparar cuerpos completos antes/después con única adaptación de expressionAPI. No mezclar extracción con cambio de contrato ni prometer ahorro de SQL/latencia.

No uvh_local/cuentas/mail/proveedores/workers/scheduler productivos ni migraciones externas. Suites DB una a una y no editar PHP/tests durante ellas. No restringir legacy para facilitar tests. Candidatos sin nuevo BugID hasta rojo material; fase B171–B173 requiere su full/JUnit final antes de editar tests de la siguiente.


Verificación local O38: pasos1–5 ejecutados. B174/P2 reproducido (16/37 rojo;19/65 con caller), corregido conservando nullable/legacy.41nuevos/155dedicado/1244full10,010sKarma9,353sexec,lint/tipos/build8,713s exit0. Inventario/anchors se concilian después de O39; no cierre global ni backend/DOM nuevo. Paso6 continúa en plan2026-10-04-auth-export-transport.md.
