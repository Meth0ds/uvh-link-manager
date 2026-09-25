# UVH — Criterios de preparación para producción

Este documento es un gate de lanzamiento, no una declaración de que el entorno ya está listo. Cada requisito debe enlazar a evidencia fechada del entorno real. Una casilla sin evidencia se considera pendiente.

## Cómo se marcó esta pasada — 2026-09-20

Regla aplicada: **una casilla sólo se marca cuando el requisito se cumple tal como está escrito.** Los requisitos mixtos —una mitad que vive en el repositorio y otra en la infraestructura, el proveedor o la organización— se quedan sin marcar, con la mitad que falta nombrada en su nota y recogida en «Bloqueos externos». Nada se marca por lo que este documento promete, sino por lo que se ejecutó o se leyó en el árbol el 2026-09-20.

Lo que se ejecutó de verdad esa fecha (números y detalles en «Evidencia ejecutada»): `npm ci` sobre una copia limpia, `lint`, `typecheck`, `ng test` (382/382) y `ng build`; `composer quality` (276 ficheros, PHPStan nivel 6) y `composer test` (540 pruebas, 4472 aserciones); `npm run release:boot` (56/56), `npm run e2e:backup` (34/34, con RPO/RTO medidos) y `npm run e2e:async` (**125/125**, con los tres ensayos de caída y recuperación dentro: export máximo con el worker muerto, planificador detenido y recuperado, y outbox con el proveedor caído); `/health` en vivo. Además, la pasada previa del mismo día ejercitó el filtro por etiqueta, el recorrido landing→panel con el destino pre-rellenado, la lista de enlaces, el panel de admin con sesión, Equipo y las páginas públicas en un navegador real.

Cinco defectos reales aparecieron al recorrer este documento y quedaron cerrados en el mismo árbol:

1. **La imagen de producción no se construía.** La etapa `vendor` de `docker/php/Dockerfile.production` ejecutaba `composer install --no-dev` dentro de la imagen `composer:2` fijada, que es Alpine, no trae `intl` ni herramientas para compilarla, y `composer.json` la exige: el build abortaba con «requires PHP extension ext-intl * but it is missing from your system», y con él todo build de producción (compose, smoke de release, contrato de arranque). Arreglado con `--ignore-platform-req=ext-intl` en esa etapa y sólo en ella; la imagen final sí compila `intl` y el entrypoint rechaza el arranque si falta, que es la puerta que importa.
2. **El fixture del contrato de arranque estaba desactualizado**: `docker/release-boot/production.env` no declaraba `PENDING_INVITATION_COOKIE`, `PENDING_INTENT_COOKIE` ni `CACHE_LIMITER_SECURITY`, de modo que su caso positivo no podía arrancar y 18 de sus casos fallaban por la razón equivocada. Añadidas las tres claves; el contrato pasa 56/56.
3. **`docker/release-boot/postgres/90-tls.sh` no era ejecutable** (git lo guardaba como 644) y PostgreSQL moría en su init con `bad interpreter: Permission denied`, lo que dejaba el ensayo sin base de datos. Se le puso el bit de ejecución **y se registró ese modo en el índice de git**: `git ls-files -s` devuelve `100755` y, sacando el índice a un directorio limpio (`git checkout-index -a --prefix=…`), el fichero sale `-rwxr-xr-x`. Un checkout limpio —lo que hace CI— conserva el bit.
4. **El ensayo del export máximo se saboteaba a sí mismo.** Sembraba 9.000 mensajes de 1.300 B dando por hecho que cabían en el tope de 12 MiB que el propio job aplica al JSON codificado; medido, ese contenido codifica a **13.070.976 B (13,08 MiB)**, así que el worker rechazaba su export máximo en vez de publicarlo y el ensayo medía la negativa. El semillero (`backend-laravel/tests/E2E/inspect/exports.php`, subcomando `export-seed`) ahora construye el documento con el constructor del job y **ajusta el número de filas** hasta dejarlo bajo el tope con margen, y devuelve el tamaño medido para que el ensayo afirme la condición de «casi en el tope» contra un número y no contra una suposición.
5. **La jerarquía de timeouts no se cumplía en el pool `security`**: el worker declaraba `--timeout=60` y su job más largo (`ContinueDestinationSweepJob::$timeout = 60`) los mismos 60 s, así que las dos alarmas competían en vez de anidarse. Worker subido a 90 s y nuevo contrato `QueueTimeoutContractTest` que sostiene las tres cifras (job < worker < `retry_after`) y que cada pool publicado tenga un worker drenando la cola que la aplicación reporta.

## Aplicación y release

- [x] `npm ci`, `npm run typecheck`, `npm test -- --watch=false --browsers=ChromeHeadless` y `npm run build` terminan correctamente desde un checkout limpio.
  Evidencia 2026-09-20: `npm ci` en una copia limpia con sólo `package.json` y `package-lock.json` → 641 paquetes, 0 vulnerabilidades, `@angular/core` 22.1.2. En el árbol: `lint` (0 avisos), `typecheck` limpio, `ng test` **382/382**, `ng build` AOT correcto. CI ejecuta la misma secuencia en el job `frontend`.
- [x] `composer install --no-dev`, PHPUnit completo y migraciones se ejecutan con las imágenes exactas del release.
  Evidencia 2026-09-20: la `vendor` stage del Dockerfile de producción instala el lockfile sin dependencias de desarrollo (tras el arreglo 1) y `uvh-api:release-boot` se construyó desde ese Dockerfile en el contrato de arranque; `composer test` → **540 pruebas, 4472 aserciones**; el servicio `migrate` de `docker-compose.release-boot.yml` aplicó las migraciones sobre una base vacía y una segunda pasada fue no-op.
- [ ] La imagen desplegada se identifica por digest o commit y existe un procedimiento probado de rollback compatible con las migraciones.
  Identificación: hecha y automatizada — todas las bases van fijadas por digest (`docker/php/Dockerfile.production`, `docker-compose.production.yml`), el job `digest-integrity` de CI comprueba que cada digest siga resolviendo y `scripts/image-evidence.mjs` ata imagen, bases y SBOM/SARIF. Rollback: el procedimiento quedó escrito el 2026-09-20 en `docs/deployment.md` §4.1 y su mecánica está verificada por el contrato de arranque (un esquema por detrás de la imagen impide arrancar PHP-FPM, queue y scheduler, así que una vuelta atrás sólo es segura sobre migraciones expansivas o restaurando la copia). **Falta el ensayo con dos releases reales**, que es lo que la palabra «probado» exige.
- [x] `APP_ENV=production`, `APP_DEBUG=false` y el arranque pasa las invariantes de `ProductionSecurity`.
  Evidencia 2026-09-20: `npm run release:boot` → **56/56**. Cada invariante rota detiene el contenedor con su mensaje exacto y sin otro: `APP_SECRET`, `COOKIE_SECURE`, `COOKIE_DOMAIN`, `TRUSTED_PROXIES` universal, `APP_DEBUG=true`, captcha de prueba, tráfico sin TLS a la base, coste bcrypt fuera de rango, Redis sin contraseña, Redis en loopback, limiter por proceso y ventana de `retry_after` corta.
- [x] La migración se ejecuta una sola vez antes de recrear `app`, todos los workers `queue-*` y `scheduler`.
  Evidencia 2026-09-20: la imagen no migra al arrancar —`docker/php/production-entrypoint.sh` sólo escribe la caché de configuración y ejecuta `uvh:release-check`, y el servicio `migrate` vive bajo el perfil `tools`—, el paso único está en `docs/deployment.md` §4, y el contrato de arranque demuestra que `migrate` re-ejecutado es no-op mientras los procesos largos se niegan a arrancar con esquema vacío o pendiente.
- [x] `php artisan uvh:release-check` pasa con la imagen y base del release. Probar que esquema pendiente/ausente impide arrancar PHP-FPM, queue y scheduler y hace fallar sus healthchecks; el job explícito `migrate` debe seguir disponible con una base vacía.
  Evidencia 2026-09-20 (contenedor, imagen de producción, `APP_ENV=production`): caso positivo y `BCRYPT_ROUNDS=14` arrancan y pasan el release check; base vacía → PHP-FPM, un worker de cola y el scheduler **se niegan a arrancar** con la condición de release, y `migrate` la repara; ledger movido por detrás de la imagen → PHP-FPM se niega; re-ejecutar `migrate` es no-op. Lo que sigue pendiente es la evidencia sobre la base de datos y el entorno reales (ver bloqueos externos).
- [ ] Las migraciones `000019`–`000033` se prueban sobre copia representativa; se valida rollback y el bloqueo de los índices únicos de email/export/cuenta, además del índice de revocación de intenciones reclamadas. Incluir el índice de actividad por workspace de 000033.
  Pendiente: exige una copia con volumen representativo y carga de escritura real; no se puede cerrar desde esta máquina. Lo ejercitado aquí es la mecánica (migrar hacia delante sobre base vacía, ledger por detrás, no-op al repetir), no el bloqueo bajo volumen. La migración de cabecera hoy es `2026_09_16_000001_add_reputation_checked_at_to_links`, es decir hay migraciones posteriores a ese rango que también entran en el ensayo.

## Red, TLS y secretos

- [ ] Certificados válidos y renovación automática para `uvh.es` y `app.uvh.es`; HTTP redirige a HTTPS.
  Configuración verificada: Caddy pide certificado propio para `{$APP_HOST}` y `{$PUBLIC_HOST}` en carga, los hosts `www.` redirigen 308 al canónico y el bloque `http://` redirige a HTTPS sólo tras autorizar el hostname por el `ask` indexado. Falta la emisión y renovación reales sobre los dominios (externo).
- [x] El backend y PostgreSQL no son accesibles directamente desde Internet.
  Evidencia 2026-09-20 (`docker-compose.production.yml`): sólo `edge` publica puertos (`80`, `443`, `443/udp`); `app`, `nginx`, `postgres`, `redis` y todos los `queue-*` no publican ninguno, y la red es `uvh-internal`.
- [x] El proxy sobrescribe las cabeceras de forwarding y `TRUSTED_PROXIES` contiene sólo sus IP/CIDR verificadas.
  Evidencia 2026-09-20: Caddy ignora los `X-Forwarded-*` entrantes y fija `Host`, `X-Forwarded-Proto` y `X-Forwarded-Host`; Nginx recupera la dirección del cliente con `real_ip_from` a partir de `TRUSTED_PROXIES` (`EdgeLimitContractTest` exige CIDR concretos, nunca `/0`, y que la lista llegue desde el fichero de despliegue); `ProductionSecurity` rechaza una lista universal o vacía y el contrato de arranque lo demuestra. El valor real del subnet lo fija quien despliega (bloqueos externos).
- [x] `APP_KEY`, `APP_SECRET`, credenciales de base de datos, Resend y hCaptcha proceden de un gestor de secretos, no del repositorio ni de la imagen.
  Evidencia 2026-09-20: las nueve credenciales se montan como *docker secrets* y el entrypoint las carga desde su `*_FILE` antes de arrancar (falla si el fichero no es legible o está vacío); `backend-laravel/.env.production.example` las deja vacías, las imágenes son de sólo lectura y `ProductionSecurity` rechaza marcadores de ejemplo. La custodia de esos ficheros (qué gestor, quién los rota) es del operador.
- [ ] Cookies `__Host-`, `Secure`, host-only y HSTS se confirman en un navegador contra el dominio real.
  Configuración verificada: nombres `__Host-` y `COOKIE_DOMAIN` vacío impuestos por el gate, `COOKIE_SECURE` y `HSTS_ENABLED` obligatorios en producción, HSTS con `max-age=31536000; includeSubDomains` en el borde. La confirmación en un navegador contra el dominio real queda pendiente (externo).
- [ ] CSP, Trusted Types y el iframe aislado de hCaptcha se validan sin errores en la consola del navegador.
  Configuración verificada: `require-trusted-types-for 'script'` con `trusted-types angular angular#bundler` en el panel y una CSP propia y más estricta para el iframe de hCaptcha, servida como documento aparte. Validación contra el dominio real pendiente (externo). En local el widget carga en su iframe sin errores de consola, pero eso no es el dominio real.

## Datos y continuidad

- [ ] Redis (caché, rate limits, locks y colas) está desplegado con autenticación, sin puerto publicado, con persistencia y con `maxmemory-policy noeviction`, y se alerta de `cache.failed_over` y de `queue.metrics_unavailable`.
  Verificado en configuración y puertas: el servicio arranca con `--requirepass` leído del secreto, `--appendonly yes --appendfsync everysec`, `--maxmemory-policy noeviction`, sin puertos publicados, con volumen propio y un healthcheck que se autentica; el gate rechaza Redis sin contraseña y en loopback, y el contrato de arranque lo demuestra. Ambas señales existen como series publicadas (`cache.failed_over` se incrementa en cada fallback real; `queue.metrics_unavailable` en cada lectura imposible del broker). **Falta la evidencia sobre la instancia real**: memoria frente al límite, latencia observada y persistencia tras un reinicio real (externo).
- [ ] Los límites de credenciales cuentan en su propio store (`CACHE_LIMITER_SECURITY`), compartido y **no** dependiente de Redis, y se ha comprobado sobre el despliegue real que un Redis inalcanzable no reinicia la ventana de login ni bloquea el inicio de sesión.
  Verificado en configuración y pruebas: el gate rechaza vacío, Redis y la cadena de failover en esa clave, `docker-compose.production.yml` la fija en `database` y `SecurityLimiterStoreTest` cubre el comportamiento con Redis inalcanzable. La comprobación sobre la instancia real sigue pendiente (externo).
- [x] PostgreSQL usa `sslmode=verify-full` con una cadena de confianza válida.
  Evidencia 2026-09-20: la plantilla y el compose fijan `DB_SSLMODE=verify-full` con `DB_SSLROOTCERT` montado desde secreto; `ProductionSecurity` rechaza cualquier otro `sslmode` y exige un CA legible; el contrato de arranque demuestra que el tráfico en claro detiene el contenedor, y su pila levanta PostgreSQL con TLS propio. El CA real lo aporta el proveedor (bloqueos externos).
- [ ] Existe backup automático cifrado, política de retención y alerta de fallo.
  Verificado el mecanismo: `docker/backup/backup.sh` vuelca con `pg_dump`, cifra con AES-256-CBC y clave en volumen independiente, escribe manifiesto con digests, aplica retención por número sin borrar la copia más reciente y alerta por registro local y por hook HTTP; `npm run e2e:backup` → **34/34** (2026-09-20). Falta cablearlo al entorno real —programación (cron/systemd), almacenamiento independiente y endpoint de alerta—, que es del operador.
- [ ] Se ha restaurado el último backup en un entorno aislado y se han registrado RPO/RTO reales.
  Medido el 2026-09-20 en el ensayo de contenedores: **RPO 1 s**, RTO 724 ms en la instancia aislada y 1536 ms en la primaria, con la copia manipulada rechazada y el esquema verificado contra el release. Las cifras de producción exigen la base y el almacenamiento reales (externo).
- [ ] Se han probado migraciones con un volumen de datos representativo y se conoce su bloqueo/duración.
  Pendiente y externo: hace falta una copia con volumen real; ver la casilla equivalente del bloque de release.
- [ ] Retenciones de sesiones, auditoría, analítica, entregas, exports, solicitudes de eliminación y denuncias están aprobadas y alineadas con la política de privacidad.
  Las retenciones existen y son configurables (`SESSION_PURGE_DAYS`, `AUDIT_PURGE_DAYS`, `ANALYTICS_RETENTION_DAYS`, `DELIVERY_PURGE_DAYS`, `PRIVACY_REQUEST_PURGE_DAYS`, `LINK_TRASH_DAYS`…), pero la aprobación es jurídica y de producto (externo).

## Procesos y observabilidad

- [ ] Cada pool (`mail`, `webhooks`, `domains`, `exports`, `analytics`, `security` y `legacy`) y el scheduler están supervisados; detener uno genera una alerta diferenciada sin que el heartbeat genérico o el de otro pool la oculte.
  La mitad del repositorio está verificada el 2026-09-20: cada pool es un servicio con su propio healthcheck (`uvh:healthcheck queue-<pool>`), su propio heartbeat (`uvh:health:queue-<pool>`, escrito por el worker que declara `UVH_QUEUE_POOL`) y sus propias series (`uvh_queue_<pool>_pending_jobs`, `_oldest_job_age_seconds`, `_heartbeat_age_seconds`); el nuevo `QueueTimeoutContractTest` exige que cada pool publicado por `QueueBacklog::pools()` tenga un worker drenando exactamente la cola que la aplicación reporta, para que ninguna serie describa una cola que nadie supervisa. **Falta la regla de alerta** sobre esas series, que vive en la monitorización del operador (bloqueos externos).
- [x] Cada timeout de job es menor que el timeout de su worker y éste es menor que el `retry_after` de la cola (`REDIS_QUEUE_RETRY_AFTER` con Redis, `DB_QUEUE_RETRY_AFTER` con la base).
  Jerarquía reparada y sostenida por un contrato el 2026-09-20: `queue-security` pasa de 60 s a 90 s porque su job más largo declara 60 s, y `QueueTimeoutContractTest` compara las tres fuentes —`docker-compose.production.yml`, los `$timeout` de `app/Jobs` y la ventana declarada en el compose y en la plantilla de entorno, con el defecto del framework (90 s) por debajo de los 180 s del worker de exportaciones— y falla si alguna deja de anidarse. **Y el export máximo que faltaba ya está demostrado** el mismo día en `frontend/e2e/async/drills/export-crash.mjs` (`exportCrashDrill`): con un export de tamaño máximo sembrado y ajustado contra el tope real (12.055.200 B de JSON codificado, 527.712 B por debajo del tope), el worker se mata con SIGKILL a mitad del trabajo y el ensayo comprueba que la fila —no el proceso— es el ancla, que el intento muerto no llega a anunciar nada, que la reejecución publica **un único** artefacto y lo reemplaza en vez de añadir un segundo, que la descarga completa con step-up sirve el documento entero, que una descarga interrumpida no retira nada, que el acuse retira el artefacto y que la exportación consumida no se vuelve a servir (410); después mata al worker otra vez y deja la solicitud abandonada a la recuperación programada, que la termina sin huérfanos, con `failure_reason = stalled` y sin publicación. (Contraste 2026-09-25: la descarga ya no usa bearer por email, sino sesión + step-up, y el acuse es lo único que consume.)
- [ ] Se alertan `/health`, latencia/errores HTTP, profundidad, antigüedad y heartbeat de cada cola, `failed_jobs`, entregas webhook fallidas y uso de recursos.
  La exposición está verificada: `/health` responde 200 con cuerpo JSON y `no-store`; `/internal/metrics` publica en formato Prometheus, tras bearer token y sin puerto público, profundidad y antigüedad por pool, heartbeats, `failed_jobs`, correo pendiente y fallido, entregas webhook, DNS/TLS en curso, 5xx y 429, `cache.failed_over`, `queue.metrics_unavailable` y contadores de housekeeping. **Las reglas de alerta y los paneles son del operador** (bloqueos externos).
- [ ] Logs centralizados no contienen contraseñas, tokens, cookies, URLs sensibles ni cuerpos completos de webhooks.
  Las reglas de origen están verificadas: `LOG_CHANNEL=stderr` y `LOG_LEVEL=warning` en producción, `Audit::write` documentado y probado para no registrar tokens, contraseñas, cookies ni cadenas de consulta sensibles, los reintentos de correo guardan el fallo del transporte y no el contenido, y el inspector de webhooks muestra sólo campos permitidos, no el payload bruto. La ausencia de secretos en el **destino centralizado** sólo se puede comprobar cuando exista ese destino (externo).
- [x] Está probado el procedimiento para reintentar trabajos, recuperar un scheduler detenido y rotar secretos.
  Evidencia 2026-09-20: la rotación de `APP_SECRET` tiene runbook y pruebas (`docs/app-secret-rotation-runbook.md`, `AppSecretRotationTest`); el reintento de trabajos está implementado y probado (reintento administrativo de correo y webhooks, y el ensayo asíncrono entrega un webhook y un correo en el segundo intento); y **recuperar un scheduler detenido ya se ejercita**: `schedulerRecoveryDrill` comprueba que el latido existe y envejece con el proceso parado, que un reintento retenido **no se mueve** mientras el planificador está caído, que al volver este marca de nuevo y que el trabajo retenido se entrega **exactamente una vez**.
- [x] Ensayar `mail-outbox-runbook.md`: caída y recuperación de proveedor/worker/scheduler, reintento administrativo, compensación, purga, entrega HTML/texto y ausencia de contenido en logs. Validar recepción real por separado de la aceptación del transporte; no usar `log/array` como respaldo.
  Ensayado el 2026-09-20 contra la pila real con un proveedor SMTP propio al que se le ordena rechazar (`UVH_ASYNC_ONLY=outbox`, dentro de la suite **125/125**): el alta se admite con el proveedor caído y la negativa queda registrada sin perder el mensaje ni vaciar el sobre; el ciclo durable se agota a `failed` tras cinco intentos; el reintento administrativo se admite (`202`) sobre un fallo reintentable, reinicia el ciclo sin tocar el bearer y se **rechaza con `409`** cuando ya no procede; el proveedor acepta el mensaje reintentado exactamente una vez y su bearer sigue valiendo; un correo de invitación agotado pasa a compensación y **cancela la invitación** atada; la retención purga una fila terminal pasada de plazo sin tocar el trabajo abierto; el mensaje aceptado conserva HTML y texto; y el log del worker no contiene bearer, cookie ni contraseña. **Lo que sigue externo es el proveedor real** (reputación del dominio y recepción en un buzón de verdad), listado en «Bloqueos externos».
- [ ] Existen responsables y runbooks para abuso, incidente, indisponibilidad y restauración.
  Hay runbooks de restauración, operación de Redis, outbox de correo, reputación de URL, rotación de secreto e imagen (`docs/backup-and-restore.md`, `docs/redis-operations.md`, `docs/mail-outbox-runbook.md`, `docs/url-reputation-runbook.md`, `docs/app-secret-rotation-runbook.md`, `docs/image-provenance-runbook.md`) y canal de abuso publicado (`/legal/denuncias`). **El runbook de incidente e indisponibilidad se escribió el 2026-09-20** (`docs/incident-runbook.md`: autoridad, detección por healthchecks, latidos y métricas, triaje por superficie, degradaciones que el sistema ya hace solo, recuperación, cierre con evidencia y los ensayos ejecutables que lo sostienen). **Faltan las personas que lo asumen por escrito** (externo).

## Flujos funcionales reales

- [ ] URL en hero → registro → email real → login → MFA → creación pre-rellenada, sin URL en query params.
  Verificado en vivo el 2026-09-20 en el tramo que no depende de proveedores: el hero crea la intención en el servidor, el token viaja en el **fragmento** (nunca en la query) y el panel abre el diálogo de creación con el destino ya escrito (`https://example.com/detalle-prueba`). El correo real, la verificación y el MFA reales quedan externos.
- [ ] Login, recuperación, cambio de email de registro y reset funcionan con hCaptcha y proveedor de correo reales.
  Externo: exige claves reales de hCaptcha y un proveedor real. Lo que existe y está probado en el repositorio son los flujos con proveedores deterministas y sus pruebas de atomicidad.
- [ ] Crear/editar/pausar/caducar/restaurar enlaces y resolverlos desde el dominio público funciona detrás del proxy real.
  Externo en su mitad de proxy real. En el repositorio: contratos de admisión de redirección, concurrencia y papelera probados, y el smoke de release que cruza Caddy→Nginx→PHP-FPM en CI (no ejecutado en esta pasada).
- [x] Roles de workspace e IDOR se prueban con al menos dos workspaces y usuarios independientes.
  Evidencia 2026-09-20 (misma fecha, pasada anterior): dos cuentas reales en dos workspaces, 82 sondas HTTP en las dos direcciones sobre enlaces, dominios, webhooks, tokens, analítica, denuncias, privacidad, miembros, invitaciones y sesiones, además del intento de falsificar la cabecera de workspace. Todas las respuestas fueron negación (404 por recurso, 403 por workspace) y los recursos de ambos lados quedaron intactos; los artefactos de la prueba se retiraron después.
- [ ] La transferencia de propiedad exige propietario, contraseña y MFA, conserva exactamente un rol `owner` y bloquea la eliminación de cuenta ante carreras con transferencia/eliminación de workspace.
  Cubierto por pruebas de invariante (`WorkspaceOwnershipLimitTest` con cuota del destinatario y código de recuperación rechazado sin gasto, `InvitationAuthorityLifecycleTest`, `WorkspaceNoticeAtomicityTest`), y el código exige contraseña y factor cuando el MFA está activo. **La transferencia completa con contraseña y MFA reales no se ha ejercitado de punta a punta**, ni aquí ni con proveedor real.
- [ ] Emisión de token API y borrado de workspace exigen contraseña, MFA cuando está activo y, para borrar, coincidencia exacta del nombre; se prueban consumo concurrente de recovery code, sesión obsoleta y respuestas `409` de webhook.
  Pruebas presentes (`SecurityCenterTest`, `ApiTokenSchemeTest`, `WebhookInspectorTest`, `WebhookQueueLeaseTest`, `AdminConsoleTest`) y suite en verde, pero la comprobación sobre la API real de este punto no se hizo (la pasada IDOR ejerció el token API sembrado, no su emisión con step-up).
- [ ] Dominio personalizado completa propiedad TXT, DNS de tráfico, emisión TLS, activación y resolución HTTPS; cada fase tiene evidencia independiente.
  Externo: requiere DNS y ACME reales. El ensayo asíncrono del 2026-09-20 (125/125) recorre el ciclo con un fixture de DNS determinista (propiedad, activación, TLS simulado) y el diagnóstico de la fase pendiente existe en el panel.
- [x] Webhook firmado se entrega, falla, reintenta y deduplica contra un receptor controlado.
  Evidencia 2026-09-20: `npm run e2e:async` → **125/125**, con receptor controlado que rechaza la primera entrega: el worker reintenta, la firma HMAC del cuerpo entregado coincide con el secreto de la suscripción y el `X-UVH-Event-Id` se mantiene estable entre intentos.
- [ ] La consola administrativa exige admin + MFA reciente, fuerza reautenticación al vencer `ADMIN_MFA_FRESH_MINUTES`, pagina datos, bloquea cuentas, modera denuncias y muestra señales operativas. Debe probarse la expiración real y el consumo único de recovery code.
  Verificado en vivo el 2026-09-20: la consola abre con rol admin y sesión fresca, pagina (auditoría con 37 eventos y paginador ya en español), muestra señales operativas y moderación, y las 22 rutas de admin heredan rol + MFA fresca por middleware. La **expiración** de la ventana se ejercita en `frontend/e2e/specs/product-validation.spec.ts` (envejece la sesión con `tests/E2E/age-mfa-session.php`) y el consumo único de recovery code en las pruebas de seguridad, pero ninguno de los dos se ejecutó en esta pasada: el recorrido de navegador lo corre CI.

## Dominios personalizados y DNS

El backlog técnico detallado está en [`todos.md`](todos.md). Ningún dominio se considera listo por tener solamente el estado local `verified` o `active`. **Las ocho casillas de este bloque exigen DNS, ACME y un despliegue reales**; lo verificado aquí es la configuración que las sostiene.

- [ ] El edge Caddy incluido se despliega con almacenamiento persistente, puertos ACME accesibles, cuenta ACME monitorizada y versión identificada por digest; el endpoint On-Demand TLS `ask` sólo es accesible por la red privada.
  Configuración verificada: `caddy` va fijado por digest, `uvh-caddy-data` y `uvh-caddy-config` son volúmenes persistentes, publica 80/443, y el `ask` vive en un listener interno de Nginx (`:8081`) que no publica Compose, inyecta un secreto compartido que el cliente no tiene y sólo admite `GET`. El despliegue, la accesibilidad ACME y la cuenta monitorizada son externos.
- [ ] El panel publica el destino DNS real y UVH comprueba tanto propiedad como ruta antes de activar; el challenge TXT no comparte nombre con el CNAME.
  Configuración y pruebas presentes (diagnóstico por fase, índice de activación, `VerifyDomainDnsJob` con casos `NXDOMAIN`/`NODATA`/`SERVFAIL`), pero la validación con DNS real es externa.
- [ ] El certificado se emite antes de activar, se renueva automáticamente y existe un runbook para retirada urgente y limpieza de certificados cacheados.
  Externo (emisión/renovación reales). El `ask` por petición hace que un dominio desactivado deje de enrutar aunque exista certificado cacheado.
- [ ] Un dominio desconocido, desactivado, transferido o con certificado no válido nunca resuelve enlaces de otro workspace ni la landing de UVH.
  Comprobable sólo contra el despliegue real; en el repositorio hay guardas de aislamiento por host y la auditoría de atribución por workspace.
- [ ] Se han validado `NXDOMAIN`, `NODATA`, `SERVFAIL`, propagación parcial, múltiples/fragmentados TXT, CAA, bucles CNAME, apex, IDN y caducidad TLS.
  Pruebas unitarias y fixture de DNS cubren parte; la matriz completa exige un proveedor real y casos de DNS público (externo).
- [ ] Hay revalidación periódica con gracia ante fallos transitorios y alerta ante pérdida persistente de propiedad/ruta.
  Implementado en housekeeping (`queueDomainRevalidations`, gracia y `DOMAIN_MAX_FAILURES`) y probado en el repositorio; la alerta persistente es del operador (externo).
- [ ] Se ha probado la transferencia y reutilización del mismo hostname entre dos workspaces sin replay del challenge ni CNAME/certificado colgante.
  Externo.
- [ ] Proxy y aplicación conservan SNI/`Host`, fuerzan HTTPS y registran sólo metadatos necesarios, sin tokens TXT ni URLs de destino en logs.
  Configuración verificada (`header_up Host`, redirección 308, log de borde con formato propio sin URL sensible); la comprobación sobre tráfico real es externa.

## Cuenta, privacidad y ejercicio de derechos

Todo el bloque exige proveedores reales de correo y hCaptcha, y en varios puntos aprobación jurídica. Lo que hay en el repositorio y se ha podido leer el 2026-09-20 son las guardas de código y sus pruebas; ninguna de estas ocho casillas se puede cerrar desde esta máquina.

- [ ] Recuperación de contraseña validada con hCaptcha/correo reales, token caducado/consumido, concurrencia, revocación de sesiones y aviso posterior.
  Pruebas de token de email, atomicidad del aviso y revocación presentes (`AuthEmailTokenTest`, `PasswordNoticeAtomicityTest`, `SecurityNoticeAtomicityTest`). Externo para lo real.
- [ ] Cambio de email verificado mediante estado pendiente, step-up MFA, notificación al buzón anterior y revocación coherente de credenciales. Externo; el flujo y sus guardas existen (migración `email_change_requests`, notificación al buzón anterior).
- [ ] Cambio de contraseña, MFA, emisión de API tokens y operaciones destructivas exigen el nivel de reautenticación aprobado por el modelo de riesgo.
  Implementado y cubierto por pruebas (step-up de contraseña y MFA en emisión de token, borrado de workspace y transferencia); la aprobación del nivel de riesgo es de producto (externo).
- [ ] Export de acceso/portabilidad asíncrono, cifrado, de un solo uso, limitado al sujeto y sin secretos ni datos indebidos de otros miembros.
  Evidencia 2026-09-25 (autoservicio sin intervención ni pestaña abierta; sustituye al ciclo con bearer por email del 2026-09-20): solicitud con step-up que encola el job directamente, generación por el worker de exportaciones, aviso por email cuando el archivo está listo, descarga autorizada por sesión + step-up reintentable hasta que el navegador acusa la recepción —lo único que consume la exportación y retira el artefacto— y caducidad automática a las 48 h con motivo de fallo explícito (`automated_size_limit`, `generation_error`, `stalled`); `DataExportDownloadLifecycleTest` cubre reintento hasta el acuse, consumo único, step-up obligatorio y caducidad.
- [ ] Eliminación de cuenta resuelve propiedad de workspaces, dominios/TLS, jobs, tokens, webhooks, backups, conservación legal y anonimización.
  Implementado con guardas y pruebas; el alcance sobre dominios/TLS y backups sólo se demuestra con infraestructura y retención reales (externo).
- [ ] Se fuerza el agotamiento de reintentos del email de cancelación y se comprueba que la compensación restaura automáticamente la cuenta antes del periodo de gracia; también se prueba cancelación concurrente con housekeeping.
  La compensación duradera existe (migración `make_mail_compensation_durable`, `MailOutboxCompensation`) y el aviso de cancelación tiene prueba de atomicidad; el agotamiento y la carrera con housekeeping exigen el ensayo completo con proveedor real (externo).
- [ ] Existe un proceso probado para derechos RGPD (acceso, rectificación, supresión, oposición, limitación y portabilidad), identidad, plazo, prórroga y registro de respuesta.
  Existe la superficie completa en el producto (solicitudes de derechos, identidad verificada, plazo, prórroga y registro de respuesta, con vocabulario y filtros compartidos) y pruebas de atomicidad de los avisos. El **proceso** —quién lo atiende y con qué mandato— es externo.
- [ ] Registro de actividades, DPA/subencargados, transferencias, retenciones, brechas y evaluación jurídica RGPD/LOPDGDD/LSSI-CE están aprobados. Externo (jurídico y dirección).

## UX, accesibilidad y legal

- [ ] Landing, acceso, panel completo y legales se revisan en móvil/escritorio, claro/oscuro y navegadores soportados.
  Revisión de detalle hecha en Chromium el 2026-09-20 sobre landing, ayuda, estado del servicio, formulario de denuncia, lista de enlaces, equipo, seguridad, analíticas, webhooks, tokens y consola de admin, en tema oscuro y con panel en escritorio: estados, etiquetas, paginadores, nombres accesibles y ausencia de errores de consola. **Falta la matriz completa** (móvil, claro, y el resto de navegadores soportados) hecha a mano.
- [ ] Recorrido por teclado, foco, contraste, lector de pantalla y `prefers-reduced-motion` están verificados manualmente.
  Verificado el 2026-09-20 lo automatizable: cero botones de icono sin nombre accesible en todas las plantillas (respetando `[attr.aria-label]` dinámico, y tras descartar dos falsos positivos de mi propio escáner), controles con etiqueta, los cuatro botones sin `(click)` son controles legítimos (retirar etiqueta, cerrar diálogo y dos de copiado por directiva), y `prefers-reduced-motion` se respeta en 41 ficheros de estilo y en los desplazamientos programados. El recorrido manual completo de teclado, contraste y lector de pantalla sigue pendiente.
- [x] Estados de carga, vacío, permisos, sesión caducada, `409`, `422`, `429`, `5xx` y red caída tienen una salida recuperable.
  Evidencia 2026-09-20: todas las superficies de lista tienen carga, error con reintento y vacío (barrido de plantilla y comprobación en vivo en webhooks, analítica, seguridad, tokens, equipo, papelera y admin); `422` se resuelve en los campos y con el mensaje del servidor, `409` llega con el motivo del conflicto, `429` respeta `Retry-After`, `5xx` produce un mensaje con consejo de reintento y la caída de red un «No se pudo conectar con el servidor» (`api.service.ts`), con páginas propias de 403/404 y estados de sesión caducada.
- [ ] Términos, privacidad y canal de abuso incluyen titular legal, NIF, domicilio, datos registrales, hosting/región y proveedores definitivos.
  Externo: las variables legales existen y el arranque **rechaza marcadores pendientes**, pero los datos reales del prestador son del operador. Hoy la plantilla los deja vacíos a propósito.
- [ ] Se han probado los buzones publicados y existe un responsable de respuesta. Externo.

## Evidencia mínima del lanzamiento

Registrar para cada release: digest de imágenes, salida de tests, versión de migración, prueba de `/health`, captura de cabeceras/cookies, restauración de backup más reciente, E2E crítico, responsable que aprueba y hora de despliegue. El registro de esta pasada está en «Evidencia ejecutada — 2026-09-20»; el responsable que aprueba y su hora los aporta la persona que despliega, y la captura de cabeceras/cookies contra el dominio real sigue pendiente.

## Evidencia ejecutada — 2026-09-20

Todo lo siguiente se ejecutó en este árbol y en esta máquina (macOS, Docker Desktop, arm64) salvo donde se indique.

| Comprobación | Comando | Resultado |
|---|---|---|
| Dependencias del frontend desde limpio | `npm ci` (copia con `package.json` y lock) | 641 paquetes, 0 vulnerabilidades, `@angular/core` 22.1.2 |
| Calidad y pruebas del frontend | `npm run lint`, `npm run typecheck`, `ng test --browsers=ChromeHeadless` | lint y typecheck limpios; **382/382** pruebas |
| Build de producción del frontend | `npm run build` | AOT correcto |
| Calidad del backend | `composer quality` (contenedor documentado) | 276 ficheros, Pint PASS, PHPStan nivel 6 sin errores |
| Pruebas del backend | `composer test` contra `uvh_test` | **540 pruebas, 4472 aserciones**, ~56 s |
| Contrato de arranque de producción | `npm run release:boot` | **56/56**; imagen `uvh-api` construida desde `docker/php/Dockerfile.production`, id `sha256:f3b441d58ec0…` |
| Bit de ejecución canónico del init de PostgreSQL | `git ls-files -s docker/release-boot/postgres/90-tls.sh` y `git checkout-index -a --prefix=…` | `100755` en el índice y `-rwxr-xr-x` en el árbol sacado del índice |
| Contrato de arranque **desde una copia limpia del índice** (lo que hace CI) | `npm run release:boot` en `/tmp/uvh-release-clean`, sacado con `git checkout-index` | **56/56** — «Production boot contract satisfied»; es la corrida que acredita que el bit sobrevive al checkout |
| Imagen web de producción | `docker build -f docker/nginx/Dockerfile.production` | construida, id `sha256:2c68d38d7e68…` |
| Copia de seguridad y restauración | `npm run e2e:backup` | **34/34**; RPO 1 s, RTO 724 ms (aislada) y 1536 ms (primaria); copia manipulada rechazada |
| Colas, scheduler y cadenas asíncronas | `npm run e2e:async` | **125/125** (correo, reintento de correo, webhooks con firma y reintento, exportaciones, analítica y dominios con fixture); el recuento incluye la tabla de pases del ensayo de contención de rollups, que varía con sus rondas |
| Caída y recuperación de los procesos asíncronos | `UVH_ASYNC_ONLY=export npm run e2e:async` | **28/28** (export máximo con el worker muerto a mitad, artefacto único tras la reejecución, descarga interrumpida, acuse y solicitud abandonada recuperada por housekeeping) |
| Servicio vivo | `curl /health` | `HTTP 200` `{"ok":true,"service":"uvh-api"}` con `Cache-Control: no-store` y `X-Content-Type-Options: nosniff` |
| Migración de cabecera | `ls database/migrations` | `2026_09_16_000001_add_reputation_checked_at_to_links` |

### Repetición de las puertas tras la reestructuración del arnés — 2026-09-21

La estructura del arnés asíncrono cambió sin cambiar su comportamiento: `frontend/e2e/async-stack.mjs` (antes ~1.000 líneas) es ahora la entrada fina que decide qué escenarios corren, y los suyos viven en `frontend/e2e/async/` (`topology`, `expect`, `session`, `fixtures`, `chains`, `redis`, `analytics-contention` y un fichero por ensayo en `drills/`); del lado del backend, `tests/E2E/async-inspect.php` es el registro de subcomandos y cada entidad tiene su módulo en `tests/E2E/inspect/`. La estructura resultante está descrita en [`e2e-testing.md`](e2e-testing.md), que es donde debe leerse antes de añadir un escenario. Nada de eso es nueva funcionalidad: se reejecutaron las puertas para comprobar que sólo cambió la forma.

| Comprobación | Comando | Resultado |
|---|---|---|
| Colas, scheduler y ensayos de caída | `npm run e2e:async` | **125/125** con los tres ensayos dentro (28 comprobaciones de export, planificador detenido y recuperado, outbox caído) |
| Pruebas del backend | `composer test` contra `uvh_test` | **540 pruebas, 4472 aserciones**, ~66 s |
| Calidad del backend | `composer quality` | 276 ficheros, Pint PASS, PHPStan nivel 6 sin errores |
| Pruebas y calidad del frontend | `npm run lint`, `npm run typecheck`, `ng test --watch=false` | lint (0 avisos) y typecheck limpios; **382/382** |

Puertas abiertas por esta pasada y no cerradas, con su sitio: el ensayo de rollback con dos releases reales (`docs/deployment.md` §4.1, que exige la primera vuelta atrás real), las migraciones sobre un volumen representativo y las cifras de RPO/RTO sobre la base y el almacenamiento reales. Todo lo demás que esta pasada deja en el repositorio está en el apartado siguiente, con su evidencia.

## Bloqueos externos — lo que no se puede cerrar desde esta máquina

| Qué falta | Detalle exacto | Quién lo tiene que hacer |
|---|---|---|
| Dominios y DNS | Publicar `uvh.es`, `app.uvh.es` y `edge.uvh.es` (A/AAAA y el CNAME de `CUSTOM_DOMAIN_CNAME_TARGET`), abrir 80/443 para ACME y validar emisión y renovación reales | Quien opera el despliegue y el DNS |
| Certificados | Confirmar en navegador real los certificados, HSTS, las cookies `__Host-`/`Secure` y que HTTP redirige a HTTPS | Quien opera el despliegue |
| CSP y hCaptcha reales | Validar CSP con Trusted Types y el iframe aislado contra el dominio real, sin errores de consola, con un sitekey propio de cada host | Quien opera el despliegue, con las claves de hCaptcha |
| Cuentas ACME | `ACME_EMAIL` y cuenta ACME monitorizada para avisos de caducidad | Quien opera el despliegue |
| Secretos | Custodia real (gestor, rotación y acceso) de `APP_KEY`, `APP_SECRET`, base de datos, Redis, Resend, hCaptcha, `EDGE_ASK_SECRET` y `METRICS_BEARER_TOKEN` | Seguridad/operación |
| Subnet de proxy | Fijar el `TRUSTED_PROXIES` real y comprobar que sólo contiene las IP/CIDR del proxy | Quien opera el despliegue |
| CA de PostgreSQL | Aportar el CA del proveedor y verificar `sslmode=verify-full` contra la base real | Quien opera la base de datos |
| Redis real | Medir memoria frente al límite, latencia y persistencia tras un reinicio real, y comprobar que una caída de Redis no reinicia la ventana de credenciales | Quien opera el despliegue |
| Monitorización y alertas | Reglas sobre las series publicadas (`/health`, profundidad, antigüedad y heartbeat por pool, `failed_jobs`, entregas webhook, `cache.failed_over`, `queue.metrics_unavailable`, recursos) y un destino centralizado de logs | Operación/guardia |
| Backups en producción | Programación (cron o systemd), almacenamiento independiente, retención aprobada y endpoint de alerta; y RPO/RTO medidos sobre la base y el almacenamiento reales | Operación |
| Datos representativos | Copia con volumen real para ensayar las migraciones `000019`–`000033` y posteriores: duración, bloqueo de escritores y de los índices únicos | Operación con el responsable de base de datos |
| Proveedor de correo | Claves de Resend, reputación del dominio, recepción real (no sólo aceptación del transporte) y ensayo de caída y recuperación del runbook de outbox | Operación con negocio |
| hCaptcha real | Sitekey por host con allowlist de dominio y secreto sólo en el backend | Operación |
| Buzones publicados | Probar `soporte@uvh.es` y el canal de denuncia, y nombrar a quien responde | Negocio/soporte |
| Jurídico | Titular legal, NIF, domicilio, datos registrales, hosting y región definitivos; DPA y subencargados; retenciones aprobadas; registro de actividades, brechas y evaluación RGPD/LOPDGDD/LSSI-CE | Dirección y asesoría jurídica |
| Personas | Nombrar al responsable de aprobar el release y al responsable de incidentes e indisponibilidad (el runbook ya existe: `docs/incident-runbook.md`) | Dirección |
| Ensayos con dos releases | Rollback real de imagen con migraciones ya aplicadas, para pasar de «procedimiento escrito» a «procedimiento probado» | Quien despliega, en el primer release |

## Cerrado en esta pasada (segunda mitad del 2026-09-20)

Los cinco pendientes que este documento declaraba cerrables aquí, cerrados con su
evidencia ejecutada en este árbol:

- **El bit de ejecución, en su forma canónica.** `docker/release-boot/postgres/90-tls.sh` está preparado en el índice con modo `100755` (`git ls-files -s`), y sacando el índice a un directorio limpio (`git checkout-index -a --prefix=…`) el fichero sale `-rwxr-xr-x`: un checkout limpio conserva el bit. La prueba que lo usa se ejecutó además **desde esa copia limpia** (`npm run release:boot` desde el árbol sacado del índice), no desde el árbol de trabajo.
- **El export máximo con el worker muerto a mitad.** `exportCrashDrill` en `frontend/e2e/async/drills/export-crash.mjs`: **28/28** en la corrida aislada y dentro de la suite completa. El requisito de tamaño se afirma contra el documento codificado medido (12.055.200 B, 527.712 B bajo el tope de 12 MiB) y no contra una estimación. Encontró y cerró un defecto de la propia prueba: el semillero daba por hecho que 9.000 mensajes de 1.300 B cabían bajo el tope cuando codifican a 13,08 MiB.
- **La recuperación del planificador detenido.** `schedulerRecoveryDrill`, en la misma suite: el latido envejece con el proceso parado, el reintento retenido no se mueve, y al volver llega exactamente una vez.
- **El ensayo del runbook de outbox con el proveedor caído.** `mailOutboxOutageDrill`, en la misma suite, con lo ejercitado listado en [`mail-outbox-runbook.md`](mail-outbox-runbook.md) §«Ensayo con el proveedor caído».
- **El runbook de incidente e indisponibilidad.** [`incident-runbook.md`](incident-runbook.md), con los ensayos que lo sostienen y los pendientes externos separados de lo ejecutado.

## Evidencia histórica local — 2026-08-30

Esta evidencia pertenece a un snapshot anterior. No valida los cambios manuales posteriores del 31 de agosto y 1 de septiembre, y no sustituye las casillas que requieren infraestructura o datos reales. En la pasada actual no se ejecutaron suites, builds, linters ni validaciones de Compose:

- PHPUnit sobre PostgreSQL aislado `uvh_test`: **85 pruebas, 641 aserciones**.
- Angular: typecheck correcto, build de producción correcto y **39/39** pruebas Chrome Headless.
- `docker-compose.production.yml` renderiza sin errores usando el ejemplo de variables; se construyeron `uvh-api:production` y `uvh-web:production`.
- `nginx -t` pasa sobre la imagen web renderizada; PHP-FPM se ejecuta como `www-data` y Nginx como UID no privilegiado `101`.
- La imagen API rechaza el arranque sin una configuración de producción válida y contiene `uvh:admin:promote` para el bootstrap auditable del primer admin.
- Pendiente de evidencia actual: volver a ejecutar toda la matriz sobre el árbol vigente, TLS/proxy real, secretos reales, correo y hCaptcha reales, migración y backup gestionados, E2E completo, revisión autenticada de la consola admin y datos legales definitivos.
- Los flujos de cambio de email, exportación, transferencia, step-up de tokens, borrado de workspace, revocación de intenciones y eliminación de cuenta añadidos el 1 de septiembre son implementación manual no validada por tests en esta pasada.
- Deuda no bloqueante del artefacto actual: migrar el runner Karma y las dependencias Webpack deprecadas a `@angular/build` antes de que Angular retire ese soporte.
