# Copias de seguridad y restauración

Este documento describe el contrato que implementan `docker/backup/*.sh` y la
prueba que lo demuestra: `npm run e2e:backup` en `frontend/`.

La regla de la que sale todo lo demás: **una copia que no se ha restaurado no
es una copia de seguridad**. Por eso el repositorio no se conforma con crear un
volcado, sino que destruye una base a propósito, restaura la copia en una
instancia aislada, comprueba que el contenido coincide y sólo entonces informa
de RPO/RTO.

## Qué se ejecuta

| Script | Responsabilidad |
| --- | --- |
| `docker/backup/ensure-key.sh` | Crea la clave de cifrado **una sola vez**, en su propio volumen, con permisos `0600`. Es un paso explícito: `backup.sh` falla si no existe. |
| `docker/backup/backup.sh` | `pg_dump` → cifrado AES-256-CBC (`-pbkdf2 -iter 200000`) → manifiesto con digests → retención por número → alerta si algo falla. |
| `docker/backup/restore.sh` | Verifica el digest del cifrado y el del volcado descifrado **antes** de escribir una sola fila, y después restaura. |
| `docker/backup/Dockerfile` | Imagen de herramientas: cliente PostgreSQL de la misma versión mayor que el servidor más `curl` para el hook de alerta. |

Ningún script se ejecuta dentro de la base que está copiando: cada operación
corre en su propio contenedor efímero (`backup-runner`).

## Garantías

- **Cifrado real.** El fichero en disco empieza por `Salted__`; el drill
  comprueba que no es un volcado legible.
- **Clave separada.** La clave vive en un volumen distinto del de las copias.
  Perder el almacenamiento no entrega los datos.
- **Fail closed.** Si falta la clave, la copia aborta. Si el cifrado no se
  descifra de vuelta al mismo digest, la copia se marca como fallida en lugar
  de guardarse como buena.
- **Integridad antes que fe de nadie.** Restaurar una copia manipulada se
  rechaza con `ciphertext digest mismatch; refusing to restore`, y el drill
  comprueba además que **no se escribió nada** en el destino.
- **Retención sin sorpresas.** Se conservan las últimas `BACKUP_RETENTION`
  copias; la más reciente nunca es candidata a borrado.
- **Fallo observable.** Cada fallo escribe una línea en `alerts.log` junto a las
  copias y, con `ALERT_HOOK_URL` configurada, publica el JSON
  `{"alert":"backup_failed","backup":"…","reason":"…"}`.

## Configuración

| Variable | Descripción |
| --- | --- |
| `PGHOST`, `PGPORT`, `PGUSER`, `PGPASSWORD`, `PGDATABASE` | Origen del `pg_dump` y destino por defecto del `restore`. |
| `BACKUP_DIR` | Directorio de copias. En producción debe ser almacenamiento independiente (objeto o volumen de otro plano). |
| `BACKUP_KEY_FILE` | Fichero de clave. Nunca en el mismo volumen que `BACKUP_DIR`. |
| `BACKUP_RETENTION` | Número de copias a conservar (por defecto 7). |
| `BACKUP_TAG` | Etiqueta de la copia (`daily`, `pre-release`…). Aparece en el nombre y en el manifiesto. |
| `ALERT_HOOK_URL` | Endpoint que recibe el JSON de fallo. |

Programación esperada: cron o `systemd` en el host, no dentro de la aplicación.
Una copia no debe depender de que el release que se está copiando esté sano.

## Restaurar de verdad

```sh
# 1. Verificar y restaurar en una instancia aislada (nunca sobre producción a ciegas).
docker compose -p uvh-backup-e2e -f docker-compose.backup-e2e.yml \
  run --rm -e PGHOST=restore-target -e PGDATABASE=uvh_restore_test \
  backup-runner sh /scripts/restore.sh /backups/uvh-<sello>-<etiqueta>.dump.enc

# 2. Sólo si la copia anterior es válida, recuperar la instancia real.
docker compose -p uvh-backup-e2e -f docker-compose.backup-e2e.yml \
  run --rm backup-runner sh /scripts/restore.sh /backups/uvh-<sello>-<etiqueta>.dump.enc uvh_backup_test
```

El `release-check` de la imagen es la última red: una base restaurada que va por
detrás del release en curso se rechaza (`Hay N migraciones pendientes para esta
imagen`). Restaurar una copia más antigua que el código nunca es silencioso.

## Qué demuestra el drill

`npm run e2e:backup` levanta una pila con almacenamiento, clave y receptor de
alertas separados y ejecuta, sobre datos reales de cuentas, enlaces y
workspaces:

1. **Ciclo completo**: copia → escrituras posteriores → base destruida → copia
   restaurada en una instancia aislada → huella idéntica a la del origen →
   recuperación de la instancia principal. Las escrituras posteriores a la
   copia **desaparecen**, que es exactamente lo que mide el RPO.
2. **Pérdida de datos sin pérdida de esquema**: `TRUNCATE` sobre `links` y
   restauración posterior.
3. **Esquema dañado**: se elimina una tabla y se comprueba que el propio
   `uvh:healthcheck` lo rechaza antes de que lo haga un usuario.
4. **Anti-rollback**: una base cuyo registro de migraciones va por detrás del
   release se rechaza; la copia más reciente lo satisface.
5. **Copia manipulada**: se rechaza y no se escribe nada.
6. **Alerta de fallo**: se fuerza un fallo y se comprueba que el receptor de
   alertas lo recibe además del registro local.
7. **Retención**: con `BACKUP_RETENTION=2` sólo quedan dos copias y la más
   nueva sobrevive.

Las cifras medidas se imprimen al final y quedan en
`backup-drill-evidence.json` (también se adjuntan como artefacto en CI):

```json
{ "rto_isolated_ms": 6424, "rto_primary_ms": 13160, "rpo_seconds": 11 }
```

Son cifras de un ensayo en contenedor, no de producción. Sirven para lo que
sirven: demuestran que la cadena funciona y dan una cota inferior que el entorno
real debe mejorar, no empeorar sin decirlo.

## Redis no es un objetivo de copia

Este subsistema copia PostgreSQL, y debe seguir siendo así: Redis guarda el
estado efímero y compartido (caché, rate limits, locks y colas) y ninguna verdad
del producto. Copiarlo no aportaría recuperación, sólo otra cosa que mantener
sincronizada.

Lo que sí importa es el **trabajo encolado**, y ahí la garantía no viene de una
copia sino de que la verdad está en otro sitio:

- `mail_outbox`, `webhook_deliveries`, `data_export_requests` y `custom_domains`
  viven en PostgreSQL y forman parte de esta copia;
- `UvhHousekeeping` republica lo que quedó sin publicar o sin reclamar, así que
  perder el contenido de Redis retrasa el trabajo en lugar de perderlo;
- Redis se despliega con `appendonly yes` y `appendonlyfsync everysec`, lo que ya
  evita la mayoría de esos huecos sin depender del reconciliador.

Esa propiedad no se afirma: se prueba. `npm run e2e:async` incluye un ensayo que
vacía las estructuras de cola del broker con una fila de `mail_outbox` publicada,
comprueba que el mensaje **no** se entrega mientras el trabajo está perdido, y
después deja que el reconciliador real (el tick del scheduler) la republique y el
worker la entregue. Las copias de PostgreSQL y la recuperación del broker son
complementarias: la primera recupera el estado, la segunda recupera el trabajo
en vuelo.
