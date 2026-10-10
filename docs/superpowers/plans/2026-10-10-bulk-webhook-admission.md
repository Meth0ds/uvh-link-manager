# O99 — operaciones masivas y admisión de webhooks

La petición más reciente prioriza optimizaciones y refactorizaciones necesarias con impacto considerable. O97 (métricas) y O98 (lectura CSV) siguen pendientes y bajan de prioridad; el alcance global permanece activo.

## Contrato y diseño

Las operaciones masivas aceptan hasta 100 enlaces. Actualmente cada cambio repite advisory lock, recuento global del backlog y carga de suscripciones. Separar mutación de enlaces y admisión de sus eventos, dentro de la misma transacción de negocio, permite consultar esas invariantes una vez por lote y repetir el recuento sólo al llegar al límite, por si un worker ha liberado capacidad. dispatch conserva su API y delega en dispatchMany; no se mantiene caché entre llamadas/transacciones. La consulta de suscripciones sólo necesita id, config_version y events, no secretos ni URLs.

Conservar: bloqueo account/session/workspace/enlaces; autorización vigente del creador de webhook; orden enlace/evento/suscripción; UUID propio por evento compartido entre sus entregas o identidad externa estable; payload; límite workspace de 1000 pending/processing; fallo revierte enlaces, entregas, auditoría y respuesta idempotente; publicación exclusivamente afterCommit y recuperación del outbox. Lotes sin cambios no consultan admisión. Suscripciones no cambian durante esta operación: las mutaciones públicas de configuración toman el mismo lock de workspace. Los workers sólo pueden liberar capacidad mientras el lote admite, nunca elevar el límite. La API externa, las acciones y sus contadores no cambian.

La misma lectura de código detecta dos count de etiquetas por enlace alrededor de syncWithoutDetaching. El framework instalado devuelve las adhesiones realmente añadidas: usar attached elimina ambos recuentos conservando applied, versión y ausencia de eventos en no-ops.

## Ejecución y evidencia

- [x] Entorno PostgreSQL/PHP propio, sin puertos ni tráfico externo; baseline de operaciones reales, 1/20/100 enlaces y acciones representativas, con cola falsa, reloj fijo y cuerpos/estado/eventos normalizados.
- [x] Contratos de eventos múltiples, permisos, límites exactos, rollback, publicación afterCommit, no-ops y tags existentes/parciales; fallo previo de las nuevas expectativas de consultas.
- [x] Refactorización acotada de WebhookService y LinkBulkController, sin abstracción global ni migración.
- [x] Repetir las mismas capturas y verificar equivalencia funcional y consultas antes/después.
- [x] PHPUnit dirigido, Pint, PHPStan e inventario; suite backend integral serial sobre otra DB propia con revisión de skips.
- [x] Verificar hashes y terminales reales, cerrar recursos propios, documentar resultados y límites. No atribuir latencia o capacidad global a una reducción de consultas.

## Estado de ejecución

Implementación propuesta en WebhookService y LinkBulkController; 31 casos nuevos preparados en dos clases de PHPUnit. Captura reproducible de 37 escenarios preparada en .uvh-runtime/o99-bulk-admission: código previo preservado antes de editar y plan de comparación de respuesta, enlaces, etiquetas, entregas/UUID normalizados, auditoría, idempotencia y jobs. No hay caché de capacidad/suscripciones entre llamadas. La revalidación en el límite conserva la posibilidad de usar huecos liberados durante el lote.

Docker Desktop está detenido (socket /Users/roberto/.docker/run/docker.sock ausente, docker info falla) y PHP local no está disponible. Se solicitó al usuario que deje Docker en marcha. No se han creado contenedores, redes, volúmenes ni bases de datos de este lote; no se ha ejecutado PHP, PHPUnit, Pint, PHPStan ni perfilado SQL. Sólo se verificó git diff --check y la sintaxis Python del harness. Por tanto, O99 no está cerrado ni se declara ahorro medido. El lector estático indica 300→3 consultas de admisión en 100 cambios bajo capacidad, y eliminación de 200 recuentos de tags por 100 enlaces, pendientes de comprobación real. El inventario necesita regeneración después del refactor y no se presenta el hash anterior como vigente.

## Reanudación con Docker disponible

El usuario confirma Docker en marcha; servidor29.8.2. Se provisionó sólo red interna o99, volumen y PostgreSQL propios sin puertos. Fixtures de QA reparados tras ejecución: verified_at del dominio, estado terminal success y hash de token como session_id; la captura ahora exige resultado esperado real para cada caso. La comparación inicial de respuestas403 idénticas se invalidó explícitamente y se conserva como evidencia de harness, nunca como ahorro medido. Producto O99 no necesitó cambios por esos errores.

37 operaciones del controlador previo/nuevo conservan respuesta, enlaces, pivotes, entregas/identidad normalizada, auditoría, idempotencia y jobs; 100pause:814→517 consultas totales y300→3 de admisión;100tag-new:1321→824 y200counts eliminados;100tag-mixed:767→420;100tag-noop:317→117 sin admisión. No son mediciones HTTP/CPU/throughput. Los nuevos contratos fallan antes por20 API dispatchMany inexistente y10 expectativas de consultas; pasan después31tests/286assertions.188dirigidos/1825assertions,0failures/errors,1skipDNS; Pint534files/PHPStanlevel6 exit0. Inventario fresco522files pero1helper CSV necesita propuesta explícita de dueño; enumerar no acredita revisión completa. Suite integral2899tests en curso en otra DB propia; no editar fuente/tests ni cerrar recursos hasta terminal.

## Cierre verificado

QA56601 terminal0:2899tests/33624assertions,2898pass/1DNSskip,0errors/failures. El único skip SSRF tiene mensajeSin resolución DNS en este entorno, revisado en log y definición.31contratos/286,188dirigidos/1825,Pint534/PHPStanlevel6,37capturas equivalentes. Inventario522files/2525named/1383anonymous/3signatures/0provisional tras conciliar helperCSV(S04); hashes542backend y522inventario verificados. close79431 terminal0:PG685ea25e..., red02ea0437..., volumen propios eliminados tras validar labels, IDs, mounts, ausencia de puertos y red interna; búsquedas de recursos posteriores vacías. Ninguna migración nueva ni modificación de DBcompartida. Objetivo global y nueve fases siguen activos.
