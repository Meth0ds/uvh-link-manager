# Export observation in Settings — O35 implementation plan

> Ejecutar secuencialmente con executing-plans. Preservar autorización y árbol compartidos; sin delegación, worktree, commit ni confirmación adicional.

**Goal:** distinguir una exportación ausente confirmada de una consulta fallida y ofrecer una recuperación visible sin repetir comandos ni perder un resultado confirmado.

**Architecture:** caracterizar primero el contrato GET de Auth y la observación de Settings. El servidor sigue siendo la autoridad sobre exportaciones. Separar error/lectura conocida de exportStatus; mantener ownership de LatestRequest, polling y teardown. Decidir conservación del último snapshot y disponibilidad de acciones después de leer cada caller. No convertir un snapshot en prueba de autorización, ni un error de refresh en rollback de un write.

**Tech Stack:** Angular/TypeScript, TestBed/HttpTestingController/API/Auth reales, ChromeHeadless, agent-browser para el cambio de UI si se implementa. PHP/Docker sólo si la lectura descubre un defecto del servidor que requiere una corrección.

**Candidate evidence (sin BugID):** loadExportStatus visible captura un error y asigna null; exportShowsRequestEntry interpreta null como ausencia y ofrece Solicitar mi archivo. El montaje actual pide estado con notify=true; este dato se corrigió al releer el caller completo, antes de la implementación. El polling silencioso conserva el último snapshot y reprograma, una política distinta que debe mantenerse explícita. La lectura es parcial: aún falta revisar controller/admission/decoder/dialog completo y cada refresh/poll/caller antes de acreditar cobertura.

## Constraints
- No modificar uvh_local/cuentas/mail reales, providers, worker/scheduler, migraciones ni políticas de export/recovery/MFA por un defecto de observación UI.
- No hacer POST automático para recuperar observaciones. GET manual debe estar acotado, ligado a identidad y desmontaje.
- No representar 503/502/0 como export inexistente, descargada o cancelada.
- Polling silencioso: evitar toasts repetidos, conservar dato conocido y backoff; distinguir recuperación de estado y emisión de comandos. No crear un bucle infinito inmediato cuando el GET falla.
- Un comando confirmado conserva su confirmación aunque falle el GET posterior. No prometer que un 502 de write implica que no se ejecutó.
- No atribuir todo S02, provider/cookie nativa o operación real a pruebas locales.

## Task 1: leer y reproducir antes de cambiar producto
- [x] Leer funciones completas de Settings: montaje/cleanup, loadExportStatus/history, exportNeedsPoll, handlers/expiry timer, openDataExportDialog, cancel, selectors y template de export.
- [x] Leer Auth dataExportStatus/history/request/cancel/download/ack y decoders asociados; controller, admisión y shape/error del GET. Leer dialog completo, AsyncPoller y ownership para no confundir fallo observable con ausencia real.
- [x] Caracterizar con HTTP/API/interceptor/Auth reales: montaje GET503 y502/0, null confirmado, snapshot processing/ready→refresh visible fallido, polling silencioso fallido, recuperación GET sin POST, destroy/identity/lectura obsoleta. Recorrer después de request/cancel/download confirmados sin repetir comandos.
- [x] Ejecutar rojo material de render/estado; guardar controles y fallos. Asignar BugID sólo después de reproducir; distinguir fallo de consistencia/disponibilidad de autorización.

## Task 2: corregir sólo la observación confirmada
- [x] Modelar loading/error/conocido sin cambiar transporte público si no hace falta. Un GET fallido no escribe null como respuesta válida; sólo un GET validado puede establecer ausencia.
- [x] Añadir estado visible accesible con recuperación GET; conservar snapshot anterior si es útil, etiquetarlo como no actualizado y decidir acciones a partir de evidencia del contrato. Guardar cleanup/ownership y no filtrar datos entre cuentas.
- [x] Mantener polling y temporizador de expiración coherentes; no duplicar history GET ni crear reintentos de writes. Comprobar errors tras ACK confirmado y teardown de overlay.
- [x] Si se extrae otro transporte de Auth, hacerlo después del fix caracterizado en una fase separada: comparar cuerpos completos y preservar efectos/guardas. No mezclar un gran refactor con el nuevo estado UI.

## Task 3: verificar y registrar alcance
- [x] Pruebas dedicadas, full frontend/lint/tipos/build; backend sólo si cambió PHP y exclusivamente uvh_test, sin editar PHP/tests durante suite DB.
- [x] Aplicar agent-browser para DOM nuevo con fixture propia sin DB/proveedores reales. Verificar error/recuperación, teclado/foco y viewport móvil; cerrar sólo procesos propios, preservar navegador del usuario.
- [x] Regenerar inventario y rebasar/verificar ledgers, hashes y matriz. Documentar evidencia exacta y cualquier límite/incidencia de fixture.
- [x] Mantener objetivo y S01–S13 activos; funciones restantes, roles, retención/capacidad, operación/CI/providers siguen pendientes.

## Resultado local verificado
B164/P2 corregido:24 nuevos,122 dedicadas/1203full; lint/tipos/build11,909s, QA propia móvil/teclado/retención/foco.473hashes/353S01/16S03/63S10/80S02anchors; sin PHP/DB/providers ysin nuevo backend gate. Reporte O35 documenta errores, fixtures y límites. Transporte Auth adicional queda para una fase separada posterior a admisiones, no se extrajo en ésta.

## Next Step
Ejecutar2026-10-04-data-export-admission.md: primero cuerpos completos de export ysu autoridad/read/artefactos/eventos, candidatos sinID. Objetivo yS01–S13 activos.
