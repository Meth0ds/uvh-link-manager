# Política de disponibilidad de redirecciones y webhooks

Esta decisión cierra el contrato arquitectónico señalado en F17/F18. No es
evidencia de capacidad: los valores p95/p99 deben medirse por release en un
entorno autorizado y quedar adjuntos al expediente descrito en
`release-evidence-template.md`.

## Fronteras deliberadas

| Operación | Estado autoritativo | Política si falla el trabajo auxiliar |
|---|---|---|
| Resolver alias, uso único y `max_clicks` | Transacción del enlace | Falla cerrada; nunca se entrega una redirección sin consumir atómicamente el uso correspondiente. |
| Analítica de clic | Job idempotente `analytics` posterior | La redirección continúa. Se incrementa `analytics.record_failed` si no puede admitirse o agota reintentos. No se encolan IP ni user-agent en claro. |
| Evento de webhook configurado | Entregas persistentes en la misma transacción de negocio | Falla cerrada con 503 y `Retry-After`; la mutación no se aplica si no puede conservarse el evento. No se permite pérdida silenciosa. |
| Ping manual de webhook | Operación auxiliar | Devuelve capacidad agotada sin modificar recursos de negocio. |

La dependencia de disponibilidad de webhooks es intencionada: activar un
webhook solicita un historial durable de los eventos suscritos. Cambiar a una
política de pérdida admisible requiere una decisión de producto versionada, no
un `catch` local. El límite de backlog por workspace evita crecimiento sin cota
y la consola/métricas hacen visible la saturación.

## Reducción de contención aplicada

- El enlace **con límite** (`single_use` o `max_clicks`) conserva el bloqueo
  exclusivo: ahí la admisión consume una cuota y tiene que serializarse.
- El enlace **sin límite** ya no toma bloqueo exclusivo. Lee bajo
  `SELECT ... FOR SHARE` y suma su contador en una sentencia atómica propia,
  después de la transacción. Dos consecuencias, ambas deliberadas:
  - los redirects del mismo alias dejan de bloquearse entre sí, que era el
    cuello de botella de un alias viral;
  - el contador sigue siendo exacto e inmediato (el producto no cambia),
    porque nada autoritativo se decide en esa escritura.
- El bloqueo compartido sigue ordenando las escrituras de estado (pausar,
  bloquear, borrar) por detrás de los redirects ya admitidos, y PostgreSQL
  encola a los lectores nuevos detrás de un escritor que espera, de modo que un
  alias viral no puede dejar sin turno a un operador.
- Si el enlace pasa a tener límite mientras se resuelve, la lectura sin bloqueo
  no puede consumirlo: consumir bajo un bloqueo compartido obligaría a la
  transacción a escalar su propio lock, y dos peticiones así pueden esperarse
  mutuamente. La resolución se repite **una vez** bajo el bloqueo exclusivo, que
  sólo puede esperar al lock ya elegido y por tanto no puede bloquearse. El
  bucle está acotado a dos pasadas y nunca encadena reintentos.
- La comprobación de dominio en la ruta de redirección ya no toma un bloqueo
  exclusivo sobre una fila que sólo lee.
- La escritura de evento y agregado analítico se ejecuta en el pool
  `analytics`; `event_id` único hace idempotente una entrega de cola repetida.
- Correo, webhooks, dominios, exportaciones, analítica y compatibilidad legacy
  tienen workers y heartbeats separados. Las métricas exponen profundidad,
  antigüedad y heartbeat por pool.

## Estado de la medición

Una comparación local (equipo de desarrollo, no un entorno autorizado) midió la
ventana entre el primer y el último trabajador en salir de la resolución, con 8
procesos liberados desde una barrera común y el mismo trabajo de CPU en las dos
condiciones: alias caliente (contención de fila) contra alias repartidos (sin
contención). Medianas de 3 rondas intercaladas:

| Versión | Alias caliente | Alias repartidos | Sobreprecio por contención |
|---|---|---|---|
| Bloqueo exclusivo para todos | 57,79 ms | 28,75 ms | +29,0 ms |
| Bloqueo compartido (actual) | 42,30 ms | 25,22 ms | +17,1 ms |

Lo que esto sostiene y lo que no:

- **Sostiene** que la serialización por fila bajó, y que las garantías de límite
  siguen cumpliéndose bajo paralelismo real (`RedirectConcurrencyTest`).
- **No sostiene** ninguna cifra de capacidad: son milisegundos de un portátil con
  8 procesos, con un valor atípico de 693 ms en una ronda, y el coste por
  resolución de este entorno no representa al de producción.
- Una pasada de diagnóstico con la escritura del contador desactivada **no** bajó
  la cifra en caliente (43,27 ms frente a 42,30 ms). Es decir, el residuo no es
  el contador, y el contador asíncrono **no** queda justificado por esta
  medición. Sigue siendo una decisión de producto versionada —el `clickCount`
  visible pasaría a ser eventualmente consistente— que necesita números de
  release.
- Otro sospechoso del residuo era la fila del limitador en `cache`, que se
  escribía en cada redirect. Ya no se escribe: el limiter tiene su propio store
  (Redis con conmutación a PostgreSQL), y su coste medido por intento es ~3,8 ms
  menor que con el store de base de datos
  ([`docs/redis-operations.md`](redis-operations.md)). Eso acota el residuo, no
  lo explica: ~4 ms no son +17,1 ms.

## Medición autorizada

El script `scripts/benchmark-redirects.mjs` no sigue el destino y limita tanto
concurrencia como timeout. Debe usarse sólo contra un entorno propio con datos
ficticios:

```powershell
node scripts/benchmark-redirects.mjs --url=https://staging.example/alias-ficticio --requests=5000 --concurrency=50 --timeout=5000 > evidence/redirect-capacity.json
```

Antes de aprobar una release se fijan objetivos p95/p99, tasa de errores y
concurrencia esperada; después se contrasta PostgreSQL (esperas/bloqueos), edad
de `analytics`, pérdida/reintentos y latencia de redirección. El repositorio no
inventa umbrales de negocio ni resultados que aún no se han medido.
