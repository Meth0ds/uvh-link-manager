# O93 — Precarga de colecciones en listados de enlaces

Plan previo a modificar producto; siguiente oportunidad global por lectura del código. Comenzar después de que O92 sea terminal, fuente final verificada y recursos propios cerrados. No tocar scripts de control/panel independiente, DB compartida, proveedores ni deploy. Preservar DTO y funcionalidades.

Evidencia estática: LinkController index/trash precargan domain/tags, pero LinkService dto loadMissing añade collection en cada fila. Las otras tres llamadas DTO son de un solo modelo. Colecciones son belongsTo y se usan para collectionId/name en el wire.

- [x] Entorno test propio e interno, schema/fakes/freeze actuales. Dataset con20/100enlaces, colecciones compartidas/diferentes/null, dominios/etiquetas y filas de otro workspace. Capturar respuestas/SQL de index/trash y API pública con los mismos filtros/páginas.
- [x] Contrato de consultas por relación que falle antes: como máximo una consulta collections por página con ids y cero cuando no existen; cuerpo/total/página/nombres intactos. Guardar comportamiento baseline y verificar aislamiento/autorización existente.
- [x] Añadir collection a ambas relaciones precargadas; no borrar loadMissing de DTO para store/show/update ni hacer caché global de datos de otro workspace. Revisar todos los callers.
- [x] Comparar cuerpos, consultas/bindings/scope y coste en tamaños20/100. Medir transferencia y tiempos con muestras aisladas si aporta algo; no dar porcentaje de latenciaHTTP a partir sólo de consultas menos.
- [x] Gates dirigidas y regresión integral adecuados, Pint/PHPStan/inventario/fuente congelada y cleanup. Cerrar este lote sólo con evidencia terminal; objetivo global continúa con grafo frontend/SQL/jobs/infra/coverage.

Evidencia parcial09/10:18contratos HTTP green/9918assertions; baseline12fallos sólo de presupuesto y0errores.63comparaciones de cuerpo/status/content-type y restoSQL/bindings exactas. Shared100:104→5SELECT; mixed100:84→5; none100:4→4. Conteos de consultas del controlador, sin porcentaje de latencia.309dirigidos/11761assertions, Pint530/PHPStanlevel6/inventario521/freeze528 verificados. Último gate de regresión integral y cleanup todavía pendiente; sesión19478.

Cierre O93: sesión19478 terminalexit0. Suite2849tests/33243assertions,2848pass/1skipDNS,0errors/failures;09:18.669/149MB. Hashes528fuentes/copia e inventario521 verificados. Cleanup14310 terminalexit0 tras comprobar IDs, labels, mounts, red interna sin puertos y ausencia de PHP activo; PG/red/volumen propios eliminados. Evidencia conservada en .uvh-runtime/o93-link-collections/verification-summary.json. Objetivo global en progreso; siguiente lote O94 preparado.
