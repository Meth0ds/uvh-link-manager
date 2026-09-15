# UVH — Criterios de preparación para producción

Este documento es un gate de lanzamiento, no una declaración de que el entorno ya está listo. Cada requisito debe enlazar a evidencia fechada del entorno real. Una casilla sin evidencia se considera pendiente.

## Aplicación y release

- [ ] `npm ci`, `npm run typecheck`, `npm test -- --watch=false --browsers=ChromeHeadless` y `npm run build` terminan correctamente desde un checkout limpio.
- [ ] `composer install --no-dev`, PHPUnit completo y migraciones se ejecutan con las imágenes exactas del release.
- [ ] La imagen desplegada se identifica por digest o commit y existe un procedimiento probado de rollback compatible con las migraciones.
- [ ] `APP_ENV=production`, `APP_DEBUG=false` y el arranque pasa las invariantes de `ProductionSecurity`.
- [ ] La migración se ejecuta una sola vez antes de recrear `app`, todos los
  workers `queue-*` y `scheduler`.
- [ ] `php artisan uvh:release-check` pasa con la imagen y base del release.
  Probar que esquema pendiente/ausente impide arrancar PHP-FPM, queue y scheduler
  y hace fallar sus healthchecks; el job explícito `migrate` debe seguir disponible
  con una base vacía. Gate implementado en BAF-137 y ensayado en contenedor con
  `npm run release:boot` (imagen de producción, `APP_ENV=production`); sigue
  pendiente la evidencia sobre la base de datos y el entorno reales.

  Evidencia automatizada: `frontend/e2e/release-boot.mjs` arranca la imagen de
  producción con todas las invariantes satisfechas y comprueba que cada
  invariante rota detiene el contenedor con un mensaje diagnosticable, no con un
  error accidental. Su primer hallazgo fue que `BCRYPT_ROUNDS` procedente del
  entorno imposibilitaba el arranque en producción: `hashing.bcrypt.rounds`
  llegaba como cadena mientras el gate exige un entero, de modo que seguir
  `.env.production.example` impedía arrancar. Corregido con un cast explícito en
  `config/hashing.php`.
- [ ] Las migraciones `000019`–`000033` se prueban sobre copia representativa;
  se valida rollback y el bloqueo de los índices únicos de email/export/cuenta,
  además del índice de revocación de intenciones reclamadas.
  Incluir el índice de actividad por workspace de 000033: medir bloqueo de
  escritores, retención de atribución tras borrados y procedimiento de rollback.

## Red, TLS y secretos

- [ ] Certificados válidos y renovación automática para `uvh.es` y `app.uvh.es`; HTTP redirige a HTTPS.
- [ ] El backend y PostgreSQL no son accesibles directamente desde Internet.
- [ ] El proxy sobrescribe las cabeceras de forwarding y `TRUSTED_PROXIES` contiene sólo sus IP/CIDR verificadas.
- [ ] `APP_KEY`, `APP_SECRET`, credenciales de base de datos, Resend y hCaptcha proceden de un gestor de secretos, no del repositorio ni de la imagen.
- [ ] Cookies `__Host-`, `Secure`, host-only y HSTS se confirman en un navegador contra el dominio real.
- [ ] CSP, Trusted Types y el iframe aislado de hCaptcha se validan sin errores en la consola del navegador.

## Datos y continuidad

- [ ] Redis (caché, rate limits, locks y colas) está desplegado con
  autenticación, sin puerto publicado, con persistencia y con
  `maxmemory-policy noeviction`, y se alerta de `cache.failed_over` y de
  `queue.metrics_unavailable`.
  El modo de operación y su runbook están en `docs/redis-operations.md`. El
  arranque de producción rechaza un Redis sin contraseña, en loopback o con un
  limiter no compartido (`npm run release:boot`), y los ensayos en contenedor
  cubren el fallback del rate limiter, la pérdida del contenido del broker y las
  cadenas asíncronas sobre Redis. **Falta la evidencia sobre la instancia
  real**: memoria frente al límite, latencia observada y persistencia tras un
  reinicio real no se acreditan con un contenedor efímero.
- [ ] Los límites de credenciales cuentan en su propio store
  (`CACHE_LIMITER_SECURITY`), compartido y **no** dependiente de Redis, y se ha
  comprobado sobre el despliegue real que un Redis inalcanzable no reinicia la
  ventana de login ni bloquea el inicio de sesión. Sí se ha comprobado en
  contenedor (`SecurityLimiterStoreTest`); la prueba sobre la instancia real
  sigue pendiente.
- [ ] PostgreSQL usa `sslmode=verify-full` con una cadena de confianza válida.
- [ ] Existe backup automático cifrado, política de retención y alerta de fallo.
  El mecanismo está implementado y probado (`docker/backup/`, `docs/backup-and-restore.md`,
  `npm run e2e:backup`): cifrado AES-256-CBC con clave en volumen independiente,
  retención por número y hook de alerta que el drill verifica. Lo que falta es
  cablearlo al entorno real —programación (cron/systemd), almacenamiento
  independiente y endpoint de alerta—, no escribirlo.
- [ ] Se ha restaurado el último backup en un entorno aislado y se han registrado RPO/RTO reales.
  El drill destruye una base a propósito, restaura la copia en una instancia
  aislada y mide el RPO/RTO logrados. Las cifras son de un ensayo en contenedor;
  las de producción siguen pendientes y sólo valen medidas sobre la base y el
  almacenamiento reales.
- [ ] Se han probado migraciones con un volumen de datos representativo y se conoce su bloqueo/duración.
- [ ] Retenciones de sesiones, auditoría, analítica, entregas, exports,
  solicitudes de eliminación y denuncias están aprobadas y alineadas con la
  política de privacidad.

## Procesos y observabilidad

- [ ] Cada pool (`mail`, `webhooks`, `domains`, `exports`, `analytics`,
  `security` y `legacy`) y el scheduler están supervisados; detener uno genera una alerta
  diferenciada sin que el heartbeat genérico o el de otro pool la oculte.
- [ ] Cada timeout de job es menor que el timeout de su worker y éste es menor
  que el `retry_after` de la cola (`REDIS_QUEUE_RETRY_AFTER` con Redis,
  `DB_QUEUE_RETRY_AFTER` con la base); se demuestra que un export máximo de 12 MiB no se
  ejecuta dos veces ni queda huérfano al matar el proceso durante escritura,
  cifrado, publicación, descarga o acuse de recepción.
- [ ] Se alertan `/health`, latencia/errores HTTP, profundidad, antigüedad y
  heartbeat de cada cola, `failed_jobs`, entregas webhook fallidas y uso de
  recursos.
- [ ] Logs centralizados no contienen contraseñas, tokens, cookies, URLs sensibles ni cuerpos completos de webhooks.
- [ ] Está probado el procedimiento para reintentar trabajos, recuperar un scheduler detenido y rotar secretos.
- [ ] Ensayar [`mail-outbox-runbook.md`](mail-outbox-runbook.md): caída y recuperación
  de proveedor/worker/scheduler, reintento administrativo, compensación, purga,
  entrega HTML/texto y ausencia de contenido en logs. Validar recepción real por
  separado de la aceptación del transporte; no usar `log/array` como respaldo.
- [ ] Existen responsables y runbooks para abuso, incidente de cuenta, indisponibilidad y restauración.

## Flujos funcionales reales

- [ ] URL en hero → registro → email real → login → MFA → creación pre-rellenada, sin URL en query params.
- [ ] Login, recuperación, cambio de email de registro y reset funcionan con hCaptcha y proveedor de correo reales.
- [ ] Crear/editar/pausar/caducar/restaurar enlaces y resolverlos desde el dominio público funciona detrás del proxy real.
- [ ] Roles de workspace e IDOR se prueban con al menos dos workspaces y usuarios independientes.
- [ ] La transferencia de propiedad exige propietario, contraseña y MFA,
  conserva exactamente un rol `owner` y bloquea la eliminación de cuenta ante
  carreras con transferencia/eliminación de workspace.
- [ ] Emisión de token API y borrado de workspace exigen contraseña, MFA cuando
  está activo y, para borrar, coincidencia exacta del nombre; se prueban consumo
  concurrente de recovery code, sesión obsoleta y respuestas `409` de webhook.
- [ ] Dominio personalizado completa propiedad TXT, DNS de tráfico, emisión TLS,
  activación y resolución HTTPS; cada fase tiene evidencia independiente.
- [ ] Webhook firmado se entrega, falla, reintenta y deduplica contra un receptor controlado.
- [ ] La consola administrativa exige admin + MFA reciente, fuerza
  reautenticación al vencer `ADMIN_MFA_FRESH_MINUTES`, pagina datos, bloquea
  cuentas, modera denuncias y muestra señales operativas. Debe probarse la
  expiración real y el consumo único de recovery code.

## Dominios personalizados y DNS

El backlog técnico detallado está en [`todos.md`](todos.md). Ningún dominio se
considera listo por tener solamente el estado local `verified` o `active`.

- [ ] El edge Caddy incluido se despliega con almacenamiento persistente,
  puertos ACME accesibles, cuenta ACME monitorizada y versión identificada por
  digest; el endpoint On-Demand TLS `ask` sólo es accesible por la red privada.
- [ ] El panel publica el destino DNS real y UVH comprueba tanto propiedad como
  ruta antes de activar; el challenge TXT no comparte nombre con el CNAME.
- [ ] El certificado se emite antes de activar, se renueva automáticamente y
  existe un runbook para retirada urgente y limpieza de certificados cacheados.
- [ ] Un dominio desconocido, desactivado, transferido o con certificado no
  válido nunca resuelve enlaces de otro workspace ni la landing de UVH.
- [ ] Se han validado `NXDOMAIN`, `NODATA`, `SERVFAIL`, propagación parcial,
  múltiples/fragmentados TXT, CAA, bucles CNAME, apex, IDN y caducidad TLS.
- [ ] Hay revalidación periódica con gracia ante fallos transitorios y alerta
  ante pérdida persistente de propiedad/ruta.
- [ ] Se ha probado la transferencia y reutilización del mismo hostname entre
  dos workspaces sin replay del challenge ni CNAME/certificado colgante.
- [ ] Proxy y aplicación conservan SNI/`Host`, fuerzan HTTPS y registran sólo
  metadatos necesarios, sin tokens TXT ni URLs de destino en logs.

## Cuenta, privacidad y ejercicio de derechos

- [ ] Recuperación de contraseña validada con hCaptcha/correo reales, token
  caducado/consumido, concurrencia, revocación de sesiones y aviso posterior.
- [ ] Cambio de email verificado mediante estado pendiente, step-up MFA,
  notificación al buzón anterior y revocación coherente de credenciales.
- [ ] Cambio de contraseña, MFA, emisión de API tokens y operaciones destructivas
  exigen el nivel de reautenticación aprobado por el modelo de riesgo.
- [ ] Export de acceso/portabilidad asíncrono, cifrado, de un solo uso, limitado
  al sujeto y sin secretos ni datos indebidos de otros miembros.
- [ ] Eliminación de cuenta resuelve propiedad de workspaces, dominios/TLS,
  jobs, tokens, webhooks, backups, conservación legal y anonimización.
- [ ] Se fuerza el agotamiento de reintentos del email de cancelación y se
  comprueba que la compensación restaura automáticamente la cuenta antes del
  periodo de gracia; también se prueba cancelación concurrente con housekeeping.
- [ ] Existe un proceso probado para derechos RGPD (acceso, rectificación,
  supresión, oposición, limitación y portabilidad), identidad, plazo, prórroga y
  registro de respuesta.
- [ ] Registro de actividades, DPA/subencargados, transferencias, retenciones,
  brechas y evaluación jurídica RGPD/LOPDGDD/LSSI-CE están aprobados.

## UX, accesibilidad y legal

- [ ] Landing, acceso, panel completo y legales se revisan en móvil/escritorio, claro/oscuro y navegadores soportados.
- [ ] Recorrido por teclado, foco, contraste, lector de pantalla y `prefers-reduced-motion` están verificados manualmente.
- [ ] Estados de carga, vacío, permisos, sesión caducada, `409`, `422`, `429`, `5xx` y red caída tienen una salida recuperable.
- [ ] Términos, privacidad y canal de abuso incluyen titular legal, NIF, domicilio, datos registrales, hosting/región y proveedores definitivos.
- [ ] Se han probado los buzones publicados y existe un responsable de respuesta.

## Evidencia mínima del lanzamiento

Registrar para cada release: digest de imágenes, salida de tests, versión de migración, prueba de `/health`, captura de cabeceras/cookies, restauración de backup más reciente, E2E crítico, responsable que aprueba y hora de despliegue.

## Evidencia histórica local — 2026-08-30

Esta evidencia pertenece a un snapshot anterior. No valida los cambios
manuales posteriores del 31 de agosto y 1 de septiembre, y no sustituye las
casillas que requieren infraestructura o datos reales. En la pasada actual no
se ejecutaron suites, builds, linters ni validaciones de Compose:

- PHPUnit sobre PostgreSQL aislado `uvh_test`: **85 pruebas, 641 aserciones**.
- Angular: typecheck correcto, build de producción correcto y **39/39** pruebas
  Chrome Headless.
- `docker-compose.production.yml` renderiza sin errores usando el ejemplo de
  variables; se construyeron `uvh-api:production` y `uvh-web:production`.
- `nginx -t` pasa sobre la imagen web renderizada; PHP-FPM se ejecuta como
  `www-data` y Nginx como UID no privilegiado `101`.
- La imagen API rechaza el arranque sin una configuración de producción válida
  y contiene `uvh:admin:promote` para el bootstrap auditable del primer admin.
- Pendiente de evidencia actual: volver a ejecutar toda la matriz sobre el árbol
  vigente, TLS/proxy real, secretos reales, correo y hCaptcha reales, migración
  y backup gestionados, E2E completo, revisión autenticada de la consola admin
  y datos legales definitivos.
- Los flujos de cambio de email, exportación, transferencia, step-up de tokens,
  borrado de workspace, revocación de intenciones y eliminación de cuenta
  añadidos el 1 de septiembre son implementación manual no validada por tests
  en esta pasada.
- Deuda no bloqueante del artefacto actual: migrar el runner Karma y las
  dependencias Webpack deprecadas a `@angular/build` antes de que Angular retire
  ese soporte.
