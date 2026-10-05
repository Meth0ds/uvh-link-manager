# Autoridad de sesión en escrituras relacionadas con enlaces

O54 fue progreso: B186, estado explícito de registro/verificación, rojo/verde, contratos, suite frontend y QA aislada. La respuesta posterior a la pregunta sobre AuthController sólo comprobó su distribución actual; no sustituyó el objetivo global. Se revalidan805hashes de O54 antes de este bloque O55. Objetivo S01–S13 activo y alcance completo conservado. Trabajo secuencial; sin agentes, worktrees, commit/push/deploy ni cambios en uvh_local, cuentas, proveedores, mail, workers/scheduler o migraciones externas. Tests destructivos sólo testing/uvh_test, una suite SQL a la vez y sin ediciones mientras esté viva.

La lectura completa de WorkspaceMutation, WorkspaceAccess, SecurityContext, SessionManager/hydrate, UvhSession, UvhAuth, RequireWorkspace, RequireApiToken, UvhRequest y controladores de etiquetas/colecciones/plantillas/import muestra una frontera candidata: el wrapper sólo vuelve a comprobar cuenta/rol/token, no la sesión exacta del navegador. Los controladores Workspace ya usan SecurityContext. No asignar ID hasta reproducir por HTTP después del middleware, sin reemplazar la autoridad por atributos inventados. Las rutas de enlaces pertenecen a S04; el helper compartido se revisa también como autoridad S03.

- [x] Caracterizar las ocho operaciones HTTP (dos etiquetas, tres colecciones, dos plantillas, CSV), invalidando la sesión después del middleware y antes del candado de negocio. Conservar otra sesión válida para demostrar que se exige la exacta. Controles positivos y estados de negocio/audit/cola sin cambios para rechazos.
- [x] Si se confirma, asignar B187 y cerrar la frontera con SecurityContext en la misma transacción; mantener la rama bearer y cuenta → sesión → workspace → recursos. No debilitar roles, scopes, cuota, versiones, idempotencia ni callbacks/outbox.
- [x] Adaptar sólo fixtures antiguos que llamaban controladores sin sesión real, preservando sus aserciones y ventanas de concurrencia. Comprobar importación interrumpida entre filas y reintentos.
- [x] Ejecutar rojo/verde, regresión de consumidores/autorización, calidad y full backend con hashes congelados; inspeccionar todos los resultados terminales. Comparación íntegra de archivos/cambios declarados.
- [ ] Actualizar inventario, anclas S03/S04, matriz y registros canónicos. Continuar sistemas/gates pendientes; la corrección local no prueba el cierre global.

Los tests por hooks SQL serializan una intercalación concreta; no prueban todas las carreras entre procesos. Los límites de CI, capacidad, Redis/proveedores, retención y operación real permanecen abiertos. El candidato de igualdad exacta de expiración bearer queda independiente y sin ID/reproducción.


## O55: resultado comprobado antes de full

B187/P1 confirmado por HTTP/middleware reales:41fallos de producto antes de editar (31respuestas200,10respuestas201) frente a8controles válidos;49/277verdes después.40intercalaciones invalidan sesión al bloquear la cuenta y otra la revoca después de la primera fila CSV confirmada. SecurityContext exige sesión exacta activa/no revocada/generación/dueño/email verificado antes del workspace; API conserva su branch cuenta/token/rol/scope. Callback de negocio, audit genérico, versiones, cuotas, idempotencia, triggers/outbox quedan en su TX original.

Dos fixtures antiguas de llamados directos carecían de sesión:2fallos/51controles tras fix antes de adaptarlas; ahora crean/propagan su sesión nativa preservando todas las aserciones/intercalaciones. No son dos bugs nuevos ni motivo para permitir autoridad sin sesión. Comparación completa de tres archivos con transformaciones declaradas y802fuentes/tests/config ajenos intactos;806hashes actuales congelados.49casos nuevos y277aserciones,264/1630regresión de consumidores/autoridad en54.61s;Pint506/PHPStan0 exit0. Suite completa viva en handle81355, no editar fuente/tests hasta resultado terminal.

Inventario495/2283named/1180anonymous/3signatures/0provisional;S01/S02/S10 anclas intactas, S03 pasa a18/3archivos yS04 nuevo42/6archivos. S04distingue21anclas de recursos probados de21lecturas adelantadas LinkController/Bulk sin nuevo runtime/ID. Matriz185rutas intacta salvo8celdas de evidencia;no cambios de owner/status/runtime. Lectura adelantada completa LinkController/LinkBulk yfunciones LinkService::create/update/MfaStepUp conduce al siguiente plan `2026-10-05-link-write-session-authority.md`.

Un intento inicial de copiar inventario usó fecha01en vezde02y abortó después de guardar los snapshots PHP;805hashes ya estaban comprobados. Se copia el inventario correcto sin sobrescribir ni repetir tests. Error de path del harness, no producto. Pruebas anteriores O51–O54 mantienen digests exactos con tres snapshots preO55, yO55 prueba los cambios actuales;comparación AuthController/otras extracciones, baseline149/139 ytransportes permanece correcta. No nuevo run frontend, proveedores, retención, capacidad, CI ni operación productiva. Full yregistro final pendientes.


## O55: verificación final del árbol

Full terminal exit0,2266/19706,07:36.960/139MB;JUnit errores0/fallos0/omitidos0,time454.553995s.806hashes siguen intactos tras terminal;no source/test edits durante full. Comparación completa O55 ytodos los comparadores históricos/actuales mencionados correctos, anclas actuales/inventario/baseline intactos. Registros canónicos actualizados. La casilla restante incluye continuar objetivo global yno se cierra por este lote; el siguiente plan ya tiene lectura fuente yrequisitos concretos de reproducción. Matriz185rutas/8celdas sólo evidencia. UI/frontend/proveedor/producción no certificados nuevamente.

Verificador final de matriz: la primera heurística exigía @en acción ycontó180,omitiendo5Closure ya existentes. Se ajusta al esquema real de fila/Sistema ycomprueba185filas/nueve columnas/5Closure/8celdas de evidencia, sin modificar producto ni estados de matriz. No BugID;hashes fuente yfull permanecen intactos.
