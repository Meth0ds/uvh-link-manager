# O97 — Perfilado de recuentos operativos

Plan previo a cambios de producto. Ejecutar sólo después de proceso QA O96 terminal y cierre de sus recursos. Continúa fases5/6 del objetivo global; no supone cerrar el resto del proyecto.

## Lectura confirmada

OperationsController::metrics hace nueve consultas count por estado de mail_outbox y cuatro por estado de webhook_deliveries, además de MIN de antigüedad. AdminController::operations ya agrupa esos counts con countsByState. QueueBacklog hace dos consultas por cada pool con broker DB, pero su camino Redis tiene contratos y estructuras diferentes. Conservar el guard de bearer antes de cualquier lectura, orden de métricas, ceros, headers/no-store, estado desconocido, máximos/sumas por pools, tiempos y nombres publicados.

## Medición y elección

Un agregado único puede empeorar una tabla histórica grande si fuerza heap scan en lugar de rangos/index-only. Comparar baseline con GROUP BY de counts (sin tocar MIN) y con agregados FILTER combinados con MIN; EXPLAIN(ANALYZE,BUFFERS), índices actuales, tres volúmenes, distribución histórica dominante y activa dispersa. No añadir índices por intuición ni cachear salud. Si el ahorro de consultas empeora el trabajo total sin beneficio compensatorio, no adoptar esa variante. Separar DB driver de Redis; no presentar mínimos de scores de delayed/reserved como timestamps de creación.

## Pasos

- [ ] Leer completo controlador/helper/consumidores y contratos HTTP/QueueBacklog actuales; revalidar proceso O96 terminal. Registrar entorno DB propio/fakes sin servicios compartidos.
- [ ] Fixtures vacíos, estados mixtos, históricos dominantes y tres volúmenes; registrar SQL/resultado/catálogo de baseline y alternativas, un perfil a la vez.
- [ ] Elegir sólo cambios con beneficio demostrado; empezar por counts por tabla, conservar MIN separados si mantienen selectividad. Medir edades por separado con clock reproducible y distinguir time() de Carbon::now().
- [ ] Textos Prometheus y cabeceras iguales, zero/defaults/guard inválido sin consultas, tipos y brokers DB/Redis. Cualquier mejora de QueueBacklog requiere contrato específico y no inferir lectura Redis de pruebas con jobs DB.
- [ ] Tests afectados, regresión/format/PHPStan y freeze adecuados; ninguna edad ni alarma perdida para aparentar menos consultas.
- [ ] Comparación final, límites y cleanup de recursos propios verificados; inventario/plan global. Resto de SQL/jobs/render/infra y matriz funcional sigue pendiente.

## Ejecución retomada —10/10, después de O103

O96/O99 cerrados, sin contenedores propios antiguos; Docker29.8.2 confirmado. Fuente actual542backend/417frontend revalidada. Turno previo clasificado como progreso: O102/O103 modificaron producto y quedaron con gates terminales; no era una espera.

**Archivos:** harness propio .uvh-runtime/o97-operation-counts/{setup.py,run.py,profile.php,resources.json,profile.json,profile.log}; si medición justifica adopción, modificar únicamente OperationsController.php y añadir OperationsSnapshotCountsTest.php. Reutilizar runner privado anterior tras leerlo; copia congelada, vendor/repo read-only, PG16.15/PHP8.4.25 fijados por digest, red interna sin puertos y volumen con propietario o97-operation-counts. Nada de uvh_local, launcher compartido, env reales ni outbound.

**Perfil:** esquema real migrado; vacíos y1k/10k/100k filas en distribución uniforme,99,5% terminal y100% pendiente. Cada dataset se mide después de VACUUM ANALYZE y después de UPDATE del10% sin vacuum, para contrastar index-only con churn. Comparar counts individuales+MIN existente, GROUP BY+MIN existente y agregados FILTER con MIN condicionado, normalizando a estados publicados.16 repeticiones calientes con orden rotatorio, mediana/p95 y EXPLAIN(ANALYZE,BUFFERS,FORMAT JSON) por consulta; SQL, índices/configuración y resultados preservados. No limpiar caché del host ni llamar frío al primer resultado. Runners propios seriales sin build/tests concurrentes.

**Elección:** lectura de correo y entregas es global/autorizada con bearer antes de SQL. Escoger por cada tabla la alternativa que ahorra consultas y trabajo medido, evitando escaneo histórico adicional para MIN si los índices selectivos lo hacen barato. Si una alternativa empeora claramente el coste en datasets importantes, descartarla o conservar el camino anterior; no añadir caché ni índices sin prueba. Edades Redis siguen separadas y pendientes.

**Contrato para adopción:** baseline/adoptado sobre mismos fixtures, texto Prometheus completo y cabeceras idénticas. Anclar time() mediante función namespaced de fixture, Carbon fijo para cortes, Http/Queue/Mail fake; confirmar edad de trabajo pendiente/futuro/compensación, ceros y conteos globales de múltiples tenants. Guard ausente/erróneo/configuración vacía no hace ninguna consulta. SQL count por tabla y fresh sample tras insert/update comprueban ausencia de caché. Ejecutar red/green, dirigidos, Pint/PHPStanlevel6, fullbackend propia y freeze/inventario; cleanup por IDs/labels/mounts verificados sólo tras terminal. No marcar fases globales completas.

### Decisión intermedia del perfil

Primer perfil38casos terminal0, resultados exactos. FILTER+MIN ahorra un recorrido completo de entregas; GROUP+MIN conserva dos y no aporta allí mejora suficiente. En mail99,5%sent/100k/visibilityvacuum, FILTER+MIN fuerza9097bloques contra612baseline y mediana25,903ms contra7,599ms: descartado como sustituto universal. GROUP+MIN mantiene592bloques pero8,312ms y dos consultas; necesita contraste con una cuarta variante: **un SELECT de subconsultas escalares COUNT por estado y MIN**, usando los mismos índices/WHERE del baseline en una instantánea y una ida a DB. Segunda captura añadirá esa variante; no se adoptó producto todavía. Repetir comparación bajo autovacuum desactivado únicamente para ambas tablas test durante captura y restaurado después; medir sólo caliente y registrar dispersión, no prometer latencia productiva.
