# Redis: almacén compartido, operación y modo degradado

Redis guarda el estado **efímero y compartido** del sistema: caché de
aplicación, rate limits, locks distribuidos y las colas. No guarda ninguna
verdad del producto. Este documento describe qué vive ahí, cómo se despliega,
qué se alerta y qué ocurre exactamente cuando no responde.

## Qué vive en Redis y qué no

| En Redis | En PostgreSQL |
|---|---|
| Caché de aplicación | Cuentas, enlaces, dominios, auditoría |
| Rate limits (todos los `throttle:*`) | `mail_outbox`, `webhook_deliveries`, `data_export_requests` |
| Locks distribuidos (`Cache::lock`) | `failed_jobs` |
| Colas `mail`, `webhooks`, `domains`, `exports`, `analytics`, `default` | Sesiones propias (`uvh_sessions`) |

Las **sesiones se quedan en PostgreSQL** a propósito: la sesión propia es la
fuente de verdad de la revocación inmediata, y una caché intermedia debilitaría
justo la propiedad que aporta. (`SESSION_DRIVER` no interviene: el stack de
sesión de Laravel está desactivado en `bootstrap/app.php`.)

## Despliegue

El stack de referencia (`docker-compose.production.yml`) incluye el servicio
`redis`:

- **Sin puerto publicado.** Sólo la red interna habla con él.
- **Con contraseña obligatoria** (`UVH_REDIS_PASSWORD_FILE` → `REDIS_PASSWORD`).
  El arranque de producción rechaza una credencial ausente, de ejemplo o
  demasiado corta, y también un host de loopback: un Redis por proceso no
  comparte nada, que es precisamente para lo que está.
- **`appendonly yes` con `appendfsync everysec`**: el trabajo encolado sobrevive
  a un reinicio del contenedor.
- **`maxmemory-policy noeviction`**: una evicción descartaría en silencio un job
  encolado o liberaría un lock todavía en uso. Con esta política Redis prefiere
  rechazar la escritura, lo que se ve como error en lugar de como trabajo
  perdido.

Para una instancia gestionada, apunta `REDIS_URL` (admite `rediss://` para TLS)
en lugar de `REDIS_HOST`/`REDIS_PORT`. El gate acepta ambos. Si el proveedor no
expone TLS, no publiques Redis a Internet en ningún caso: el modelo de
autorización de Redis es su contraseña y el aislamiento de red.

Prefijos: `REDIS_PREFIX` separa este despliegue de cualquier otro que comparta
la instancia; `CACHE_PREFIX` separa además las claves de caché. `REDIS_DB=0`
(colas y locks) y `REDIS_CACHE_DB=1` (caché) están separados por defecto.

## Dimensionado y alertas

Lo que hay que vigilar, y por qué:

| Señal | Qué significa | Acción |
|---|---|---|
| `uvh_event_cache_failed_over_60m_total` | El rate limiter cayó a PostgreSQL. La superficie pública sigue servida y sigue contando intentos, pero contra la base de datos | Ver Redis: conectividad, memoria, autenticación |
| `uvh_event_queue_metrics_unavailable_60m_total` | Una lectura de profundidad o antigüedad no se pudo hacer. Las cifras de cola no son de fiar mientras aparezca | Ver Redis antes de creer ninguna cifra de cola |
| `uvh_queue_*_pending_jobs`, `uvh_queue_*_oldest_job_age_seconds` | Profundidad y antigüedad **del broker configurado** (Redis en producción), por pool | Un pool con cola creciente y heartbeat sano apunta a un worker sobrecargado, no parado |
| `uvh_queue_failed_jobs` | Jobs agotados; siguen en PostgreSQL | Inspección manual de `failed_jobs` |
| `used_memory` vs `maxmemory`, `rejected_connections`, `evicted_keys` | `evicted_keys` debe quedarse en **0**: con `noeviction` cualquier valor mayor que cero indica que alguien cambió la política. `used_memory` al límite hará fallar escrituras | Ampliar memoria o revisar qué está creciendo (ver abajo) |

Sobre el crecimiento de memoria, la causa habitual no es el tamaño del producto
sino la retención: las claves de caché llevan TTL explícito, las de rate limit
el suyo, y el trabajo encolado se consume. Un Redis que crece sin parar suele
significar TTLs ausentes en código nuevo o una cola que ya no se drena.

## Modo degradado: Redis no responde

Por partes, con el comportamiento real de la aplicación:

- **Redirects y tráfico público anónimo**: siguen sirviéndose. El rate limiter
  usa su propio store (`CACHE_LIMITER=failover`, miembros `redis,database`), así
  que cuando Redis falla los intentos se cuentan en PostgreSQL y cada fallback
  incrementa `cache.failed_over`. El coste es que la base de datos vuelve a
  hacer el trabajo que el cambio a Redis le quitó, y sólo mientras dure.
- **Locks (MFA, verificación de dominios, configuración de webhooks, intents,
  rotación de secretos)**: fallan cerrado. La operación afectada devuelve error
  o no progresa; ninguna se ejecuta sin la exclusión mutua que necesita. No se
  pone un lock en un store `failover`: mover el dueño de un lock permitiría que
  dos procesos lo creyeran suyo.
- **Correo**: no se pierde. Si la publicación del job falla, la fila de
  `mail_outbox` vuelve a `pending` con `last_error=queue_unavailable`; si ni eso
  se pudiera escribir, `UvhHousekeeping` reclama la fila `queued` estancada.
  Perder el **contenido** del broker (reinicio sin persistencia, failover,
  `FLUSHALL`) se cubre igual: la fila sigue en PostgreSQL y el reconciliador la
  republica.
- **Webhooks**: el evento no se admite. La petición recibe `503` con
  `Retry-After` y no se aplica el cambio, en lugar de aceptarse y perderse.
- **Exportaciones y verificaciones DNS**: se rechazan o quedan pendientes de su
  reintento, con su propio contador de indisponibilidad.

## Procedimientos

**Reinicio o actualización de Redis**

1. Si hay réplica o failover gestionado, conmútalo antes de tocar el primario.
2. `AOF` está activo, así que un reinicio limpio no pierde trabajo encolado. Si
   el contenido se perdiera igualmente, el reconciliador de housekeeping lo
   recupera (véase arriba); el rastro visible es la antigüedad del trabajo
   pendiente más antiguo de ese pool, no un contador de pérdidas.
3. Tras el reinicio, comprueba en este orden: `PING` autenticado, que
   `uvh_event_cache_failed_over_60m_total` deja de crecer, que los heartbeats de
   los workers vuelven, y que la profundidad por pool vuelve a bajar.
4. Un lock atrapado en un Redis que se perdió se libera solo: los locks de Redis
   caducan con su TTL, no quedan huérfanos para siempre.

**Cambios en caliente que no hay que hacer**

- `maxmemory-policy` distinto de `noeviction`.
- `FLUSHALL`/`FLUSHDB` sobre la instancia de producción (el ensayo de pérdida de
  broker lo hace sobre la pila efímera de E2E, nunca aquí).
- Compartir la instancia con otra aplicación sin aislar por `REDIS_PREFIX`/base.
- Cambiar `CACHE_LIMITER` a un store por proceso (`array`, `file`): el gate de
  arranque lo rechaza a propósito.

## Coste medido del cambio de store

Una razón del cambio es la huella; la otra es el coste por intento. Medido
dentro del contenedor de la pila E2E (Windows + Docker Desktop, PHP y PostgreSQL
en contenedores), con las dos llamadas que hace el throttle en cada petición
(`tooManyAttempts` + `hit`) y 300 intentos por muestra:

| Store | Ronda 1 | Ronda 2 |
|---|---|---|
| `redis` | 1,95 ms | 1,27 ms |
| `database` | 5,52 ms | 5,24 ms |

Es decir, **~3,8 ms menos por intento** con Redis. La huella es coherente: una
pasada de 171 redirects con el store de base de datos (todos desde la misma IP)
escribió exactamente **2 filas** en `cache` —el contador y su ancla `:timer`—,
porque la clave del limitador es por IP y todo el tráfico tras un NAT compite
por la misma fila. Con el limiter en Redis esa tabla se queda vacía.

Lo que esta medición **no** sostiene: el residuo de +17,1 ms del ensayo de
contensión de alias ([`docs/redirect-and-webhook-availability-policy.md`](redirect-and-webhook-availability-policy.md))
no queda explicado por el limitador. ~4 ms es una parte, no el todo. Tampoco se
pudo medir la diferencia extremo a extremo en este equipo: el arranque del
framework por petición sobre un montaje de Windows costó ~3,3 s de media por
redirect, un orden de magnitud por encima de lo que se quiere comparar. La
comparación de latencia real sigue pendiente de un entorno autorizado.

## Evidencia

El comportamiento descrito está cubierto por pruebas automatizadas, no sólo por
configuración:

| Qué | Dónde |
|---|---|
| Un redirect se sirve con el backend de rate limit inalcanzable, y el intento se cuenta en el segundo store | `backend-laravel/tests/Feature/RateLimitFailoverTest.php` |
| La degradación queda registrada como evento operativo | `AppServiceProvider` (listener de `CacheFailedOver`) y la prueba anterior |
| Profundidad y antigüedad salen del broker, y una lectura fallida no se publica como cero | `backend-laravel/tests/Feature/QueueBacklogTest.php` |
| Las cadenas asíncronas completas (correo, webhook con reintento, analítica, export, DNS) corren sobre Redis | `npm run e2e:async` |
| Perder el contenido del broker no pierde trabajo: el reconciliador republica y el worker entrega | ensayo «broker loss» de `npm run e2e:async` |
| Redis sin contraseña, en loopback, con limiter no compartido o con `retry_after` corto **no** arranca en producción | negativos de `npm run release:boot` |
| La plantilla de producción describe la misma topología que el entorno que se arranca (o el contrato falla antes de levantar nada) | aserciones iniciales de `npm run release:boot` |
| Coste por intento de cada store del limitador, y la huella que deja en `cache` | medición de esta misma página (§ Coste medido) |
