# O98 — Lectura de archivos CSV acotada y vigente

Plan previo; ejecución retomada mientras Docker está detenido. O99 sigue siendo prioritario y pendiente de su validación, sin reducir el alcance global. Continúa fases3/7 de optimización global. Ejecutar sólo con QA propio terminal, conservando contratos de importación y diseño existente.

## Fuente y problema

CsvImportDialogComponent::onFile espera File.text() y después publica csv/report/error/retryImport sin revisión de selección, contexto o destrucción. Lecturas pueden acabar en orden inverso; fallo de lectura no se maneja. Archivo se carga completo antes de aplicar el límite real262.144bytes (LinkCsvController::MAX_IMPORT_BYTES). El texto pegado también debe medirse en bytes UTF-8, no caracteres. El lector UTF-8 puede eliminar BOM inicial de tres bytes: preflight no debe rechazar entradas cuyo payload real estaba dentro del límite.

Importación real usa body y Idempotency-Key congelados tras409 o respuesta ambigua. Cerrar/cancelar frontend no demuestra rollback. targetWorkspace permite volver al mismo id deliberadamente según su spec; no cambiar ese contrato compartido como efecto secundario. Las lecturas de archivo sí requieren generación propia y dueño completo.

## Pasos

- [x] Leer componente, padre, API/decoders, File/Blob existentes y pruebas; fijar baseline. Reproducir archivo A lento/B rápido, error tardío, destrucción y contexto cambiado, y fichero grande que no debe leerse.
- [x] Introducir revisión/dueño de lectura y estado loading coherente con acciones; cancelar/desestimar lectura anterior y limpiar dueño. Error actual visible, error antiguo silencioso. No invalidar body/key de un import ajeno por una lectura tardía.
- [x] Preflight conservador acotado, respetando BOM UTF-8; comprobar payload UTF-8 resultante y texto pegado contra262.144bytes. Casos límite exacto/±1, BOM, CRLF, Unicode multibyte e inválido; mantener parser/capacidad y evitar leer archivos arbitrariamente grandes.
- [x] Mantener dryRun, informe por filas/import parcial, retry409 con mismo cuerpo/key y recuperación tras respuesta ambigua. Revisar cierre durante import real y reload del padre: no etiquetar como cancelado algo que pudo persistir ni perder resultado/frescura de biblioteca.
- [x] Pruebas de fallos/lifecycle y contratos existentes, calidad/build/regresión frontend pertinentes, snapshot de fuente. Medir lecturas omitidas de archivo excedido, sin inventar ahorro CPU backend ni leer ficheros personales.
- [x] Registrar comparación/límites/inventario y cerrar recursos propios. Modales diferidos, SQL/Redis/render/infra y matriz global siguen en alcance.

## Decisiones de ejecución 10/10

File.text no ofrece abort; LatestRequest evita publicación tardía, sin fingir cancelación física. Cada archivo leído está acotado a262147bytes (payload máximo más BOM), y el texto resultante se comprueba en UTF-8 antes de publicar o enviar. La comprobación evita TextEncoder para textos claramente pequeños/excedidos y acota la codificación restante. Textarea maxlength262144 no excluye payload válido porque los bytes UTF-8 nunca son menos que las unidades UTF-16. Mantener selección de otro archivo y edición mientras se lee, bloqueando validar/importar hasta terminar.

La vista pertenece a sesión, workspace, generación de selección y rol capturados. La generación de lectura impide que A tarde sobrescriba B o texto pegado. Guardar también resultados HTTP tardíos; no abortar POST ni presentar como revertida una importación enviada. Durante una escritura real se deshabilitan cierre manual/backdrop/Escape hasta su respuesta para que afterClosed entregue el recuento real; un cambio de sesión/contexto o destrucción invalida la vista y puede cerrar inmediatamente. La importación backend continúa con su contrato independiente. No cambiar targetWorkspace compartido.

## Cierre del lote frontend

44 casos nuevos;57 dirigidos y1969 integrales correctos. Tipos/lint/build producción y diff --check exit0. Red previo24casos/22fallos de lectura/contexto; red de frescura6casos/3fallos; correcciones verificadas. Modal Material real confirma bloqueo de Escape/backdrop durante POST y recuento al cerrar. Padre refresca al recibir resultado externo desconocido; cancelación manual0 evita lectura extra, contexto obsoleto/destruido no la inicia.

413hashes frontend sin cambios durante QA. Inventario independiente actualizado262archivos/1334funciones/697callbacks sin propietarios provisionales: sólo frontend, no reutiliza tokens PHP obsoletos. El inventario global pendiente de O99/PHP no se declara vigente. Sin DB/Docker ni servidor de QA retenido.

File.text no se invoca para fixture con metadata de1GiB; preflight permite como máximo262147bytes por lectura. Texto incierto codificado con asignación máxima786432bytes; strings claramente pequeños/grandes evitan TextEncoder. Esto demuestra trabajo omitido/acotado, no RSS medido ni latencia global. Build inicial860,94kB, sin atribuir ahorro de bundle a este lote. Evidencia .uvh-runtime/o98-csv-reads/verification-summary.json. Objetivo global sigue en progreso.
