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

El ensayo vive en `frontend/e2e/async/analytics-contention.mjs` (`analyticsContentionDrill`) y
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

## Corrida de referencia con borde real (php-fpm detrás de nginx)

La corrida anterior limitaba los pases `arrival` a la ingesta de `php -S`, el
servidor embebido con el que la pila de ensayo sirve HTTP: el techo era del
arnés, no de la aplicación. `docker-compose.analytics-drill.yml` sustituye ese
servicio por un pool php-fpm detrás de nginx (`docker/php/Dockerfile.drill-fpm`,
`docker/nginx/uvh.drill.conf`) y el ensayo se lanza con
`UVH_ASYNC_EDGE=1` + `UVH_ASYNC_EXTRA_COMPOSE=docker-compose.analytics-drill.yml`.
Es una superposición del ensayo: CI nunca la usa.

El borde de esa superposición está fijado por digest como el resto de las
topologías (`nginx:1.31-alpine`, Alpine 3.24.2 con openssl `3.5.8-r0`). La corrida
de esta sección se midió cuando ese pin apuntaba a `nginx:1.27-alpine` (Alpine
3.21.3): el salto de línea cierra `CVE-2026-31789` y está verificado sirviendo una
petición FastCGI real por el borde, pero **no se ha vuelto a medir el techo**, así
que los números de abajo son de la base anterior. Como el borde es paso a paso, no
espero que el cambio mueva las cifras; decir que no las mueve sin medirlo sería
otra cosa.

8 enlaces, 600 peticiones por pase `arrival` (concurrencia 32), 1.200 jobs por
pase `flood`, 1 ronda, `fillfactor` 70. Registro completo:
`24/24 checks passed`. Todas las pasadas `arrival` admitieron por el borde
(`origin = http://127.0.0.1:8012`, `302` en 600/600).

| Pase | Workers | Filas | `firedMs` | Drenaje | clics/s drenados | Backlog al encolar |
|---|---|---|---|---|---|---|
| `arrival hot` | 1 | 1 | 124.086 | 8.247 | 72,8 | 0 |
| `flood hot` | 1 | 1 | 8.038 | **18.558** | 64,7 | 703 |
| `flood hot` | 4 | 1 | 8.452 | **8.751** | 137,1 | 0 |
| `flood spread` | 4 | 8 | 7.750 | **6.514** | 184,2 | 0 |
| `arrival spread` | 4 | 8 | 50.479 | 4.975 | 120,6 | 0 |
| `arrival hot` | 4 | 1 | 50.436 | 4.799 | 125,0 | 0 |
| `arrival hot` + `fillfactor 70` | 4 | 1 | 52.460 | 4.436 | 135,3 | 0 |

`blocked = 0`, `max_wait_seconds = 0` y `waiting_on_metric_rollups = 0` en todas
las muestras, igual que en la corrida anterior, y cada pase contó cada clic
exactamente una vez (`clickEvents = rollupClicks = clics`, `pending = 0`).

### Lo que añade

- **El caso viral real ya se admite y se mide**: un solo enlace, 600 clics
  admitidos por el redirect a través del borde, cuatro workers, una única fila de
  rollup. Drena en 4,8 s (125 clics/s) sin bloqueo muestreado y sin perder ni
duplicar un clic. Es el escenario que la pregunta original no había conseguido
generar.
- **Con workers sobre la misma fila, el coste de serialización es visible y
  acotado**: con el mismo backlog de 1.200 jobs, una fila y cuatro workers
  drenan a 137 clics/s frente a 184 clics/s repartidos en ocho filas. Sigue sin
  haber bloqueo medible, y uno solo worker drena a 64,7 clics/s: el techo
  inmediato sigue siendo **un único `queue-analytics`**, no la fila compartida.
- **`fillfactor` sigue sin justificarse** (135,3 frente a 125,0 clics/s, dentro de
  la dispersión).

### Lo que sigue abierto (y por qué)

- **Los pases `arrival` siguen sin saturar.** Con el borde real admiten ~
  12 peticiones/s, un orden de magnitud por debajo del drenaje, así que siguen
  siendo una comprobación de fidelidad y no una medición de contención. La causa
  está identificada y es del arnés: el pool del ensayo usa el `www.conf` por
  defecto (`pm.max_children = 5`), y 5 hijos × ~0,42 s por petición explican el
  techo. El siguiente paso, antes de volver a mirar el rollup, es fijar el pool
  (`pm = static`, `pm.max_children` acorde) y repetir, además de generar carga
  desde un proceso aparte en vez de desde el mismo host de Node.
- **El techo de admisión medido no es una cifra de producción**: es una máquina
  de desarrollo con todos los contenedores en los mismos núcleos.

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

- **Ninguna cifra de capacidad.** Los pases `arrival` de esta primera corrida
  (37–53 clics/s, planos con uno o con cuatro workers) están limitados por la
  ingesta del contenedor `app`, que sirve HTTP con el servidor embebido de PHP
  (`php -S`). Es una propiedad del arnés, no de la aplicación: no se puede
  extrapolar a `php-fpm` + nginx ni usarse para dimensionar nada. La corrida con
  borde real está más abajo, y su propio techo de admisión sigue siendo del
  arnés.
- **En esta primera corrida no se ejerció el escenario que motivaba la
  pregunta**: un enlace viral real encolando clics *admitidos por el redirect*
  detrás de su propia fila. El `flood` sustituye esa llegada por un encolado
  directo, precisamente porque la ingesta local no genera el backlog. La corrida
  con borde real sí lo admite y lo mide.
- **Los contadores de `pg_stat_user_tables` no son evidencia de fidelidad.**
  Van muestreados y con retraso: la pasada de rollup leyó 1.141 y 1.192
  updates donde las filas del rollup probaban 1.200 clics. La aserción usa las
  filas, nunca el contador.
- **No hay cifra de producción.** Máquina de desarrollo, contenedores locales,
  8 enlaces y volúmenes que no representan una carga de release.

## Cambio aplicado: el tope del mapa diario

`AnalyticsService` limita cuántos valores distintos guarda por dimensión y día
(`referrers` lo controla quien visita, con cualquier cabecera `Referer`). El
recorte se hacía **por orden de llegada**: alcanzado el tope, un valor nuevo se
descartaba y los primeros conservaban su hueco para siempre. Un referrer que
empezaba a dominar a media tarde permanecía invisible el resto del día, mientras
un valor visto una sola vez seguía ocupando plaza.

Un primer arreglo cambió el descarte por una regla de frecuencia y conservaba el
mismo defecto una vuelta más tarde: el hueco sólo se liberaba si algún valor había
sido visto **una vez**, así que un mapa con todos sus huecos en dos visitas
quedaba congelado y el recién llegado era rechazado en cada visita —cada visita
se leía como una primera aparición, así que no llegaba nunca a la segunda que lo
habría admitido—.

Ahora el recién llegado **siempre entra** y el hueco lo cede el valor menos
frecuente. Es la regla de admisión de `Space-Saving`, pero no su estimación: ese
algoritmo inserta al recién llegado con el contador del hueco que ocupa, y eso es
una **cota superior**. Estos contadores los lee quien los protagoniza —el mapa va
en la exportación de datos— y la entrada la elige quien visita, así que un
contador inflado serían clics que no existieron escritos en la exportación de
otro. Aquí un contador es exactamente lo observado.

Dos consecuencias que importan:

- el mapa describe el tráfico y no el momento en que llegó: ningún valor puede
  quedarse fuera para siempre, y uno que se repita se coloca por delante solo;
- un valor sólo cede su hueco como uno de los **menos frecuentes**, así que un
  recién llegado no puede desplazar a otro ya visto más veces. Entre valores
  igual de frecuentes no hay nada que elegir: el almacén no conserva el orden de
  inserción (jsonb reordena las claves), así que no se afirma que ceda el más
  antiguo.

El precio se dice en vez de esconderse: una tabla acotada no recuerda lo que
expulsó, así que un valor expulsado entre dos visitas vuelve a empezar en uno.

Cada descarte suma `analytics.map_keys_dropped`, así que el recorte deja de ser
invisible. `ANALYTICS_MAX_MAP_KEYS` permite ajustar el tope y está acotado en el
código entre 10 y 5000: un valor demasiado bajo no puede convertir el rollup en
un resumen de dos entradas. `AnalyticsRollupMapTest` fija esas propiedades.

## Cambio aplicado: los rastreadores dejan de contar como personas

La analítica tenía un segundo sesgo, independiente de la contención y fácil de
comprobar: `Ua::parse()` clasificaba cualquier agente sin coincidencia como
`desktop`, y lo hacía **antes** de mirar si era un rastreador. El UA de Googlebot
para móvil contiene `Android` y `Mobile`, así que un rastreador entraba en el
rollup como una persona en Android, con su clic y su visitante.

Ahora la clasificación de cliente automatizado va **primero**, y un rastreador
se registra como `device = bot` con `browser` y `os` nulos: el clic se conserva
(el enlace se sirvió, y ocultarlo falsearía el tráfico), pero las dimensiones
humanas —`devices`, `browsers`, `os`— dejan de contener lo que nadie pulsó. La
lista de firmas es curada y vive en `Ua::BOT_SIGNATURES`; incluye a propósito
sólo lo que un navegador no envía jamás, porque un falso positivo etiqueta a una
persona como robot y ese error es peor que dejar un rastreador raro entre los
escritorios. Quedan fuera, con ese criterio, `yandex` y `baidu` (sus navegadores
los usan personas), `whatsapp` y `kakaotalk` (sus navegadores integrados también,
a diferencia de sus capturadores de vista previa, que sí dicen `bot`) y un
`java/` suelto, que aparece en UAs generados por aplicaciones reales.

Consecuencia que conviene mirar una vez: `devices` gana la clave `bot` y las
reglas de redirección por `device` (`desktop`/`mobile`/`tablet`) ya no casan con
un rastreador, que pasa al destino por defecto. `UaTest` fija las dos
direcciones: los rastreadores como `bot` y los humanos exactamente como estaban,
incluido un navegador integrado de una app.

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
Dos corridas independientes, una de ellas con ingesta multi-proceso (php-fpm
detrás de nginx) y el caso viral de un enlace admitido por el redirect, no
muestran contención de fila: cero bloqueo muestreado, cero espera máxima y
fidelidad exacta con cuatro workers sobre la misma fila. Lo que sí se ve es el
coste de serialización frente al reparto (137 vs 184 clics/s), y que el límite
inmediato del despliegue es tener **un solo `queue-analytics`**.

Queda **una** pieza abierta, y es de medición, no de producto: los pases
`arrival` no llegan a saturar porque el pool del arnés está sin dimensionar
(`pm.max_children = 5`). Hasta que se fije y se repita, la afirmación sostenible
es «no hay evidencia de contención», no «no hay contención». Si al fijarlo
aparece, el orden de las candidatas sigue siendo el mismo: subir workers,
`fillfactor` (descartado ya por dos corridas) y sólo después agregación por
lotes.

## Reproducir

```powershell
Set-Location frontend
# Corrida de referencia (sólo el ensayo; CI nunca fija estas variables)
$env:UVH_ASYNC_DRILL_ONLY = "1"
npm run e2e:async

# La misma corrida con un borde real: php-fpm detrás de nginx, y los pases
# `arrival` admitidos por él en vez de por el servidor embebido de la pila.
$env:UVH_ASYNC_EDGE = "1"
$env:UVH_ASYNC_EXTRA_COMPOSE = "docker-compose.analytics-drill.yml"
$env:UVH_ASYNC_ANALYTICS_REQUESTS = "600"
$env:UVH_ASYNC_ANALYTICS_CONCURRENCY = "32"
$env:UVH_ASYNC_ANALYTICS_FLOOD = "1200"
$env:UVH_ASYNC_ANALYTICS_ROUNDS = "1"
npm run e2e:async
```

Los números de este documento provienen de esa ejecución, no de una estimación.
El script `scripts/benchmark-analytics-rollups.mjs` es la herramienta
independiente para medir un endpoint de analítica propio sin pasar por la pila
efímera; no sigue redirecciones y limita concurrencia y timeout.
