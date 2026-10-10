# Índice de enlaces por autor

Lote O90, 9 de octubre de 2026. Cambio en código y ensayos en PostgreSQL propio; no aplicado a la base compartida ni desplegado.

La migración `2026_10_09_000001_index_links_by_author.php` añade `links_created_by_id_index` sobre `(created_by, id)`. Conserva enlaces borrados para la copia de acceso de la cuenta. No sustituye índices de alias, workspace ni constraints. La consulta de administración limita primero los usuarios y calcula después sus contadores, manteniendo filtros, orden, total y campos públicos.

## Decisión medida

Se compararon índice completo, parcial de enlaces vivos y completo con `INCLUDE (deleted_at)`. El parcial no sirve a la exportación que incluye borrados. Se eligió el completo sin cobertura: beneficia ambos consumidores y ocupa 15.794.176 bytes para el fixture de 500.000 enlaces, frente a 20.307.968 con cobertura. El autor concentrado puede seguir usando el índice primario: no se fuerza un plan.

En el fixture mediano, insertar 100 enlaces generó una mediana de 61.301 bytes WAL con el índice completo frente a 54.101 sin él; tiempos de sentencia 2,317 y 2,178 ms. También se midieron actualización de clics, borrado lógico y purga. Son ocho muestras por operación, primera separada y siete repetidas, con transacciones revertidas; no miden commit, throughput ni latencia HTTP. Cada variante se sembró de nuevo. El coste adicional se acepta por la mejora de lecturas observada.

## Aplicación y reversión

Aplicar mediante el procedimiento de migraciones de la release en el entorno autorizado. El índice es compatible con la versión anterior de la aplicación; la consulta nueva funciona sin él, con mayor coste. Esta revisión no ejecuta el procedimiento en producción.

La migración usa `CREATE INDEX CONCURRENTLY` y `DROP INDEX CONCURRENTLY`, con `withinTransaction = false`. PostgreSQL permite las escrituras durante la construcción concurrente, pero requiere más trabajo y puede esperar transacciones anteriores. No ejecutarla dentro de una transacción externa. [Documentación PostgreSQL 16](https://www.postgresql.org/docs/16/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY).

Comprobar estado y definición antes de considerar la aplicación terminada:

```sql
SELECT c.relname, i.indisvalid, i.indisready, pg_get_indexdef(c.oid)
FROM pg_class c
JOIN pg_index i ON i.indexrelid = c.oid
WHERE c.oid = to_regclass('public.links_created_by_id_index');
```

Debe existir un índice válido y preparado sobre `public.links (created_by, id)`, y la migración debe figurar en `migrations`. Un fallo de construcción concurrente puede dejar un índice inválido. Diagnosticar el fallo y, tras confirmar que corresponde a este cambio, retirar ese índice con `DROP INDEX CONCURRENTLY public.links_created_by_id_index` antes de reintentar. La migración no usa `IF NOT EXISTS` al crear: no da por válida una estructura preexistente con el mismo nombre. [Construcción y recuperación](https://www.postgresql.org/docs/16/sql-createindex.html#SQL-CREATEINDEX-CONCURRENTLY).

La reversión retira únicamente este índice; no elimina datos. No usar `CASCADE`. [DROP INDEX CONCURRENTLY](https://www.postgresql.org/docs/16/sql-dropindex.html). En la base aislada se ensayó aplicar/revertir/aplicar: 168→169→168→169 índices, con todos los anteriores intactos y el nuevo válido/preparado.

## Evidencia y límites

Artefactos en `.uvh-runtime/o90-link-author`: capturas de consumidores reales, planes completos, muestras, hashes de cuerpos y streams, tamaño de índices, coste de escritura y protocolo de migración. Volúmenes 100/1.000, 1.000/50.000 y 10.000/500.000 usuarios/enlaces; autor concentrado, borrados, filtros, empates y páginas vacías. Las mediciones usan una VM local compartida y datos sintéticos analizados; no certifican capacidad productiva ni una caché físicamente fría.

Regresión completa final: 2.797 pruebas/23.135 aserciones, 2.796 pasan y una prueba de hostname público se omite por falta de DNS exterior en la red interna. Pint526 y PHPStanlevel6 app correctos, fuentes congeladas intactas. Recursos propios retirados; lote O90 cerrado. No se extiende esta decisión a todos los joins de exportación, otras paginaciones, overview, 302, jobs ni analítica.
