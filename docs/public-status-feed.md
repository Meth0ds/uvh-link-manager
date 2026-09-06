# Feed externo para `/status`

Versión del contrato: **2026-09-06**.

## Propiedad de la señal

El feed debe producirse y servirse desde infraestructura de monitorización que
no comparta proceso, host ni dependencia crítica con UVH. `/health` y
`/api/v1/status` no son fuentes válidas: el primero sólo acredita que el proceso
respondió y el segundo describe configuración, no salud operativa.

Si el feed falta, caduca, supera 128 KiB, no es JSON o viola el contrato, la API
responde 503 con estado `unknown`. Nunca se deduce salud porque la página cargue.

## Configuración

```dotenv
PUBLIC_STATUS_FEED_URL=https://monitor.example/status/uvh.json
PUBLIC_STATUS_FEED_BEARER=<secreto-de-solo-lectura>
PUBLIC_STATUS_CONNECT_TIMEOUT_SECONDS=2
PUBLIC_STATUS_TIMEOUT_SECONDS=4
PUBLIC_STATUS_MAX_AGE_SECONDS=300
```

La URL debe usar HTTPS, puerto 443 y nombre DNS público; no admite credenciales
embebidas, fragmentos, IPs ni sufijos locales. El bearer debe residir en el
gestor de secretos y rotarse como cualquier credencial de lectura.

## Contrato de entrada

```json
{
  "generatedAt": "2026-09-06T12:00:00Z",
  "components": {
    "links": "operational",
    "panel": "operational",
    "webhooks": "degraded"
  },
  "incidents": [
    {
      "id": "inc-2026-09-001",
      "title": "Latencia elevada",
      "message": "La recuperación está siendo monitorizada.",
      "status": "monitoring",
      "startedAt": "2026-09-06T11:30:00Z",
      "updatedAt": "2026-09-06T11:55:00Z"
    }
  ]
}
```

Estados de componente: `operational`, `maintenance`, `degraded` o
`major_outage`. Estados de incidente: `investigating`, `identified`,
`monitoring` o `resolved`. Se admiten como máximo 20 incidentes; los textos son
UTF-8, no vacíos, sin controles y con cotas de 160/1000 caracteres.

La API ignora cualquier `overall`, nombre de componente, versión, topología o
campo adicional. Publica etiquetas fijas y recalcula el agregado según el peor
componente. Tolera como máximo 60 segundos de desfase al futuro.

## Despliegue y ensayo

1. Crear comprobaciones externas para redirecciones, panel/API y recepción de
   webhooks desde al menos dos ubicaciones.
2. Publicar el JSON de forma atómica y actualizar `generatedAt` sólo al terminar
   por completo el ciclo de medición.
3. Configurar URL y bearer mediante secretos; comprobar que el navegador nunca
   recibe ninguno de los dos.
4. Simular un componente degradado y comprobar agregado, texto e incidente.
5. Detener el feed o congelar su fecha y comprobar HTTP 503 + `unknown`.
6. Detener UVH desde fuera y confirmar que el monitor continúa publicando la
   interrupción. Este punto demuestra la independencia real.

Registrar resultado y fecha en el runbook de producción. No cerrar
`PRODUCT-VALID-011` únicamente con mocks o pruebas unitarias.
