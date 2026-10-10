# O92 — Precisión y contexto de los rangos de analítica

Plan previo, después de cerrar suite y recursos O91. Objetivo: cumplir el contrato existente de timestamps exactos, día final completo y rangos explícitos independientes. No eliminar filtros, series, dimensiones, caché de periodos móviles, controles de acceso ni idempotencia. No editar producto mientras QA propia esté activa.

## Evidencia de lectura y reproducción

`IsoDate::parse` acepta1–6fracciones; `AnalyticsController::parseRange` las elimina mediante toIso8601String. La prueba `.uvh-runtime/o91-analytics-totals/range-precision-probe.json` invoca el parser real y muestra start.000001/end.999999 convertidos al mismo segundo y fin de fecha-only23:59:59 en vez del último microsegundo. El límite de duración usa getTimestamp y también ignora fracciones.

`cachedOverview` no recibe si el rango era explícito: deduce rolling cuando end está a menos de2segundos de time(). La prueba `.uvh-runtime/o92-analytics-range/cache-key-probe.json` invoca el parser y cache reales, con reloj/cache controlados, sin boot/env/DB/network, y obtiene la misma clave para custom hasta12:00:00 y hasta12:00:01. Demuestra igualdad de claves, no recuentos productivos. `RecordClickAnalyticsJob` recibe un occurredAt que RedirectController serializa sin fracciones; AnalyticsService vuelve a ligarlo como DateTime, cuya precisión efectiva de almacenamiento debe reproducirse antes de cambiarlo.

## Pasos

- [x] Tras cerrar O91, entorno propio `_test`/red interna/fakes, fuentes congeladas y DB con schema actual. Nuevos contratos deben fallar con código actual: from/to fraccionarios, evento al último micro del día, UTC/offsets equivalentes y máximo180días exacto/una fracción superior; no simular el resultado esperado sin consultas reales.
- [x] Reproducir por HTTP cacheTTL30: dos rangos explícitos cerca del reloj con eventos entre sus límites deben producir totales diferentes; incluir variantes from/to en preset, scope workspace/link y periodo genuinamente móvil. Conservar el test existente de vencimiento/snapshot y la autorización antes de caché.
- [x] Preservar precisión admitida en predicados y comparar duración exacta sin floats ni mutar fechas del caller. Probar fechas-only inclusivas y offsets/UTC. La corrección no debe convertir un máximo en otro ni ampliar rangos sin validación.
- [x] Explicitar origen móvil en parseRange y pasarlo a sus tres consumidores; reutilizar buckets sólo en periodos sin límites explícitos. Mantener TTL/fallback, claves separadas por scope y versionar la clave al cambiar significado; no cachear identidad ni bajar garantías del snapshot. Revisar callers/reflexión, documentación y firmas.
- [x] Comprobar productor→job→persistencia con el mismo event_uuid y fracciones: si la escritura también las pierde, preservar ocurridoAt sin tocar counters de redirect, pseudónimos/díaUTC, payload de privacidad, locks/transacción ni dedup/retries. No cambiar globalmente la gramática de timestamps. Catálogo real: occurred_at es timestamptz(0), por lo que sí se necesita migración a precisión6; revertir debe rechazar filas fraccionarias, como las migraciones existentes de expiración/token.
- [x] Pruebas pertinentes (HTTP/CSV/JSON/cache/snapshot/API-authority/ingestion/idempotencia), comparación de casos no afectados, Pint/PHPStan y suite backend integral. Fuente congelada intacta, recursos propios cerrados y efectos intencionales documentados. Global sigue activo con restoSQL/jobs/render/refactors/coverage pendientes.

Este lote es corrección funcional de rangos, no otra promesa de rendimiento global. La agregación única de O91 se conserva; no rediseñar AnalyticsController ni mezclar nuevas agregaciones/indexes.

Reproducción: schema aislado completo,23contratos HTTP/job fallan sin errores de fixture. Parser/formato/producer/binding/migración precisos aplicados primero:14pasan y9fallos de caché permanecen. Origen móvil explícito y clavev2 corrigen el resto;41pruebas/244assertions pasan incluyendo contratos previos. Se amplían scope/autoridad/rollback antes de la regresión integral. No procesos reiniciados por timeout.

Dirigidos finales:198tests/1419assertions exit0; incluye33contratos nuevos y scope workspace/link, revocación antes de cachehit, rollback sin pérdida, UTC/offsets, daylastmicro y límite180d+micro. Siguiente comparación108casos enteros O91 y QA final.

Cierre final:2831tests/23325assertions,2830pass/1skipDNS,0failures/errors, terminalexit0;09:06.620/147MB. Pint/PHPStan/inventario521 y freeze526 app/copia válidos. Recursos propiosO92 PG/red/volumen eliminados tras IDs/labels/montajes; evidencia conservada. Siguiente O93 optimizaciónN+1, global continúa.
