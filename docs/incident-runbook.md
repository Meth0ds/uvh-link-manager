# Incidente e indisponibilidad

Este documento decide **quién mira qué y en qué orden** cuando UVH no responde
como debería. No sustituye a los runbooks de cada materia; los usa:

| Materia | Documento |
| --- | --- |
| Outbox de correo, reintento y compensación | [`mail-outbox-runbook.md`](mail-outbox-runbook.md) |
| Redis caído, locks, modo degradado | [`redis-operations.md`](redis-operations.md) |
| Copia de seguridad y restauración (RPO/RTO) | [`backup-and-restore.md`](backup-and-restore.md) |
| Volver atrás un release y por qué a veces no se puede | [`deployment.md`](deployment.md) §4.1 |
| Cambio de `APP_SECRET` y su rollback | [`app-secret-rotation-runbook.md`](app-secret-rotation-runbook.md) |
| Reputación de destinos y cuarentena | [`url-reputation-runbook.md`](url-reputation-runbook.md) |
| Procedencia y escaneo de imágenes | [`image-provenance-runbook.md`](image-provenance-runbook.md) |
| Presupuesto de correo de invitación | [`invitation-mail-budget-runbook.md`](invitation-mail-budget-runbook.md) |
| Retraso del rollup de analítica | [`analytics-rollup-capacity.md`](analytics-rollup-capacity.md) |
| Feed externo de `/status` | [`public-status-feed.md`](public-status-feed.md) |

## Autoridad

- **Quien declara el incidente** es quien lo detecta, y lo declara al abrir el
  primer canal; no se espera a tener causa raíz.
- **Quien aprueba un release** es una sola persona nombrada, distinta de quien lo
  construye. Desplegar o volver atrás durante un incidente exige esa aprobación,
  salvo la vuelta atrás a la imagen anterior, que ya está autorizada por el
  procedimiento de `deployment.md` §4.1.
- **Quien responde** a un incidente no diagnostica y comunica a la vez: si hay una
  sola persona disponible, primero se estabiliza y después se comunica.

Los nombres concretos son un pendiente de dirección y están listados en
[`production-readiness.md`](production-readiness.md).

## Detección: las señales que existen hoy

| Señal | Dónde | Qué significa |
| --- | --- | --- |
| Estado del contenedor | `docker ps` sobre la pila de producción | Cada servicio lleva su propia sonda: `php artisan uvh:healthcheck app` (web), `… queue-$UVH_QUEUE_POOL` (cada worker), `… scheduler` (planificador). `unhealthy` es una avería de ese proceso, no del conjunto |
| `uvh:healthcheck <componente>` | Dentro del contenedor | Comprueba base de datos, esquema al día respecto de la imagen, el store de límites del proceso web y el latido del componente. `queue*` tolera 180 s; el resto, 210 s |
| Latidos | Caché compartida: `uvh:health:queue`, `uvh:health:queue-<pool>`, `uvh:health:scheduler` | Un latido ausente o viejo significa **proceso detenido**, no cola vacía. Los escribe el worker al procesar y el planificador en su pasada |
| `/internal/metrics` | Sólo por el listener privado, con `Authorization: Bearer $METRICS_BEARER_TOKEN` (en producción llega como fichero de secreto, `METRICS_BEARER_TOKEN_FILE`); sin bearer válido responde 404 | Profundidad y edad por pool, fallos de cola, estados del outbox, entregas de webhook, contadores operativos de 60 minutos |
| Consola administrativa | `GET /api/v1/admin/operations` (rol admin + MFA fresca + CSRF) | Las mismas comprobaciones, más la edad del trabajo pendiente más antiguo de correo y de webhooks. Degrada su chequeo de correo por encima de 600 s |
| Correo | `GET /api/v1/admin/mail-outbox` | Acumulación, publicación, worker, compensación pendiente |
| `/status` público | Feed externo (`PUBLIC_STATUS_FEED_URL`) | Si el feed falta, caduca o viola el contrato, la página dice `unknown`. **Nunca** deduce salud de que la página cargue |

La consola administrativa y el endpoint de métricas **no** son fuentes válidas
para el feed de estado: comparten proceso y dependencia con lo que describen.

## Triaje

Distinguir primero **qué superficie** está afectada; eso descarta la mayoría de
las causas sin tocar nada.

1. **Sólo tráfico público** (redirects) — mirar caída de Redis y saturación de
   base de datos. El rate limiter conmuta solo a PostgreSQL; cada conmutación
   incrementa `cache.failed_over`. Si la base de datos está caída, no hay
   conmutación posible: es un incidente de base de datos.
2. **Sólo el panel** (login, sesiones, MFA) — la base de datos está caída o el
   esquema está por detrás de la imagen. El arranque rechaza un esquema pendiente
   o ausente, así que una imagen nueva sobre una base sin migrar **no** sirve.
3. **Sólo una familia asíncrona** (correo, webhooks, dominios, exportaciones,
   analítica, reputación) — mirar el contenedor de ese pool, su latido y su
   profundidad. Un pool con latido viejo y trabajo acumulado es un worker
   detenido, no un proveedor caído.
4. **Nada se retrasa pero nada progresa** — sospechar del planificador antes que
   del worker: los reintentos con espera sólo se publican en su tick. Un
   planificador detenido se ve por `uvh:health:scheduler`, no por la profundidad
   de la cola.
5. **Sólo los correos de verificación o invitación** — mirar `/api/v1/admin/mail-outbox`
   y el runbook de presupuesto de correo de invitación antes de tocar la cola.

Durante el triaje, los controles de sesión, rol, MFA y CSRF se mantienen. Ningún
diagnóstico justifica desactivarlos.

## Lo que el sistema ya hace solo (no intervenir)

- Redis caído: los limitadores conmutan a PostgreSQL y el tráfico público sigue;
  **los locks fallan cerrado** — MFA, verificación de dominios, configuración de
  webhooks, intenciones y rotación de secretos no progresan, y eso es correcto.
- Broker con contenido perdido: la fila de `mail_outbox` sigue en PostgreSQL y el
  reconciliador la republica; no hace falta intervención manual ni tocar filas.
- Webhook con destino denegado o no resoluble: la petición recibe `503` con
  `Retry-After` y no se admite, en lugar de aceptarse y perderse.
- Exportación grande: el worker la rechaza antes de agotar su presupuesto de
  memoria, con `export.memory_budget_rejected` o `export.too_large` en las
  métricas. Es una negativa deliberada, no una avería.
- Esquema por delante de la imagen (vuelta atrás): el arranque lo **acepta**; por
  detrás, lo rechaza.

## Recuperación y cierre

1. Estabilizar: si la causa es un release, volver a la imagen anterior
   (`deployment.md` §4.1). Si el release retiró algo, no es vuelta atrás: es
   restauración, con el RPO/RTO como objetivo.
2. Reponer el proceso caído y observar la transición, no editarla: no se cambian
   estados por SQL ni se borran filas para silenciar alertas.
3. Confirmar la recuperación con evidencia, en este orden:
   - todos los contenedores `healthy` y los latidos frescos por debajo de su umbral;
   - profundidad por pool bajando y edad del trabajo pendiente más antiguo
     volviendo por debajo de 600 s en correo;
   - un extremo a extremo real por cada familia afectada (un correo recibido en el
     proveedor, una entrega de webhook con su firma, una verificación de dominio,
     una exportación descargada y acusada);
   - `/status` con estado `operational` desde su feed externo, no desde la propia API.
4. Registrar sólo metadatos: ID, tipo, estado, intentos, horas y código genérico.
   Nunca el sobre descifrado, un bearer, una cookie o una contraseña.
5. Cerrar con una nota de causa raíz y, si aparece una familia que nadie estaba
   mirando, una señal nueva antes de dar el incidente por terminado.

## Ensayos que existen y cómo se ejecutan

Cada uno se ejecuta desde `frontend/` salvo el gate del backend:

| Ensayo | Comando | Qué demuestra |
| --- | --- | --- |
| Contrato de arranque | `npm run release:boot` | La imagen de producción se construye, arranca con todas las invariantes y **cada** invariante rota detiene el contenedor por su propio motivo |
| Pila asíncrona completa | `npm run e2e:async` | HTTP → transacción → commit → cola → worker → reintento → estado final, sobre Redis y Postgres reales |
| Sólo los ensayos de caída y recuperación | `UVH_ASYNC_ONLY=1 npm run e2e:async` | Export máximo con el worker muerto a mitad, planificador detenido y recuperado, outbox con el proveedor caído, compensación y purga |
| Copia y restauración | `npm run e2e:backup` | Restauración real en una instancia aislada, copia manipulada rechazada y RPO/RTO medidos |
| Gate del backend | `docker compose -f docker-compose.local.yml run --rm php composer quality` y `… run --rm -e DB_DATABASE=uvh_test php composer test` | Pint y PHPStan nivel 6 sin errores, y la suite completa (540 pruebas). La suite **se niega a correr** contra una base que no acabe en `_test`, así que el override es obligatorio, no un atajo |
| Frontend | `npm run typecheck && npm run lint && npm test` | Compilación estricta, lint y Karma |

Estos ensayos son la red que hace creíble este runbook: un procedimiento sin
ensayo es una promesa. Los que quedan sin poder ejecutarse desde el repositorio
—alertas externas, proveedor de correo real, hCaptcha real y datos legales— están
listados como pendientes externos en [`production-readiness.md`](production-readiness.md).
