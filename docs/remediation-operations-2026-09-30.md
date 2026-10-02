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

## S01 — política compartida

El bundle Angular importa frontend/public/uvh-password-policy.v1.js desde auth/password-policy.ts. No modificar ese JS a mano: ejecutar php artisan uvh:emit-password-policy y copiar storage/app/password-policy/uvh-password-policy.v1.js a frontend/public antes de compilar. El guard ahora lee frontend a través de RepositoryRoot/UVH_REPO_ROOT y no omite la comparación en Docker. MAX_BYTES=72 refleja el máximo que ya aplicaban los endpoints; el mínimo sigue en caracteres y las estimaciones no sustituyen autorización/validación del servidor.

Evidencia actual957backend/7271aserciones,642frontend; lint/tipos/build,Pint401/PHPStan0. Matriz del plan S01 con cobertura parcial; operación productiva y cierre del resto del sistema aún pendientes.

## S01 — login sin MFA

La comprobación de contraseña permanece fuera de los locks; antes de conceder la sesión se comprueba su generación exacta y el estado de cuenta bajo lock. Sesión y evento auth.login sin MFA comparten commit. Error de admisión no deja sesión; error de materialización conserva audit_outbox y no exige revertir un acceso legítimamente concedido. No cambia la respuesta de registro pendiente ni el gate de verificación. La rama challenge/TOTP/recovery se revisará por separado y no se presenta como cubierta por este cambio.

Verificación nueva966backend/7309aserciones;Pint402/PHPStan0. Sin nuevos resultados frontend, E2E/release o producción real.

## S01 — admisión MFA

TOTP revalida cuenta y generación bajo lock SQL antes de consumir factor/reto. Sesión y auth.login comparten commit; con recuperación, consumo del código y eventos auth.mfa_recovery,low/exhausted,auth.login también comparten TX. Un fallo de admisión revierte SQL, pero las marcas de consumo del cache se conservan: iniciar otro login y usar el siguiente TOTP, o el código de recuperación cuyo consumo SQL fue revertido. No borrar marcas para permitir replay.

Verificación nueva978backend/7389aserciones;Pint403/PHPStan0. Logs s01-mfa-login-*;sin nueva evidencia frontend/E2E/release. Matriz conserva MFA parcial y S01 abierto.

## S01 — activación por email

Activación pending y legacy admiten los tres eventos exactos junto con bearer, credencial y legal_acceptances. Si falla admisión, todo SQL revierte y el bearer puede reintentarse; si sólo falla materialización, audit_outbox conserva evidencia durable para el drenaje habitual. Legacy rechaza cuentas que ya estén verificadas, incluso con un token residual válido sin consumir. Sin migración nueva. Evidencia:991backend/7489aserciones,Pint404/PHPStan0;s01-activation-*. Frontend sin cambios ni nueva verificación visual.

## S01 — registro y edición pendientes

Eventos exactos de registro y corrección de email se admiten junto con pendiente/generación/token/mail_outbox. Fallo de admisión revierte;historial indisponible deja evento durable drenado por mecanismo habitual. Las ramas destino ocupado/conflicto aplican mismo criterio y conservan correo huérfano/sello decoy. Con debug desactivado,se comprobó JSON de error idéntico y ausencia de nueva cookie ante caída de auditoría;las trazas de desarrollo no se usan como contrato productivo. Excepción23505 tras rollback conserva auditoría best effort de rechazo. No hay migración nueva. Evidencia1005backend/7587aserciones,Pint405/PHPStan0;s01-registration-*.

## S01 — entrega de verificación legacy

MailDeliveryEligibility acepta también bearer de verificación para cuenta heredada activa y aún sin verificar;las condiciones kind/hash/generación/used/expiry siguen siendo comunes. Tras activar/bloquear/eliminar dueño,la entrega pendiente pasa obsolete y elimina envelope. SQL indisponible conserva envelope y retry;tras recuperarlo,se entrega. ArrayTransport comprueba envío y activación sin proveedor real. Evidencia1022backend/7687aserciones,Pint406/PHPStan0;s01-verification-delivery-*. Primerquality terminó por timeout300s de Composer,Pint;repetido con misma orden y controles,correcto. Sin nueva migración.

## S01 — reto inicial MFA

Login revalida credencial/generación/estado bajo lock tanto con MFA como sin MFA. Reto sólo se guarda después de admitir su evento exacto;fallo cache revierte SQL. Si SQL falla después de cache,se intenta retirar secreto jamás publicado;si cache también impide limpiar,TTL300s limita residuo. No borrar marcas de consumo de factores anteriores para permitir reintento. Si sólo falla materialización de historial,el evento durable se drena como habitualmente y el reto legítimo sigue disponible. Evidencia1033backend/7748aserciones,Pint407/PHPStan0;s01-challenge-*. Sin migración ni nueva evidencia frontend/proveedor real.

## S01 — reautenticación y perfil

Reautenticación exige sesión no caducada/revocada y versión del actor actual bajo lock;rechazo409 no consume recovery ni refresca ventana. Perfil también exige email verificado y generación vigente. Eventos auth.mfa_reauthenticated/auth.profile_update comparten TX con mutation. Audit_outbox indisponible revierte ventana/códigos SQL/nombre;historial caído conserva evidencia durable. El TOTP consumido permanece marcado en cache aunque SQL revierta:usar siguiente código. Sin migración. Evidencia1051backend/7854aserciones,Pint408/PHPStan0;s01-reauth-profile-*.


## S01 — lecturas y ciclo de sesión

B68–B72: los cuatro lectores de cuenta rechazan contexto revocado/caducado/generación antigua con 401 sin cookie; fecha MFA procede de SQL. El listado conserva la sesión actual dentro de 100 filas y comunica el límite. hydrate rechaza owner bloqueado entre consultas y expires_at <= now. No cambia TTL ni requiere migración.

Logout es protector: no revertir revocación ni impedir borrar cookie porque audit_outbox falle. Si falla sólo el historial, drenar la admisión durable después; si falla la admisión, el cierre permanece y ese evento exacto no se garantiza. Los tests usan uvh_test, fallos inyectados y ninguna entrega real de correo.

Evidencia específica: 99 pruebas/850 aserciones, s01-read-session-green.log. Frontend: lint/tipos/build correctos y 642 pruebas, s01-account-read-frontend-tests.log. Suite completa: 1096/1096 backend, 8014 aserciones, 208,24 s; s01-read-session-full-backend.log. Pint 410 archivos/PHPStan sin errores: s01-read-session-static.log.


## S01 — apertura/confirmación y caducidad de recuperación

B73/B74: estado, bearer y evento exacto comparten commit. Solicitud pública conserva202 genérico ante fallo de admisión mail/audit, con rollback y sin job publicado; confirmación5xx conserva token para reintento manual. Historial caído conserva outbox materializable una vez. AccountRecoveryAdmissionException sólo distingue esa admisión para mantener respuesta uniforme; no cambia la política protectora de logout/incidente.

B75/B77: expediente, bearers de confirmación/finalización y sesión administrativa sólo válidos con fecha > now. No ampliar TTL. B76/B78: pantalla ofrece reintento temporal y restaura foco lógico sin pisar otra elección del usuario. Sin migración.

Evidencia:152 pruebas específicas/1569 aserciones; full1128/8235 en216,34s (s01-recovery-full-backend.log); Pint413/PHPStan0 (s01-recovery-static.log).651 frontend, lint/tipos/build correctos; resumen de terminal s01-recovery-frontend-verification-summary.json. Browser4 contextos,8 POST todos simulados y capturas inspeccionadas (s01-recovery-confirm-browser-final-complete.log); ningún proveedor real ni nueva puerta E2E/release. S01/S11/S10 mantienen sus pendientes respectivos.


## S01 — decisiones y contrato de recuperación

B79–B83 corregidos: decisión/exact-event en TX, target bloqueado rechazado, control independiente sin propietario en aprobación/finalización/listado, validación de respuesta pública Angular y elegibilidad de mail con MFA actual.32 regresiones backend y7 frontend nuevas. Baselines documentados en el informe.83/83 pruebas específicas,650 aserciones;658 frontend, lint/tipos/build correctos. Suite completa: 1160/1160 backend, 8412 aserciones, 210,00 s, exclusivamente uvh_test (s01-recovery-decision-full-backend.log). Calidad: Pint 415 archivos y PHPStan sin errores, exit0 (s01-recovery-decision-static.log). Sin entrega real ni cambio de layout; S01/S11/S10 siguen parciales y el objetivo global permanece activo.


## S01 — configuración MFA y reautenticación general

B84–B91 y G12 corregidos: presupuesto por cuenta en preparación/activación, email actual verificado en los seis mutadores, pendiente con caducidad exclusiva, ack validado, ventana fresca antes de credenciales y remedio de reautenticación usable desde ajustes para no-admin con MFA. Rol administrativo conservado. Análisis JSON corregido y15 entradas obsoletas retiradas del baseline, sin ampliar supresiones.29 pruebas backend y26 frontend nuevas; específico148/1428. Full1189/8604 en179s; Pint416/PHPStan0. Frontend final684/684, lint/typecheck/build exit0 (s01-mfa-configuration-frontend-final-verified.log). Browser4 contextos390/1440, claro/oscuro,8 POST simulados sin API real, retorno a la misma sección, sin desbordamiento ni errores de página; capturas móvil oscuro/escritorio claro inspeccionadas tras corregir el CTA (s01-mfa-reauth-browser-final.log). S01 y objetivo global activos; seguir incidente y completar gates por función antes de S02–S13.


## S01 — incidente y protección de otra cuenta (02/10)

B92–B94 corregidos: cookie/identidad ajena preservada, bearer con caducidad exclusiva y reintento manual tras fallo temporal con foco accesible. Contrato de respuesta validado (incluye current booleano); doble envío/estado destruido cubiertos. Copy aplicable a los avisos de contraseña y cierre de sesiones, con «exportaciones» en español.15 regresiones backend y15 frontend nuevas. Full1204/1204 backend,8712 aserciones,183,75s, sólo uvh_test (s01-incident-full-backend.log); Pint417/PHPStan sin errores, exit0 (s01-incident-static.log). Auditoría posterior no restaura accesos si falla; historial caído se recupera una sola vez. Browser4 contextos390/1440 claro/oscuro,8 POST todos simulados, foco y URL comprobados; no backend real ni proveedor. S01 sigue parcial y S02–S13 conservan alcance; siguiente bloque: verificación/reset/cambio de email y helpers pendientes.


Verificación final del lote de incidente:1204/1204 backend,8712 aserciones,183,75s (s01-incident-full-backend.log,exit0); Pint417 archivos/PHPStan sin errores (s01-incident-static.log,exit0).699/699 frontend y lint/typecheck/build exit0 tras el último ajuste de copy (s01-incident-full-frontend-final.log).Browser4 contextos,8 POST simulados, foco tras503/200, sin desbordamiento/error de página (s01-incident-browser-final.log,exit0); capturas390 oscuro/1440 claro inspeccionadas en el estado definitivo. git diff --check correcto. S01 sigue abierto; pruebas verdes de este lote no cierran la revisión de otras funciones ni los sistemas S02–S13.


## S01 — email y optimización del contexto (02/10)

B95–B101 corregidos: caducidad exclusiva en activación pending/legacy, reset y confirmación; cookie/identidad únicamente de la cuenta afectada; ack/current validados en UI; enlaces rechazados retiran formulario; nueva navegación renueva autoridad y destruye la pantalla anterior; ayudas Material dinámicas sin solapamiento.18 casos backend y44 frontend nuevos, baselines previos conservados en el informe. O01 centraliza respuesta de cierre y decoders; O02 centraliza ciclo de navegación para11 rutas y alias de invitación conservando reuse normal en otros formularios. Optimización añadida como requisito de S01–S13; no se afirma ganancia de rendimiento sin medición.

Frontend final743/743, lint/tipos/build exit0 (s01-email-actions-full-frontend-layout-final.log). Browser12 contextos390/1440 claro/oscuro,32POST íntegramente simulados; reintento503→200,400terminal en activación/reset, foco, segundo enlace misma pestaña, URL sin bearer y geometría sin hints solapados; capturas definitivas inspeccionadas (s01-email-actions-browser-layout-final.log). Sin datos reales, proveedores, workers/scheduler, migración, commit/push/deploy ni E2E/release nuevo. S01 y objetivo global continúan parciales.


Verificación definitiva S01 email/navegación/optimización:1222/1222 backend,8810aserciones,252,21s, uvh_test (s01-email-actions-full-backend-final.log,exit0). Pint418 archivos y PHPStan sin errores (s01-email-actions-quality-final.log,exit0); el ajuste posterior al lanzamiento de la suite fue sólo tipado/formato PHPDoc, sin cambiar comportamiento.743/743frontend y lint/tipos/build exit0 en el árbol final (s01-email-actions-full-frontend-layout-final.log). Browser12 contextos/32POST simulados con revisión visual y geometría (s01-email-actions-browser-layout-final.log,exit0).git diff --check correcto. No cierre global ni producción acreditada. Siguiente lectura: solicitudes forgot/resend, contrato público/timing, y fronteras restantes mfaReauthenticate/updateProfile; isPast en esos dos helpers sigue siendo candidato sin regresión nueva ni ID.


S01 — B102–B105/O03: caducidad exclusiva perfil/reauth; confirmaciones forgot/resend estrictas; reset sólo activo/verificado y suelo temporal250ms; siete SELECT de sesión duplicados retirados y una recarga de perfil. Controles específicos73/429+solicitudes ampliadas6/52, frontend757/lint/typecheck/build correctos, Pint420/PHPStan0. Suite backend completa pendiente de cierre en s01-public-session-full-backend.log. No cierre S01/S02–S13 ni E2E/producción acreditados; referencia detallada en project-completion-audit-2026-09-30.md.

Resultado final B102–B105/O03: full backend1242correctas/1fallo exclusivamente de declaración config; corregido sólo EnvTemplateContractTest y reejecutado4/395correctas, Pint fixtures finales correcto. No código productivo posterior al full ni suma de filtros como total. Frontend757/lint/tipos/build, Pint420/PHPStan0 y diff correcto. Cierre del lote de cambios, sin cierre de sistema ni objetivo.


S01 B106–B111/O04: aislamiento de documentos/ejecución CAPTCHA, estados duplicate-ready/close, token control, borrado de credencial visible al navegar, rol admin posterior a await y foco lógico sin quitar elección posterior.31controlesfrontend nuevos; full788 y lint/tipos/build exit0, backend CAPTCHA20/63, browser4contextos/16POSTsimulados/foco/overflow/capturas finales. No bypass API demostrado ni entrega/proveedor real. Carga extra del iframe al reset es tradeoff, sin ganancia de velocidad afirmada. S01 parcial y objetivo global activo; referencia detallada en informe de completion.

Ampliación B106 verificada: ready/challenge-open tardíos no reviven documento/ejecución;33pruebasfrontend nuevas, full790/lint/tipos/build correcto; browser4/16POSTsimulados/foco y otro foco conservado (s01-captcha-browser-definitive-keyboard.log). Backend sin cambio adicional,20/63controles. No se acreditan otros sistemas ni cierre global.


S01 B112–B115/O05 (2026-10-02): seis confirmaciones de mutaciones ahora decodificadas en ejecución, evitando éxito falso en registro/corrección, logout, cambio de contraseña y cancelación/acuse de exportación. Cinco reutilizan ok:true y registro requiere user:null; no cambia admisión/autorización backend ni política de reintento.44regresiones (baseline34fallos/10correctas; green44), frontend834/lint/tipos/build correctos; backend66/915 en uvh_test y browser4contextos/16POST simulados correctos. Inventario440archivos/2141funciones con nombre/1128callbacks/3firmas con líneas y hashes, propietarios propuestos y conciliación pendiente; no es cobertura de revisión. Véase informe completion e inventario2026-10-02. S01 parcial, S02–S13/producción pendientes. Sin nuevo full backend ni entrega/proveedor real.


Cierre definitivo de este lote (sin cierre de sistema): ajustado el aviso de logout del panel para no afirmar sesión vigente ante confirmación fallida. Después de ese último cambio:834/834frontend y lint/typecheck/build exit0 (s01-account-mutations-full-frontend-definitive.log). Inventario regenerado y440hashes contrastados con el árbol actual; Node --check y php -l correctos. Browser definitivo4contextos/16POST, foco y geometría, capturas390oscuro/1440claro inspeccionadas; backend66/915 específico, sin cambio productivo PHP. diff --check correcto. S01 parcial; objetivo activo, siguiente paso conciliación de funciones/helpers y UI MFA/cambios autenticados pendientes.
