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

- El enlace conserva el bloqueo exclusivo que protege cuotas y uso único.
- La comprobación de dominio en la ruta de redirección ya no toma un bloqueo
  exclusivo sobre una fila que sólo lee.
- La escritura de evento y agregado analítico se ejecuta en el pool
  `analytics`; `event_id` único hace idempotente una entrega de cola repetida.
- Correo, webhooks, dominios, exportaciones, analítica y compatibilidad legacy
  tienen workers y heartbeats separados. Las métricas exponen profundidad,
  antigüedad y heartbeat por pool.

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
