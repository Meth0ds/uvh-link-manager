# Operación de las correcciones del 30/09/2026

## Configuración y alcance

Se mantiene una única modalidad `standard`, sin facturación ni precios inventados. `backend-laravel/config/entitlements.php` centraliza los límites efectivos. `WORKSPACE_MEMBERS_LIMIT` admite 1–10000 (por defecto 1000). Los límites de dominios/tokens/webhooks admiten 1–20; invitaciones 1–100; colecciones/etiquetas 1–500; plantillas 1–200. Las variables son `WORKSPACE_{DOMAINS,TOKENS,WEBHOOKS,INVITATIONS,COLLECTIONS,TAGS,TEMPLATES}_LIMIT`. Configuraciones inválidas impiden el arranque de producción. Cambiar configuración requiere reconstruir la caché de configuración y reiniciar workers.

Las cuotas se comprueban bajo el lock del workspace. El dato de uso es un snapshot, no una reserva. Los catálogos existentes superiores al nuevo límite se pueden leer y reducir: no se borran ni se truncan. Sus GET siguen devolviendo el catálogo entero; no hay paginación remota implementada. Las altas nuevas quedan limitadas.

`ANALYTICS_OVERVIEW_CACHE_SECONDS` vale 30 por defecto y se acota a 0–60; 0 desactiva la caché. Scope por workspace, enlace y rango. Los rangos móviles se agrupan en intervalos del TTL, por lo que los agregados pueden tener hasta un TTL de antigüedad. Cada construcción usa un snapshot PostgreSQL REPEATABLE READ. La consulta sigue autorizándose antes de acceder a caché. `purgeVerified` sólo es true con una ejecución reciente de housekeeping que haya completado todas las purgas de analítica y coincida con la política actual; no demuestra una política legal aprobada.

## Auditoría y recordatorios

Aplicar las migraciones `2026_09_30_000001` y `2026_09_30_000002` antes de arrancar el código nuevo. El outbox de auditoría se admite en la misma transacción que las mutaciones críticas compartidas de workspace, avisos de seguridad, creación/revocación de tokens y creación de webhooks. El historial se materializa después del commit; housekeeping recupera pendientes por lotes de 100 con SKIP LOCKED. Materializar y retirar el pendiente se hace en una sola transacción. Una caída del historial conserva el evento; una caída de admisión dentro de la transacción impide confirmar la mutación. Los llamadores legacy que escriben audit después de su operación conservan esa ventana anterior a la admisión: no se afirma que todas las operaciones históricas sean atómicas. No hacer rollback de la migración con eventos pendientes.

Los recordatorios llegan a propietarios y administradores verificados que conservan membresía: enlace que caduca en 24 horas, enlace con al menos 90 % del máximo de clics, token que caduca en siete días, invitación que caduca en 24 horas y entrega webhook agotada de los últimos 30 días. Lotes máximos de 20 por tipo, con ledger de generación y admisión transaccional de inbox/correo. Respetan immediate/daily_digest/in_app_only/disabled. Un evento consumido no vuelve a enviarse aunque se reejecute el scheduler. El ledger sin contenido personal se conserva 31 días; una nueva fecha/límite identifica una nueva generación.

La revocación individual admite aviso de seguridad, correo y auditoría junto con la revocación. Si no se puede admitir el correo, devuelve 503 y no revoca a medias. Revocar otras sesiones mantiene el contrato existente: sesión autenticada y CSRF, sin step-up; sirve para contener acceso comprometido incluso cuando se ha perdido el segundo factor. No modifica credenciales ni concede acceso. Es una decisión de alcance de esta corrección, no una afirmación de que se haya implantado reautenticación.

## Trazas, medición y alertas

nginx genera `$request_id` y lo pasa como valor FastCGI interno `UVH_REQUEST_ID`. Laravel genera uno si falta/no es válido; no confía en `X-Request-ID` enviado por el cliente. El ID opaco se devuelve en respuesta y acompaña logs, payload de cola, outbox de correo y auditoría. Los callbacks streaming y jobs síncronos restauran el contexto padre. No contiene cookies, tokens ni identificadores de usuario.

`/internal/metrics` mantiene su autenticación/red privada. Las series `uvh_http_duration_seconds_60m_{bucket,count,sum}` separan `phase=prepare` de `phase=stream`. Son **gauges de ventana móvil de 60 minutos**, no counters Prometheus: usar `histogram_quantile(0.95, sum by (le) (..._bucket{phase="prepare"}))`, sin `rate()`. Son aproximaciones por buckets, no percentiles exactos. Finalizar el callback de streaming no demuestra recepción íntegra por el navegador. Los contadores `http.stream_completed` y `http.stream_failed` expresan ejecución del servidor.

Objetivos iniciales del operador: preparación p95 ≤1 s y p99 ≤2 s; correo pendiente <5 min; heartbeat mail <120 s y scheduler <180 s; materialización de auditoría <15 min. Se deben revisar con tráfico representativo. Redirecciones se deben medir adicionalmente en el edge y desde fuera: los buckets globales de preparación no son un SLO específico de redirección.

El endpoint representa latidos ausentes/desconocidos con 86400 s; los umbrales también detectan un worker que nunca arrancó. Reglas listas para provisionar: `docker/monitoring/uvh.rules.yml`. Consultas para panel: p50/p95/p99 sustituyendo el cuantil de la expresión anterior; `uvh_mail_outbox_oldest_pending_age_seconds`; `uvh_queue_mail_heartbeat_age_seconds`; `uvh_audit_outbox_pending`. Configurar scrape con `job_name: uvh`, `/internal/metrics` y bearer desde un archivo de secreto, nunca poner el token en Git. Falta conectar el canal real de Alertmanager/Grafana, su guardia y el monitor público de `/status`; no se envían mensajes a terceros desde esta pasada.

Ensayo de aceptación real: detener únicamente queue-mail en un entorno de staging, esperar heartbeat y alerta recibida por el canal configurado, arrancarlo, comprobar recuperación y vaciado de cola. Registrar hora de detección/recepción/recuperación y responsable. Un fixture local o una regla escrita no acredita entrega de una alerta real.

## Dependencias e imágenes

Laravel 13.34.0, Flysystem 3.36.0 y CommonMark 2.10.3 son los tres cambios de paquete en composer.lock. Angular 22.2.1 (CLI/build 22.2.0), fast-uri 3.1.8 y transitivas compatibles reparan los avisos de npm. No se han usado --force ni legacy-peer-deps para saltar la resolución de peers. El lock de npm conserva las dependencias ajenas al subárbol actualizado.

Adminer5 y CoreDNS1.14.7 están fijados por digest. Pebble usa el mismo commit upstream b1e1ca4f3c30abb64111adaca4544bc5374cc306 recompilado con Go1.27.1 desde un archivo con checksum; su imagen runtime es scratch. CI escanea además el artefacto Pebble construido. El escaneo de 15 bases termina con cero CRITICAL pendientes y dos supresiones anteriores vigentes; el artefacto Pebble tiene escaneo separado limpio. Esto no certifica cada capa de una imagen promovida ni sustituye provenance de producción.

La comprobación estricta de digests termina con 15 imágenes, 36 referencias, cero fallos y cero consultas desconocidas. Hay 11 tags cuyo digest actual ha cambiado: los pins previos siguen consultables. Esa deriva se registra como mantenimiento; no se cambia automáticamente un binario probado por otro sin verificarlo.

## Reproducción de las comprobaciones

Desde la raíz, usar `docker compose -f docker-compose.local.yml --env-file .env.docker.local`. Calidad: `run --rm php composer quality`. Suite destructiva sólo contra test: `run --rm -e DB_DATABASE=uvh_test php php artisan test`; preparar esa base con `artisan migrate --force --no-interaction`. No ejecutar la suite contra uvh_local. Las cuatro migraciones locales pendientes se han aplicado con `migrate --force`, sin reconstruir ni vaciar la base.

Frontend, desde frontend/: `npm ci`, `npm run typecheck`, `npm run lint`, `npm test -- --watch=false --browsers=ChromeHeadless` y `npm run build`. En macOS indicar CHROME_BIN al Chrome instalado si no se detecta automáticamente.

Puertas: `npm run e2e`, `npm run e2e:async`, `npm run release:e2e`, `npm run release:boot`, `npm run e2e:backup`. Ejecutar secuencialmente cuando los recursos Docker son limitados; prepare.mjs/async instalan vendor compartido, por lo que no deben coincidir con suites PHP en curso. La primera repetición concurrente de navegador dio 30/31 con timeout de login. La repetición aislada dio 30/31 con abort de auth/me al abrir invitación; la reproducción aislada completa de roles pasó 1/1 en 51 s, y el login anterior también pasó. Se conservan los fallos y se comprueba de nuevo la suite completa, sin subir el timeout ni añadir retries. No se ha demostrado un fallo de autorización ni un bloqueo SQL.

Supply chain: `composer audit --locked`, `npm audit`, `node --test scripts/check-image-digests.test.mjs`, `node scripts/check-image-digests.mjs --fail-on-unavailable --json=<archivo>`, `node scripts/scan-pinned-images.mjs --json=<archivo>`. Logs y JSON de esta pasada en `.planning/2026-09-30-completion-audit-remediation/`.

## Evidencia actual de suites

- Frontend: instalación limpia npm ci; tipos/lint/build correctos; **597 pruebas**. Incluye identidad de notificaciones y respuestas tardías de Equipo.
- Backend: instalación del lock final, Pint **397 archivos**, Larastan sin errores; suite completa **854 pruebas / 6507 aserciones** en 114,13 s, incluida la carrera de admisión de administrador en los recordatorios.
- Smoke de imagen de producción reconstruida con código y lock finales: **2/2** (1,3 min).
- Navegador completo final: **31/31**, con la corrección de sincronización de MFA; sin retries añadidos.
- Composer audit y npm audit: cero avisos actuales. Regresión offline del verificador: 1/1.
- Async: **128/128**; boot: **56/56**; backups: **34/34**. En el fixture backup: RPO 2 s, RTO primary 7619 ms e isolated 4045 ms. No son compromisos de recuperación del despliegue real.
- Imágenes: **15/15 consultadas**, cero CRITICAL pendientes con dos excepciones anteriores vigentes; Pebble construido tiene escaneo propio limpio. Digests estrictos: **15 imágenes / 36 referencias**, cero fallos/desconocidos, once derivas de etiquetas.

La suite async y el contrato de boot se ejecutaron antes de la última actualización de CommonMark y las guardas finales de Equipo; la suite completa backend/frontend y el smoke/browser finales verifican esos cambios. No se afirma que cada ensayo histórico se haya vuelto a ejecutar tras un cambio ajeno a su superficie.

El primer lanzamiento manual de PHPUnit sin DB_DATABASE=uvh_test fue rechazado por el guard de TestCase antes de sus fixtures; no se trató como resultado de la app ni se ejecutó contra los datos locales. Los comandos y la suite final utilizan explícitamente la base de test.

Un fallo posterior de MFA sí identificó un defecto del arnés: evaluateAll podía capturar cero códigos entre el HTTP200 y el render. Se corrige esperando el primer/segundo código visible antes de leerlo, sin alterar las comprobaciones de seguridad ni los tiempos del producto. La suite completa posterior pasa **31/31** en 5,4 min tras ese cambio; registro, MFA y las dos capturas se ejercitan de nuevo. Los fallos anteriores quedan en los logs y no se ocultan con retries.

## Actualización01/10 — cancelación protectora de borrado

Antes de ejecutar esta versión, aplicar2026_10_01_000001_preserve_protective_deletion_audit mediante el servicio de migración habitual. Añade un booleano indexado sin borrar datos. Readiness exige la columna cancellation_audit_pending.

Cancelación restaura la cuenta aunque falle el servicio de auditoría; el marcador en account_deletion_requests conserva la obligación de registrar account.deletion_cancelled. La etapa protective_deletion_audits de uvh:housekeeping intenta hasta100 cancelaciones y admite el evento y limpia el marcador en un commit; audit_outbox materializa después. Si falla, la etapa informa error y el marcador permanece. No reutilizar/manipular esas filas para eludir el pendiente: una nueva solicitud recibe503 hasta su recuperación. No borrar el marcador manualmente. El mecanismo es prospectivo y no reconstruye cancelaciones históricas sin evidencia.

Requested/scheduled se admiten dentro de la transacción de negocio. account.deletion_link_intents_reconciled sigue separado para los contadores de reconciliación externa posterior. Pendientes las ventanas de eventos de ejecución/compensación automática anteriores.

Verificación del lote:932 backend/7066aserciones y625 frontend; Pint401/PHPStan0 y lint/tipos/build correctos. Logs deletion-* en .uvh-runtime. Navegador móvil con respuestas de borrado simuladas; sin nuevas puertas release/E2E ni evidencia productiva universal.

## Actualización 01/10 — eventos de contraseña e identidad

Los eventos auth.password_change, auth.password_reset, auth.email_change_requested, auth.email_change_cancelled y auth.email_change_confirmed se admiten en su transacción de negocio. Si audit_outbox no admite el evento exacto, el cambio revierte; si el historial no puede materializarlo, la admisión permanece recuperable en audit_outbox. Housekeeping conserva la recuperación habitual. No hay migración nueva en este lote.

Cambiar contraseña y solicitar/cancelar email revalidan vigencia y versión del actor bajo bloqueo. Confirmación de email permite reintento manual ante errores temporales sin conservar el bearer en URL. No eliminar marcas TOTP para permitir un reintento: usar el siguiente código del autenticador. Nuevas evidencias en .uvh-runtime/identity-*; el navegador usa respuestas simuladas.

Verificación final de este lote: **951 pruebas backend /7220 aserciones** en194,95s, exclusivamente uvh_test; **629 frontend**. Pint401 archivos y PHPStan sin errores; lint, tipos, compilación y git diff --check correctos. Regresiones de avisos y seguridad:59 pruebas/524aserciones. Captura móvil390px inspeccionada; recuperación de confirmación de email con respuestas simuladas, sin cambiar ninguna identidad real. Logs identity-* en .uvh-runtime.
