# O90 — Perfil de consultas por autor de enlaces

Lote de fase5 del plan global. Empezar sólo después de cerrar las verificaciones y recursos propios O89. Lectura actual: `AdminController::users` cuenta enlaces no borrados por `created_by` mediante una subconsulta por usuario; `AccountExportDocument::rowSources` recorre todos los enlaces del autor ordenados por id y reutiliza ese scope en reglas, etiquetas y analítica. Las migraciones ya indexan memberships por user_id: no proponer ese índice de nuevo. No se ha encontrado índice de links por created_by en la lectura de migraciones; confirmar el catálogo real antes de decidir.

El objetivo es reducir trabajo de consultas observado, conservando cuerpos, conteos, orden, filtros, autor/tenant, enlaces borrados en exportaciones y controles de acceso. No convertir la exportación cursor en colección, ni cachear identidades/permisos. Ninguna ganancia está demostrada todavía.

- [x] Entorno propio `_test`, red interna, fuentes congeladas y catálogo de índices guardado. Capturar SQL y bindings desde los consumidores reales, incluido count separado del listado de admin; datos sintéticos deterministas sin correo/proveedores.
- [x] Baseline en al menos tres volúmenes: usuarios/enlaces pequeños, medianos y grandes; autores dispersos y un autor concentrado, enlaces vivos/borrados, empates de created_at, usuarios sin enlaces. Igual semilla y configuración por comparación. Registrar versiones/configuración, tablas/índices y ANALYZE.
- [x] EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) y muestras repetidas del listado admin (25/100, página inicial y desplazada, filtros) y lectura de exportación por autor/id. Separar ejecución inicial de repetida; registrar dispersión, mediana y percentiles descriptivos, lecturas y loops, sin extrapolar capacidad productiva.
- [x] Comparar alternativas en la base propia: índice completo por autor/id, índice parcial de enlaces vivos y, sólo si lo justifican los planes, reescritura acotada de la consulta. Medir bytes del índice y coste de inserts/updates/deletes representativos. No imponer índices ni planes al optimizador para fabricar resultados.
- [x] Adoptar únicamente una mejora con beneficio suficiente para sus costes. Si necesita migración: compatible y reversible, ensayar up/down, documentar bloqueo y aplicación operativa; no ejecutar sobre DB compartida ni desplegar. Mantener constraints e índices existentes.
- [x] Comparar resultados exactos antes/después (IDs, totales, autor, borrados, orden) y ejecutar pruebas HTTP/exportación/privacidad/MFA pertinentes; Pint/PHPStan y suite backend completa si se modifica producto. Cerrar recursos propios y registrar decisión implementada/descartada y límites.

Este lote no certifica la optimización de todos los listados, deep pagination, analítica ni jobs. Es una primera medición SQL que aporta evidencia para priorizar las unidades restantes.

## Evidencia inicial O90

O89 cerrado antes de admitir carga SQL; los recursos O89 se retiraron. DB exclusivauvh_o90_test/red interna/volumen propio, fuentes522 congeladas. Catálogo168 índices confirma ausencia de links.created_by y presencia deidx_memberships_user; PostgreSQL16.15/shared_buffers128MB/work_mem4MB/parallel2/fsync+synchronous_commiton, sin relajar durabilidad.

Captura de SQL desde AdminController::users (dos SELECT:count ylista) y cursor privado real de AccountExportDocument::rowSources. Fixtures100usuarios/1000links y1000/50000 ya capturados/perfilados; autor1 concentra25%,20%borrados,10%usuarios sin enlaces, ties/filtros. Doce casos porvolumen,8 muestras porSELECT (primera aparte+7 repetidas); percentiles descriptivos, no cola productiva.

Hallazgo adicional: la proyección correlacionada paga contadores antes deOFFSET. Con100usuarios, página3/per100 vacía todavía ejecuta100 scans de links. Con1000usuarios/50000links, página3/per25 ejecuta75 scans y per100300. SQLexperimental acota usuarios primero y conserva las9 respuestas admin byte-equivalentes; scans25/100 y medianas de páginas profundas286.354→78.745ms /637.181→380.697ms. Primer25:82.443→85.937ms en estas muestras (registrar dispersión/repetir; no ocultar coste de primera página). Exportadores no cambian. No se ha editado la consulta productiva ni adoptado índice. Volumen10000/500000 en preparación; no comenzar candidato de escritura ni segundo DB job mientras el handle propio siga vivo.

Artefactosruntime o90-link-author:catalog-before.json,postgres-config.json,capture-*,explain-*,seed-*. Los scripts experimentales no son código desplegado. Antes de adoptar: tres volúmenes, comparación de alternativas/bytes/coste de escritura/resultados, mapeo a implementación real y regresión final.

## Implementación adoptada, regresión integral en curso

Tres volúmenes comparados y tres índices alternativos en grande/mediano. Decisión: completo `(created_by,id)` sin INCLUDE, más página derivada antes de contadores. Parcial pequeño no beneficia exportaciones con borrados; cobertura ocupa más y añade WAL, sin justificar otro índice ni su mayor tamaño para esta carga. Costes y operación en `docs/link-author-index-runbook.md`.

Captura de código final, no sólo SQL experimental: 27 respuestas admin byte-equivalentes y 9 streams de exportación iguales; count y SQL de exportación permanecen iguales. Medianas small/medium/large first25:0.394/2.379/20.373ms; page3per100:0.062/1.684/5.000ms. Baseline correspondiente:2.002/82.443/1043.800 y7.333/637.181/7297.469ms. Loops grande300→100 y página vacía pequeña100→0. Son tiempos SQL locales descriptivos, no latencia de la web.

Migración concurrente real up/down/up:168→169→168→169, resto del catálogo igual e índice válido/preparado. Contrato HTTP/export nuevo antes del cambio3/96; después296/2803 dirigidos. Pint final526 archivos. Formato de prueba sincronizado antes del freeze524 final. PHPStan/suite final/inventario siguen por inspeccionar; último checkbox abierto y recursos vivos. Suite usa segunda DB `uvh_test` en el mismo PostgreSQL propio para conservar el guard exacto de email-change-probe, sin tocarlo. Ninguna DB compartida.

Diagnósticos preservados: primer ensayo de escritura emitió error de sobrecarga generate_series aunque PHP terminó0; se añadieron casts y validación JSON estricta y se repitieron cuatro variantes desde semillas nuevas. Los tres contratos iniciales tenían un estado inexistente y un autor nullable incompatible con constraints; se corrigieron los fixtures a paused/autor obligatorio, sin relajar schema ni assertions. Los resultados válidos son los artefactos posteriores, no esos diagnósticos.

## Cierre O90

Pipeline final21645 terminalexit0:2797 pruebas/23135 assertions,2796 pasan y1 skip. PHPStanlevel6 app sin errores; Pint526; contrato formateado3/96. Skip confirmado mediante caso concreto y `--display-skipped`: SsrfTest::test_assert_safe_url_accepts_public_host, «Sin resolución DNS en este entorno». No se quitó la assertion ni abrió la red para fingir cobertura exterior. Duración11:25.966/memoria147MB describen el runner, no capacidad productiva.

Freeze524 actual sin deltas y521 hashes del inventario válidos. ContenedorPHP retirado al terminar; PG, volumen y red O90 eliminados tras confirmar identidad/mount/labels de volumen y red. Evidencia/logs conservados. Summaryruntime actualizado completo para este lote, objetivo global activo. O91 puede empezar sobre otra DB/red propia; no hay deploy ni migración en DB compartida.
