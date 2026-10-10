# O95 — Editor de enlaces cargado al abrirlo

Plan previo a cambios de producto. Alcance de este lote: LinkDialogService y sus seis invocaciones en shell, dashboard, biblioteca y detalle. Los demás modales y moderación quedan para lotes posteriores; las nueve fases globales siguen activas.

## Baseline por fuentes y build

El servicio raíz importa estáticamente LinkDialogComponent y lo abre con MatDialog. El editor aporta52.731 bytes JS compilados al cierre estático de panel/dashboard/biblioteca/detalle. Cierres completos:1.157.376/1.091.263/1.167.447/1.104.684 bytes respectivamente. Incluyen dependencias compartidas y no se suman entre rutas; no equivalen a tráfico adicional ni prueban LCP. Stats de producción O94 y `.uvh-runtime/o95-link-dialog/graph-baseline.json` guardan la evidencia. WorkspaceDialog y cuatro diálogos secundarios siguen estáticos; renderer QR ya es diferido.

## Contratos

Conservar Observable<LinkDto|null>, create/edit, destino pendiente, configuración1000px/alto860/disableClose/autoFocusfalse, restauración de foco de Material y resultado sin clonarlo. Una carga pendiente pertenece al dueño de vista, sesión y selección de workspace (incluye A→B→A); no puede abrir tras navegación, destrucción o cambio de rol/contexto. Error de chunk debe avisar y permitir reintento, sin borrar destino pendiente ni fingir creación. La URL pendiente sólo se completa tras un resultado real vigente. No cambiar validación, límites, permisos ni backend.

## Ejecución

- [x] Leer servicio y todas las invocaciones; medir grafo de baseline y verificar O94 terminal antes de editar.
- [x] Introducir import dinámico tipado, compartiendo sólo la carga del módulo y permitiendo reintento tras fallo. Sin importar componente como valor desde consumidores.
- [x] Capturar contexto al pedir apertura y asociar DestroyRef del llamante; cancelar pendientes y descartar resultados antiguos. Revisar claim de URL pendiente antes de abrir, sin eliminar intención al cancelar.
- [x] Pruebas deterministas con loader controlado: carga sólo al solicitar, create/edit/configuración, cancelación/null, A→B→A, sesión, rol, navegación, destrucción/unsubscribe, fallo/reintento y reapertura.
- [x] Tipos/lint/regresión frontend/build terminal; medir grafo final con misma metodología, editor ausente de cierres estáticos y presente en borde dinámico. No atribuir latencia sin medirla.
- [x] Congelar fuentes durante QA, verificar hashes/inventario y cerrar recursos propios; actualizar plan global con beneficios y pendientes.

## Resultado y verificación

O95 cerrado. Import dinámico real del editor; sólo se comparte la promesa del módulo, no formularios/resultados. Fallo permite reintento y comunica error actual. Las seis llamadas pasan DestroyRef; apertura pendiente se cancela al navegar/destruir/cambiar sesión, identidad, rol o selección (incluye A→B→A). Resultados antiguos no navegan ni consumen intención. Claim de URL pendiente comprueba contexto antes de abrir y publicar error; cancelar conserva intención y permite reanudar.

34 casos nuevos.55 dirigidos y1.925 frontend integrales pasan; tipos/lint/build exit0. Tres integraciones usan import y Material reales, sin API externa: crear/guardar, editar/versionar, cancelar/reabrir y restauración de foco. Primer dirigido detectó una aserción de identidad incorrecta sobre wrapper DestroyRef: sustituida por prueba real de destrucción del dueño. DTO de integración completado conforme a LinkDto, sin relajar tipos/aserciones. 408 hashes de fuentes/521 inventario válidos; procesos terminales y puerto9985 libre, contenedor de inventario eliminado; sin DB creada.

| Cierre estático JS por pantalla | Antes bytes | Después bytes | Diferencia bytes | Suma gzip antes→después |
| --- | ---: | ---: | ---: | ---: |
| Panel | 1.157.376 | 935.032 | −222.344 | 299.342→252.714 |
| Dashboard | 1.091.263 | 865.492 | −225.771 | 288.867→241.244 |
| Biblioteca | 1.167.447 | 1.077.351 | −90.096 | 303.184→282.283 |
| Detalle | 1.104.684 | 1.004.934 | −99.750 | 293.240→269.519 |
| Admin, control | 963.142 | 963.407 | +265 | 256.933→257.482 |

Editor ausente de los cuatro cierres estáticos y presente en un borde dynamic-import verificable; chunk propio92.167bytes y dependencias necesarias se cargan al abrir. Diferencias de empaquetado compartido explican que el ahorro por pantalla no sea idéntico; no se suman esas cifras, ni son tráfico único de una navegación. Bundle inicial prácticamente igual860,93→860,94kB (estimación Angular192,62→192,69kB). No afirmamos mejora de carga inicial/LCP/latencia. Evidencia reproducible: `.uvh-runtime/o95-link-dialog/measure-graph.py`, graph-comparison.json y verification-summary.json. Otros modales, moderación, render y restantes fases siguen pendientes.
