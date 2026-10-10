# Precisión de los eventos de clic

La fecha del evento debe conservar el mismo instante desde la redirección hasta el filtro de analítica. `occurred_at` estaba definido con precisión0: PostgreSQL redondeaba las fracciones, mientras productor y query builder las descartaban. O92 conserva seis cifras en la cola, liga el instante UTC como texto y amplía únicamente esa columna con la migración `2026_10_09_000002_preserve_click_event_precision`.

Las filas antiguas conservan su instante almacenado. No se puede reconstruir una fracción ya descartada o redondeada. Los jobs antiguos con fechas a segundos siguen siendo válidos; la deduplicación por event_id, las dimensiones privadas, el día UTC, los contadores y la transacción no cambian.

## Aplicación

No se ha aplicado este lote a una DB compartida ni a producción. Antes de publicar el código/worker, aplicar la migración con el procedimiento habitual de despliegue y su ventana para cambios de esquema. No activar primero los nuevos escritores sobre la columna antigua: se seguiría redondeando. La migración sólo cambia el tipo de occurred_at; no modifica índices ni configura globalmente Laravel.

Comprobar el resultado en la base de destino:

```sql
SELECT data_type, datetime_precision
FROM information_schema.columns
WHERE table_schema = 'public'
  AND table_name = 'click_events'
  AND column_name = 'occurred_at';
```

Se espera `timestamp with time zone`, precisión6. El ensayo aislado usa schema completo, PG16.15 y PHP8.4.25. Un redirect HTTP genera el job con .987654; consumirlo dos veces conserva exactamente el instante y un solo evento/rollup/counter. Otro caso con offset conserva .123456 y el díaUTC anterior.

## Reversión

Volver al código anterior es compatible con el esquema ampliado. La migración down se niega a reducir precisión si hay eventos fraccionarios: no permite redondear tráfico de forma silenciosa. Mantiene la comprobación y el ALTER bajo el mismo lock/transacción. No borrar eventos ni sustituir instantes para conseguir que pase.

El contrato prueba tanto la negativa sin alterar la fila fraccionaria como down/up cuando sólo existen segundos enteros. La restauración final devuelve precisión6. La suite general termina exit0:2831tests/23325assertions,2830pass/1skipDNS,0failures/errors; Pint/PHPStan y fuente congelada válidos. Recursos propios cerrados; resultados en plan O92.

## Rangos y caché

Los bounds explícitos conservan precisión y offsets. Una fecha-only final incluye hasta23:59:59.999999 del día elegido. El límite180días se compara como tiempo transcurrido exacto;180días+1microsegundo se rechaza. Sólo los presets sin from/to usan intervalos de caché; los bounds explícitos nunca se deducen como móviles por estar cerca de now. La clavev2 separa estos significados por workspace/link. TTL y fallback a snapshot se conservan y la autorización precede siempre al cachehit.

33contratos nuevos/177assertions,198dirigidos/1419assertions y108capturas de casos no afectados verifican estos cambios. Las capturas reutilizan los tres volúmenes de O91 (1000/50000/500000eventos) con instantes enteros: cuerpos, cabeceras, estados, totales y número de SELECT permanecen iguales. Esa comparación no prueba lectura física de QR, capacidad productiva ni latenciaHTTP.
