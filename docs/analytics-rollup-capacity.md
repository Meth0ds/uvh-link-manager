# Capacidad y contención de los rollups analíticos

Contrato revisado el **14 de septiembre de 2026**. Este documento cierra la
pregunta abierta en `F17/F18`: si la fila diaria de `metric_rollups`
(`link_id + day`) serializa a los workers de `analytics` hasta convertirse en el
techo del pool. No es evidencia de capacidad productiva; es el mecanismo, medido
y repetible, más el inventario explícito de lo que no acredita.

## El mecanismo bajo sospecha

`AnalyticsService` escribe cada clic en tres sitios dentro de la misma
transacción: un `insertOrIgnore` de la fila del día, el `click_events` del
evento y el agregado único de visitante. El rollup se actualiza con
`lockForUpdate()` porque el `update` no sólo suma contadores: recorta los mapas
`jsonb` a `MAX_MAP_KEYS`, y ese recorte no se expresa como un `UPDATE ... SET
x = x + 1` atómico. La clave es `(link_id, day)`, así que la serialización
—cuando aparece— es **por enlace**, no global: lo que duele es un alias viral
encolando tras de sí al resto del pool.

Dos hechos que acotan el problema antes de medirlo:

- `docker-compose.production.yml` define **un solo** `queue-analytics`. Con
  `queue:work` secuencial, el cuello de botella del despliegue actual es el
  proceso único, no la fila.
- La analítica es deliberadamente no autoritativa
  ([`redirect-and-webhook-availability-policy.md`](redirect-and-webhook-availability-policy.md)):
  si el rollup se retrasa, la redirección sigue sirviéndose. Un techo aquí es un
  problema de frescura de métricas, no de disponibilidad.

## Método

El ensayo vive en `frontend/e2e/async-stack.mjs` (`analyticsContentionDrill`) y
corre dentro de `npm run e2e:async` sobre la topología real de colas (Redis,
PostgreSQL, un worker por clase). Cada pase:

1. vacía el pool y **comprueba** que estaba ocioso antes de empezar;
2. fija un volumen y varía una sola cosa —una fila o ocho, un worker o cuatro,
   `fillfactor` 100 o 70—;
3. mide el drenaje y asevera en todos los casos que cada clic aparece
   **exactamente una vez** en `click_events`, en el rollup diario y en el
   contador visible.

Los pases se **intercalan** dentro de cada ronda y se comparan por mediana: un
primer pase en proceso frío y un último en proceso caliente se atribuirían de
otro modo al knob que se está variando. Hay dos orígenes de carga:

- **arrival**: clics admitidos por el redirect público, que es lo que ocurre en
  producción;
- **flood**: jobs encolados directamente sobre enlaces elegidos, porque en esta
  pila el redirect local es más lento que el worker y con `arrival` el backlog
  nunca llega a formarse.

El drill restaura al terminar un worker por pool, la topología que documenta el
compose. El `fillfactor` se reescribe a 100 después de cada pase que lo varía:
es preparación de la medición, no un cambio de esquema.

Knobs: `UVH_ASYNC_ANALYTICS_{ROUNDS,REQUESTS,CONCURRENCY,FLOOD,LINKS,LOW_WORKERS,HIGH_WORKERS,FILLFACTOR,SAMPLE_MS}`.
`UVH_ASYNC_DRILL_ONLY=1` levanta la pila y corre sólo el ensayo.

## Corrida de referencia

8 enlaces, 240 peticiones por pase `arrival` (concurrencia 24), 1.200 jobs por
pase `flood`, 3 rondas, `fillfactor` 70. Registro completo:
`52/52 checks passed`.

Mediana de drenaje por pase (ms, 3 pases cada uno):

| Pase | Workers | Filas de rollup | Mediana | Rango observado | clics/s |
|---|---|---|---|---|---|
| `arrival hot` | 1 | 1 | 5.560 | 4.499–5.681 | 42–53 |
| `flood hot` | 1 | 1 | **12.014** | 11.467–16.797 | 71–105 |
| `flood hot` | 4 | 1 | **4.755** | 4.487–4.996 | 240–267 |
| `flood spread` | 4 | 8 | 5.211 | 4.751–6.240 | 192–253 |
| `arrival spread` | 4 | 8 | 4.972 | 4.650–6.566 | 37–52 |
| `arrival hot` | 4 | 1 | 4.693 | 4.686–6.089 | 39–51 |
| `arrival hot` + `fillfactor 70` | 4 | 1 | 4.904 | 4.595–5.001 | 48–52 |

En los 21 pases, las muestras de bloqueo de PostgreSQL (`lock-wait`, cada 500 ms)
registraron `blocked = 0` y `max_wait_seconds = 0`. Los pases `flood hot@1` son
los únicos que formaron backlog real antes de encolar (673–776 jobs).

## Lo que esto sostiene

- **El pool responde a más workers cuando hay backlog real**: 12.014 ms → 4.755 ms
  al pasar de uno a cuatro workers sobre la misma fila, con 1.200 jobs. La
  paralelización sirve, y el límite inmediato del despliegue actual es tener un
  solo `queue-analytics`, no el rollup.
- **No hay contención de fila medible a cuatro workers.** La diferencia entre
  `flood hot@4` (4.755 ms) y `flood spread@4` (5.211 ms) es *menor* que la
  dispersión entre rondas del mismo pase (4.487–4.996 y 4.751–6.240), y el
  sentido de la diferencia es además el contrario al que predeciría la
  contención. Con `blocked = 0` y `max_wait_seconds = 0` en el muestreo, el
  ensayo no puede sostener que el lock sea hoy el techo.
- **`fillfactor` 70 no mejora nada** (4.904 ms frente a 4.693 ms, dentro de la
  dispersión). No hay evidencia para cambiar parámetros de almacenamiento de
  `metric_rollups`.
- **La fidelidad se cumple bajo paralelismo**: 1.200 y 240 clics exactamente
  una vez en `click_events` y en el rollup, con el pool drenando a cero en todos
  los pases, con uno y con cuatro workers.

## Lo que esto no sostiene

- **Ninguna cifra de capacidad.** Los pases `arrival` (37–53 clics/s, planos con
  uno o con cuatro workers) están limitados por la ingesta del contenedor
  `app`, que sirve HTTP con el servidor embebido de PHP (`php -S`). Es una
  propiedad del arnés, no de la aplicación: no se puede extrapolar a
  `php-fpm` + nginx ni usarse para dimensionar nada.
- **No se ha ejercido el escenario que motivaba la pregunta**: un enlace viral
  real encolando clics *admitidos por el redirect* detrás de su propia fila. El
  `flood` sustituye esa llegada por un encolado directo, precisamente porque la
  ingesta local no genera el backlog. El mecanismo queda medido; la llegada real
  no.
- **Los contadores de `pg_stat_user_tables` no son evidencia de fidelidad.**
  Van muestreados y con retraso: la pasada de rollup leyó 1.141 y 1.192
  updates donde las filas del rollup probaban 1.200 clics. La aserción usa las
  filas, nunca el contador.
- **No hay cifra de producción.** Máquina de desarrollo, contenedores locales,
  8 enlaces y volúmenes que no representan una carga de release.

## Cambio aplicado: índices de retención

Independientemente de la contención, la retención por fecha sí tenía un defecto
concreto que no necesitaba medición: `UvhHousekeeping` purga `metric_rollups` y
`metric_unique_visitors` por `day`, y **ninguna de las dos tablas tenía un
índice que empezara por `day`**. `metric_rollups` sólo tenía
`UNIQUE (link_id, day)` —columna líder `link_id`— y `metric_unique_visitors` un
PK `(link_id, day, visitor_hash)`. El `DELETE ... WHERE id IN (SELECT id ...
WHERE day < ? LIMIT n)` recorría la tabla completa en cada vuelta, sobre las
mismas tablas que escribe el camino caliente.

La migración `2026_09_14_000001_index_analytics_retention_purges` crea los
índices que faltaban y `DatabaseSchemaTest` los asevera. Sobre una tabla con
historia hay que crearlos con `CONCURRENTLY`; ver
[`production-readiness.md`](production-readiness.md).

## Decisión

No se introducen buckets temporales, contadores en Redis ni agregación por lotes.
La medición disponible no justifica cambiar la arquitectura del rollup: el
mecanismo no muestra contención a cuatro workers, y el techo observado es del
arnés. La decisión queda **condicionada** a una medición con ingesta
multi-proceso (FPM detrás de nginx) y un enlace realmente viral admitido por el
redirect, que es el escenario que el ensayo actual no puede generar. Si esa
medición muestra el pool saturándose sobre la misma fila, las candidatas siguen
siendo las mismas y en este orden: subir workers, `fillfactor` (descartado ya
por esta corrida), y sólo después agregación por lotes.

## Reproducir

```powershell
Set-Location frontend
# Corrida de referencia (sólo el ensayo; CI nunca fija estas variables)
$env:UVH_ASYNC_DRILL_ONLY = "1"
npm run e2e:async
```

Los números de este documento provienen de esa ejecución, no de una estimación.
El script `scripts/benchmark-analytics-rollups.mjs` es la herramienta
independiente para medir un endpoint de analítica propio sin pasar por la pila
efímera; no sigue redirecciones y limita concurrencia y timeout.
