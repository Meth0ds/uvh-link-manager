# Auditoría manual del backend Laravel

Estado: auditoría manual reabierta y en curso. Este documento conserva los hallazgos confirmados y las remediaciones aplicadas, pero no declara el backend listo para producción. La ampliación del 1 de septiembre revisa autenticación, MFA, correo, eventos, dominios, edge y configuración de despliegue. No se utilizó Codex Security ni se realizaron pruebas contra destinos externos controlados por terceros.

## Estado de remediación

| Estado | Hallazgos | Implementación y verificación |
|---|---|---|
| Resuelto | BAF-001 a BAF-005 | Revocación de tokens al retirar acceso, invalidación de resets, imagen PHP con curl, escritura de analítica atómica y reintentos persistidos de webhooks. |
| Resuelto | BAF-006 | Máximo de 20 webhooks y 1.000 entregas activas por workspace, admisión atómica bajo lock, throttles para creación/prueba/reenvío y respuesta HTTP descartada en streaming. |
| Aplicado; requiere despliegue | BAF-007, BAF-027 | El arranque de producción exige `TRUSTED_PROXIES`, TLS, HSTS, cookies seguras y hosts separados. Falta configurar las IP/rangos reales y el saneamiento de cabeceras en el proxy de producción. |
| Resuelto | BAF-008 a BAF-025 | Se bloquea borrar dominios con enlaces, se permiten reinvitaciones y alias tras borrado, se corrigen estados, cuotas, roles, entregas paralelas, ownership de webhooks, cookies de desbloqueo y revocación de sesiones. |
| Resuelto | BAF-026 | El correo transaccional se entrega desde trabajos con cinco intentos y backoff. El sobre de cola se cifra at-rest para que enlaces bearer no aparezcan en `jobs`; el agotamiento se audita sin PII ni tokens. |
| Resuelto | BAF-028 a BAF-036 | Cuotas y límites DNS, conflictos únicos convertidos en errores de negocio, CAPTCHA de un solo uso, límites de cabeceras, bloqueo optimista de enlaces mediante `version`, y hash HMAC de visitantes. |
| Resuelto | BAF-037 | El worker mantiene un lock de configuración durante la conexión; actualizar, eliminar, expulsar al creador o borrar el workspace toma el mismo lock y sólo confirma tras terminar una entrega en curso. Las pendientes se invalidan por versión. El protocolo conserva la semántica normal de entrega al menos una vez mediante `event_id`. |
| Aplicado; BAF-041 parcialmente mitigado | BAF-038 a BAF-043 | Versionado de sesión/desafío, throttles por propósito, cotas de denuncias/tokens y redacción de correo. Invitaciones: presupuesto estable y cota activa tras BAF-134/135; faltan límites complementarios. |
| Sustituido | BAF-044 | El mecanismo propio dejó de ser la barrera de acceso: registro, login, recuperación, reenvío y corrección de registro usan hCaptcha oficial verificado servidor a servidor, con timeout y fallo cerrado. |
| Resuelto | BAF-045 a BAF-053 | Límite bcrypt de 72 bytes, presupuestos de autenticación aislados, unlock independiente de denuncias, validación booleana, estados de invitación, manejo de secretos, truncado de User-Agent, analítica por workspace y bloqueo de resets de cuentas deshabilitadas. |
| Resuelto | BAF-054 | Límite atómico de 20 intenciones por IP y 100.000 globales durante el TTL. Ambas cotas comparten un lock de orden fijo y se reducen al completar/descartar una intención. |
| Resuelto | BAF-055 a BAF-058 | MFA pendiente con caducidad y cancelación, recuperación de secreto ilegible para sesión MFA verificada, códigos normalizados y desafío MFA ligado a `security_version`. |
| Aplicado; validación pendiente | BAF-059 a BAF-067 | Caddy On-Demand TLS con `ask`, CNAME/TXT separados, estados DNS/TLS, provisioning previo a `active`, revalidación periódica, generación/locks y UI por rol. Falta E2E con DNS/ACME reales. |
| Resuelto manualmente | BAF-068 a BAF-077 | Rate limits por bearer/cuenta, rollback de invitaciones, panel de denuncias admin, MFA/recovery, logout, cola de correo, bloqueo de webhooks, redacción de errores externos y fail-fast de producción. |
| Abierto o mitigado | BAF-080 a BAF-083 | Estado final general de correo, crecimiento histórico, supply chain y evidencia externa de producción. |
| Resuelto manualmente; sin pruebas actuales | BAF-084 a BAF-103 | Step-up de contraseña, cambio de email verificado, export cifrado, eliminación con gracia, compensación y outbox de correo, bearers fuera de query, revocación de intenciones, atomicidad webhook, link scanners, frescura MFA, purgas y cierre de emergencia. |
| Remediado estáticamente; validación pendiente | BAF-115 a BAF-121 | Atomicidad entre bearers y correo, señales operativas de colas/incidentes, fixtures alineados, minimización de entregas y rotación documentada de `APP_SECRET`. |
| Remediado estáticamente; pruebas no ejecutadas | BAF-122 y BAF-123 | Validación de transportes efectivos de correo, eliminación del respaldo `log`, aceptación explícita y conservación de HTML/texto. |
| Remediado estáticamente; pruebas no ejecutadas | BAF-124 y BAF-125 | Contraseña/reset/recuperación y aviso de incidente en un único commit; conservación del bearer recién admitido durante la limpieza. |
| Remediado estáticamente; pruebas no ejecutadas | BAF-126 | Avisos obligatorios de MFA y de ambos buzones en cambio de email confirmados junto a su operación. |
| Aplicado estáticamente; pruebas no ejecutadas | BAF-127 a BAF-129 | Avisos de tokens/workspace atómicos, recovery code conservado ante webhook ocupado y savepoint de aviso en cancelación protectora. |
| Aplicado estáticamente; pruebas no ejecutadas | BAF-130 | La transferencia respeta la cuota de workspaces del receptor bajo su lock, antes de consumir MFA. |
| Aplicado estáticamente; pruebas no ejecutadas | BAF-131 | Cierre del caso pendiente de BAF-009: reinvitación vencida, caducidad efectiva en panel y reenvío de expiradas con rollback. |
| Aplicado estáticamente; pruebas no ejecutadas | BAF-132 y BAF-133 | Revocación persistente de invitaciones de admin al transferir y de las emitidas al programar eliminación; no reviven al recuperar autoridad/cuenta. |
| Aplicado estáticamente; pruebas no ejecutadas | BAF-134 y BAF-135 | Presupuesto de invitaciones por cuenta/workspace canónico y cota de 100 pendientes activas en admisión/renovación. |
| Código y migración preparados; sin ejecutar | BAF-136 | Reserva SQL de correo por cuenta/workspace/destinatario/IP/global y cooldown; rollback, keyring, métricas y limpieza. |
| Aplicado estáticamente; sin ejecutar | BAF-137 | Gate de esquema/configuración en arranque estándar y healthchecks de contenedor, sin ejecutar migraciones. |
| Aplicado estáticamente; sin ejecutar | BAF-138 | Cliente conserva Retry-After y Equipo muestra espera manual por destinatario sin bloquear cancelación. |
| Corregido y validado aisladamente | BAF-139 a BAF-142 | El panel propaga paradas fallidas; las intenciones distinguen borrado autoritativo de limpieza acotada; la publicación webhook usa un lease recuperable. |
| Corregido y validado en frontend | BAF-143 a BAF-180 | Aislamiento por workspace/destrucción, limpieza de secretos, sondeos acotados, Storage estricto, QR/descargas robustos y contexto de workspace validado. |

### Cambios de compatibilidad del frontend

- El diálogo de enlaces consume y envía el nuevo entero `version`; un guardado obsoleto recibe `409` sin pisar el cambio más reciente.
- Los formularios de contraseña reflejan el límite de 72 caracteres de bcrypt, incluidos login, ajustes, MFA, reset y contraseña de enlace.
- El panel de MFA distingue configuración pendiente de factor activo, permite cancelarla sin desactivar MFA y muestra sesiones verificadas con MFA.
- Webhooks muestra el estado `processing`, impide probar uno pausado, limita los campos a las reglas de API e informa de límites de secreto. Las confirmaciones de borrado, expulsión y eliminación de workspace explican el `409` recuperable cuando hay una entrega activa.

### Validación histórica ejecutada

Los resultados siguientes pertenecen a un snapshot anterior. No se repitieron
después de los cambios manuales del 31 de agosto y 1 de septiembre, por petición
expresa; por tanto no acreditan el árbol actual.

- `npm run typecheck` y `npm run build` en `frontend`: correctos.
- `npm test -- --watch=false --browsers=ChromeHeadless`: **15 pruebas, OK**, incluido el flujo de registro y la prueba de trabajo.
- Migración limpia de PostgreSQL de pruebas: 15 migraciones aplicadas, incluidas `000008` a `000013`.
- PHPUnit Feature en el contenedor PHP aislado: **21 pruebas, 464 aserciones, OK**. Incluye regresión de edición obsoleta, rotación de contraseña/sesiones, proof-of-work, intenciones, SSRF, contratos de esquema y exclusión entre entregas de webhook, reconfiguración y expulsión de miembros.

## Hallazgos confirmados

### BAF-001 — Un API token mantiene acceso después de retirar al miembro

- Severidad: alta
- Evidencia: `app/Http/Middleware/RequireApiToken.php:33` sólo exige que el creador del token no esté eliminado. `app/Http/Controllers/WorkspaceController.php:153` y `:178` eliminan membresías sin revocar los tokens creados por esa persona.
- Impacto: un antiguo editor puede seguir llamando a `GET /api/v1/analytics/public/overview` con un token `analytics:read` del workspace.
- Corrección propuesta: comprobar membresía activa al autenticar tokens y revocar todos los tokens del creador para ese workspace al expulsar o abandonar; cubrir expulsión, salida y cambio futuro de rol en pruebas.

### BAF-002 — Tokens de recuperación antiguos sobreviven a un reset o cambio de contraseña

- Severidad: alta
- Evidencia: `app/Http/Controllers/AuthController.php:386` crea un token por petición. `:412` a `:422` sólo consume el token presentado y `:471` cambia la contraseña sin invalidar tokens `reset` existentes.
- Impacto: quien retenga otro enlace de reset válido puede cambiar de nuevo la contraseña durante su TTL.
- Corrección propuesta: invalidar todos los tokens `reset` del usuario en la misma transacción al consumir uno, al cambiar contraseña y al bloquear una cuenta.

### BAF-003 — La imagen Docker no instala la extensión PHP curl requerida por webhooks

- Severidad: alta de disponibilidad
- Evidencia: `docker/php/Dockerfile:12` instala extensiones sin `curl`; `app/Support/Ssrf.php:158` invoca `curl_init()`.
- Impacto: en la imagen Docker documentada las entregas de webhook fallan antes de enviar ninguna petición.
- Corrección propuesta: instalar y habilitar `ext-curl` en la imagen, y añadir una prueba de arranque que compruebe `extension_loaded('curl')` junto con una entrega contra un servidor local controlado.

### BAF-004 — Carrera de rollups puede convertir un redirect válido en 500

- Severidad: alta de disponibilidad e integridad de métricas
- Evidencia: `app/Support/AnalyticsService.php:34` consulta el rollup y en `:37` lo crea sin transacción/UPSERT; `database/migrations/2026_08_18_000004_create_analytics_tables.php:24` impone unicidad por enlace y día. `RedirectController` registra analítica de forma síncrona antes de responder al usuario.
- Impacto: dos primeros clics concurrentes de un enlace/día pueden provocar una violación única y un `500`; actualizaciones concurrentes posteriores también pierden incrementos.
- Corrección propuesta: UPSERT atómico con incrementos en SQL, o persistencia asíncrona que no pueda abortar el redirect; pruebas paralelas del primer clic y de incrementos concurrentes.

### BAF-005 — Los reintentos de webhook nunca alcanzan el límite de fallo

- Severidad: media
- Evidencia: `app/Jobs/WebhookDeliveryJob.php:26` siempre llama a `WebhookService::attempt($id, 0)`. `app/Support/WebhookService.php:99` incrementa desde ese argumento y el scheduler reencola los pendientes en `app/Console/Commands/UvhHousekeeping.php:33`.
- Impacto: una entrega fallida queda pendiente y se reintenta indefinidamente; nunca llega al estado `failed` ni entra en la purga de fallidas.
- Corrección propuesta: usar el contador persistido, reservar la entrega con estado `processing` y programar el siguiente job con delay; probar el sexto fallo y la transición a `failed`.

### BAF-006 — Webhooks sin cuota, rate limit ni límite de cuerpo de respuesta

- Severidad: media de disponibilidad
- Evidencia: `WebhookController::store`, `::test` y `::resend` no tienen limitador por ruta ni cuota. `WebhookService::dispatch` crea una entrega para cada webhook activo. `Ssrf::safeFetch` usa `CURLOPT_RETURNTRANSFER` en `app/Support/Ssrf.php:163` sin límite de tamaño.
- Impacto: un editor puede crear muchos hooks y amplificar cada evento a muchos jobs; un endpoint controlado puede devolver cuerpos grandes y aumentar el consumo de memoria del worker.
- Corrección propuesta: máximo de hooks y entregas por workspace, throttles de creación/test/reenvío, límite de respuesta y métricas/alertas de cola.

### BAF-007 — El proxy inverso no está configurado como proxy confiable

- Severidad: media, condicionada a despliegue detrás de proxy
- Evidencia: `bootstrap/app.php` no llama a `trustProxies`, mientras `app/Providers/AppServiceProvider.php:19` usa `Request::ip()` en los limitadores. El despliegue documentado presupone TLS terminado por proxy. Además, si se activa `TRUST_COUNTRY_HEADER`, `RedirectController::countryFromHeaders` acepta la cabecera configurada sin verificar que haya sido saneada por ese proxy (`app/Http/Controllers/RedirectController.php:157-167`).
- Impacto: todos los clientes pueden compartir IP, CAPTCHA, auditoría y límites del proxy; un actor puede agotar los límites para terceros. HSTS basado en `isSecure()` también puede quedar inactivo. Si la API queda accesible fuera del proxy o éste reenvía la cabecera de país sin reemplazarla, el cliente puede falsear analítica y seleccionar reglas de redirección por país.
- Corrección propuesta: declarar explícitamente sólo las IP/rangos del proxy de producción, bloquear acceso directo al backend y configurar el proxy para eliminar/reinyectar la cabecera de país; añadir pruebas de cabeceras `X-Forwarded-*` y país no confiable.

### BAF-008 — Eliminar un dominio personalizado reasigna enlaces al host público

- Severidad: media
- Evidencia: `DomainController::destroy` borra el dominio en `app/Http/Controllers/DomainController.php:99`; la FK `links.domain_id` usa `nullOnDelete()` en `database/migrations/2026_08_18_000003_create_links_tables.php:16`.
- Impacto: los enlaces que estaban en el dominio eliminado pasan a resolverse en el dominio público de UVH; si existe una colisión con un alias público, la eliminación falla por unicidad.
- Corrección propuesta: exigir reasignación explícita, bloquear/archivar enlaces antes de borrar o impedir el borrado mientras existan enlaces activos.

### BAF-009 — Invitaciones canceladas, rechazadas o caducadas no se pueden recrear

- Severidad: media
- Revisión del 5 de septiembre: el cierre anterior era incompleto para filas
  `pending` vencidas; el ajuste residual y su validación pendiente están en BAF-131.
- Evidencia: `WorkspaceController::invite` bloquea cualquier invitación `pending` en `app/Http/Controllers/WorkspaceController.php:241-244` sin comprobar `expires_at`. La aceptación sí trata una pendiente vencida como inválida (`:273-275`), pero no cambia su estado. Para las canceladas o rechazadas, `invite` intenta insertar una nueva en `:247-255`. En todos los casos, el índice `invitations_workspace_email_unique` de `database/migrations/2026_08_18_000007_add_postgres_indexes.php:12` prohíbe una segunda fila para ese workspace/email.
- Impacto: una invitación vencida bloquea el flujo normal de reinvitación con un falso `409` de “pendiente” (aunque un administrador que localice la fila puede usar `resend` para renovarla); una cancelada o rechazada deriva en una excepción de base de datos no convertida a respuesta de negocio. En estos dos últimos casos el destinatario no puede volver a ser invitado mediante la API normal.
- Corrección propuesta: reutilizar/rotar la invitación existente o hacer único sólo el estado pendiente; capturar conflictos como `409`.

### BAF-010 — Alias de enlaces borrados lógicamente no se pueden reutilizar

- Severidad: media
- Evidencia: `LinkService::aliasExists` filtra `deleted_at` en `app/Support/LinkService.php:330`, pero los índices únicos de `database/migrations/2026_08_18_000007_add_postgres_indexes.php:14-15` no lo hacen.
- Impacto: la aplicación informa que el alias está disponible y la inserción acaba en un `500` por conflicto único.
- Corrección propuesta: índices únicos parciales `WHERE deleted_at IS NULL`, migración de datos compatible y manejo explícito de conflictos.

### BAF-011 — Totales de analítica inconsistentes y visitantes sobrecontados

- Severidad: media de integridad
- Evidencia: `AnalyticsService.php:41` y `:52` incrementan visitantes por cada clic con hash, no por visitante distinto. `AnalyticsController.php:95-107` suma rollups por día completo, mientras `:109-122` filtra la serie por instante.
- Impacto: visitantes, totales y top links pueden diferir de la serie y sobrecontar rangos parciales.
- Corrección propuesta: calcular visitantes distintos con una estructura apropiada o desde eventos, y usar eventos/rollups fraccionables coherentes con el rango solicitado.

### BAF-012 — Quitar una programación puede dejar un enlace inaccesible para siempre

- Severidad: media de flujo
- Evidencia: `LinkService::update` preserva siempre el estado en `app/Support/LinkService.php:209` mientras actualiza `scheduled_at` en `:222`. El scheduler sólo activa enlaces con estado `scheduled` y fecha no nula (`UvhHousekeeping.php:22-25`).
- Impacto: al borrar la fecha de un enlace aún programado, sigue en `scheduled` y ningún proceso lo vuelve a activar.
- Corrección propuesta: recalcular el estado al editar fechas y probar programar, retirar programación, reprogramar y restaurar.

### BAF-013 — Códigos de recuperación erróneos permiten bloquear el MFA de otra cuenta

- Severidad: media de disponibilidad
- Evidencia: `AuthController::mfaRecovery` llama a `mfaRecordFailure($user->id)` tras un código inválido. `mfaVerify` consulta el mismo contador mediante `mfaTooManyAttempts($user->id)`. Ambos usan la misma clave `uvh:mfa:attempts:{userId}`.
- Impacto: un atacante que conozca el email de una cuenta con MFA puede enviar diez códigos de recuperación erróneos y bloquear la verificación TOTP legítima durante 15 minutos.
- Corrección propuesta: separar los presupuestos de intentos de TOTP y recuperación; aplicar un límite adicional por email/IP para recuperación y no bloquear la autenticación MFA normal por fallos públicos de recovery.

### BAF-014 — Aceptar una invitación puede vencer una cancelación concurrente

- Severidad: baja de integridad de autorización
- Evidencia: `WorkspaceController::acceptInvitation` comprueba `status = pending` antes de abrir la transacción y luego actualiza la invitación sin `lockForUpdate` ni condición de estado.
- Impacto: una aceptación que ya pasó la comprobación puede sobrescribir una cancelación administrativa concurrente y crear la membresía.
- Corrección propuesta: leer y consumir la invitación dentro de una transacción bloqueada o actualizarla condicionalmente por `id`, `status = pending` y `expires_at`.

### BAF-015 — Los estados de dominio permiten resolver antes de activar y carreras reactivan dominios deshabilitados

- Severidad: baja de flujo
- Evidencia: `RedirectService::resolveDomainId` acepta estados `verified` y `active` (`app/Support/RedirectService.php:21-31`). Además, `verify` escribe `verifying` y, después de una consulta DNS, `verified` sin lock ni condición de estado (`app/Http/Controllers/DomainController.php:59-70`); `revalidate` hace lo mismo en `:115-130`, y `activate` valida un estado leído antes de actualizarlo en `:133-147`. Una desactivación concurrente puede ser sobrescrita por cualquiera de esos finales tardíos.
- Impacto: la operación explícita de activación no gobierna realmente el routing y una revalidación o verificación en vuelo puede volver a exponer un dominio que otro administrador deshabilitó. También una activación que ya pasó la comprobación puede imponerse sobre una desactivación o invalidación concurrente.
- Corrección propuesta: permitir redirects sólo con estado `active`; modelar transiciones en una transacción/actualización condicional con versión y preservar `disabled` hasta una activación explícita. Ejecutar DNS fuera del lock, pero validar versión/estado al aplicar el resultado.

### BAF-016 — Un administrador puede promover miembros a administrador sin ser propietario

- Severidad: alta
- Evidencia: `WorkspaceController::changeRole` permite el rol destino `admin` en `app/Http/Controllers/WorkspaceController.php:129-147`. Para un actor que no es propietario, la condición de bloqueo sólo verifica que el rol solicitado sea `owner` o que el **rol actual** de la víctima sea `admin` (`:143`); no bloquea `role = admin` para una víctima editor o viewer.
- Impacto: cualquier administrador de workspace puede convertir a un editor o viewer en administrador, eludiendo la separación de facultades que el propio controlador y los flujos de invitación reservan al propietario. El nuevo administrador puede gestionar miembros, invitaciones y ajustes del workspace.
- Corrección propuesta: para un actor que no sea propietario, rechazar también el rol destino `admin` (y añadir pruebas de matriz actor/rol actual/rol destino).

### BAF-017 — Una misma entrega de webhook puede enviarse varias veces en paralelo

- Severidad: media de integridad y fiabilidad
- Evidencia: `WebhookService::attempt` lee una entrega `pending` en `app/Support/WebhookService.php:67-70`, la envía en `:81-86` y sólo después la marca `success` en `:88-90`, sin reserva ni transición atómica a `processing`. `WebhookService::resend` vuelve a dejar cualquier entrega en `pending` y encola otro job (`:55-63`); el scheduler también reencola pendientes en `UvhHousekeeping.php:33-42`.
- Impacto: dos reenvíos, o un reenvío y el scheduler, pueden observar simultáneamente `pending` y ejecutar el mismo webhook. Aunque se publica `event_id`, el receptor no tiene garantía de que UVH entregue una sola vez, por lo que operaciones no idempotentes externas se duplican.
- Corrección propuesta: reclamar la fila con `UPDATE ... WHERE status = 'pending'` hacia un estado `processing` antes de llamar a la red; conservar el contador persistido y hacer que el reenvío cree una entrega nueva o sólo reprograme una que no esté en proceso.

### BAF-018 — Un webhook creado por un miembro expulsado sigue filtrando eventos al endpoint de ese exmiembro

- Severidad: media de confidencialidad
- Evidencia: un editor puede crear un webhook en `app/Http/Controllers/WebhookController.php:24-63`, pero la tabla `webhooks` sólo guarda `workspace_id`, URL, secreto, eventos y estado (`database/migrations/2026_08_18_000005_create_integrations_tables.php:25-33`); no existe `created_by`. Al expulsar o abandonar un miembro, `WorkspaceController.php:153-190` sólo borra la membresía. `WebhookService::dispatch` continúa enviando a todos los hooks activos del workspace (`app/Support/WebhookService.php:22-52`).
- Impacto: una URL controlada por un antiguo editor continúa recibiendo metadatos de enlaces y dominios del workspace después de que pierda acceso, sin trazabilidad para identificar ni revocar automáticamente el hook que creó.
- Corrección propuesta: registrar propietario/creador de cada webhook y desactivar o exigir revisión de sus hooks al retirar su acceso; presentar esta asociación en la UI y auditar el cambio de estado.

### BAF-019 — Cambiar la contraseña de un enlace no revoca los desbloqueos anteriores

- Severidad: media de control de acceso
- Evidencia: tras comprobar una contraseña, `RedirectController::unlock` firma un cookie válido diez minutos que sólo contiene `alias`, `host` e `id` del enlace (`app/Http/Controllers/RedirectController.php:127-141`). `RedirectService::resolve` acepta ese cookie comprobando sólo esos tres valores (`app/Support/RedirectService.php:86-102`). Al actualizar la contraseña, `LinkController.php:217-221` y `LinkService.php:219` sustituyen el hash sin cambiar ningún nonce o versión de desbloqueo.
- Impacto: quien conocía la contraseña anterior conserva acceso al enlace protegido hasta que venza su cookie, incluso si el propietario la cambia para retirar acceso. Además, la comprobación del cookie ocurre antes de bloquear y recargar el enlace en la transacción (`RedirectService.php:86-102` frente a `:124-152`), por lo que una petición concurrente puede atravesar una contraseña recién activada una vez.
- Corrección propuesta: guardar una versión/nonce de desbloqueo por enlace e incluirla en el token firmado; rotarla siempre que se establezca, cambie o elimine la contraseña, y volver a verificar la puerta de contraseña sobre la fila bloqueada antes de emitir el redirect.

### BAF-020 — El límite de 20 workspaces se puede superar con peticiones concurrentes

- Severidad: media de disponibilidad y coste
- Evidencia: `WorkspaceController::store` cuenta workspaces en `app/Http/Controllers/WorkspaceController.php:47` y crea el nuevo dentro de una transacción distinta en `:52-62`, sin bloqueo del usuario ni restricción de base de datos. La ruta `POST /api/v1/workspaces` no tiene throttle en `routes/api.php:71-85`.
- Impacto: varias solicitudes simultáneas que observan 19 (o menos) workspaces pasan todas la comprobación y pueden crear muchos más de 20, cada uno con cuota de 1.000 enlaces. Una cuenta verificada puede ampliar consumo de filas, dominios, webhooks y cola más allá del límite del producto.
- Corrección propuesta: serializar por usuario con `lockForUpdate` sobre la fila de usuario o un lock/advisory lock, añadir throttle/cuota explícita y probar un lote concurrente en el umbral.

### BAF-021 — Restaurar enlaces permite sobrepasar la cuota del workspace

- Severidad: media de disponibilidad y coste
- Evidencia: `LinkService::create` protege el conteo de enlaces activos con el lock de cuota en `app/Support/LinkService.php:145-154`, pero `LinkController::restore` repone un enlace borrado sin consultar cuota (`app/Http/Controllers/LinkController.php:297-312`).
- Impacto: se pueden borrar varios enlaces, crear otros hasta el límite y restaurar los borrados; la restauración incrementa el número de enlaces activos por encima de `links_limit`. Repetir el ciclo permite crecer por encima de la cuota contratada.
- Corrección propuesta: aplicar la misma comprobación y lock de cuota a la restauración, devolviendo `429` si el enlace no cabe; añadir pruebas de restauración cuando la cuota ya está llena.

### BAF-022 — Restaurar un enlace programado deja su estado de ciclo de vida incoherente

- Severidad: baja de integridad de flujo
- Evidencia: `LinkController::restore` decide sólo entre `expired` y `active` (`app/Http/Controllers/LinkController.php:307-308`) e ignora un `scheduled_at` futuro. El redirect considera activo ese estado salvo por una fecha futura, pero el estado visible y la operación de activación quedan incoherentes.
- Impacto: un enlace borrado temporalmente con programación futura se restaura como activo en vez de regresar a `scheduled`; aunque `RedirectService` todavía bloquea por la fecha futura, la UI y el scheduler dejan de reflejar el ciclo de vida real y el comportamiento diverge de los enlaces nunca borrados.
- Corrección propuesta: reutilizar `deriveState` o una transición centralizada al restaurar, cubriendo fechas futuras, pasadas y sin fecha.

### BAF-023 — Dos editores que crean la misma etiqueta nueva pueden provocar un 500

- Severidad: baja de disponibilidad e integridad
- Evidencia: `LinkService::applyTags` busca una etiqueta y después la crea si no existe (`app/Support/LinkService.php:344-358`) sin bloqueo ni `upsert`. PostgreSQL exige unicidad por workspace/nombre en `database/migrations/2026_08_18_000007_add_postgres_indexes.php:16`.
- Impacto: dos creaciones o actualizaciones concurrentes con la misma etiqueta inexistente pueden intentar insertarla a la vez; una falla por índice único y revierte la operación de enlace con una excepción no convertida a error de negocio.
- Corrección propuesta: usar `insert ... on conflict ... returning`/`firstOrCreate` con tratamiento de conflicto, o capturar el error único y volver a leer la etiqueta dentro de la transacción.

### BAF-024 — Dos cambios concurrentes pueden dejar la plataforma sin administrador activo

- Severidad: media de disponibilidad administrativa
- Evidencia: `AdminController::updateUser` comprueba el número de administradores activos en `app/Http/Controllers/AdminController.php:53-58`, pero no lo hace dentro de transacción ni bloquea filas. Después actualiza el flag de forma independiente en `:60-62`.
- Impacto: con exactamente dos administradores, dos despromociones o bloqueos concurrentes pueden observar ambos que quedan dos, aprobarse y dejar `is_admin = false` o `deleted_at` en los dos. La UI administrativa queda sin cuenta capaz de recuperar la gestión.
- Corrección propuesta: serializar cambios de administrador en una transacción con locks y volver a contar justo antes de escribir; impedir que el actor se deje sin una ruta de recuperación y añadir una prueba concurrente.

### BAF-025 — Activar MFA habilita el área administrativa para sesiones antiguas sin MFA

- Severidad: alta
- Evidencia: `AuthController::mfaEnable` sólo actualiza `mfa_enabled`, secreto y recovery codes (`app/Http/Controllers/AuthController.php:562-566`) y no revoca ni marca las sesiones existentes. `RequireMfa` autoriza administración comprobando únicamente el flag actual del usuario (`app/Http/Middleware/RequireMfa.php:14-19`); la sesión no contiene evidencia ni fecha de MFA (`app/Support/SessionManager.php:17-30`). Todas las rutas administrativas dependen de ese middleware (`routes/api.php:117-127`).
- Impacto: tras activar MFA en una sesión, cualquier otra sesión activa emitida antes de MFA —por ejemplo una sesión olvidada en otro dispositivo o robada previamente— obtiene acceso administrativo si la cuenta tiene `is_admin`, sin presentar TOTP ni recovery code.
- Corrección propuesta: persistir `mfa_authenticated_at` o un nivel de autenticación por sesión y exigirlo con caducidad en `uvh.mfa`; al habilitar MFA revocar todas las sesiones previas salvo la que acaba de completar la verificación, o requerir una nueva autenticación MFA para administración.

### BAF-026 — Fallos de correo se ocultan y dejan flujos de cuenta en éxito falso

- Severidad: media de disponibilidad, condicionada a fallo del proveedor de correo
- Evidencia: `UvhMail::send` captura cualquier excepción de `Mail::html`, la registra y no la propaga (`app/Support/UvhMail.php:27-31`). Registro, reset, verificación e invitaciones continúan devolviendo respuestas de éxito después de llamar a ese método (`AuthController.php:87-99`, `:364-395`; `WorkspaceController.php:247-262` y `:344-350`).
- Impacto: un timeout o error de Resend/SMTP crea tokens, usuarios o invitaciones, pero el cliente recibe éxito sin recibir un email utilizable. No existe una cola, outbox ni reintento de la notificación; el usuario queda bloqueado para verificar, resetear o aceptar hasta que descubra y repita manualmente el flujo.
- Corrección propuesta: encolar correo con reintentos y observabilidad, persistir un outbox tras la transacción y exponer un estado recuperable. Si se mantiene el envío síncrono, distinguir explícitamente el error de entrega del éxito de la operación.

### BAF-027 — Las invariantes de seguridad de producción no se validan al arrancar

- Severidad: media, condicionada a error de despliegue
- Evidencia: la comprobación de `APP_SECRET` sólo está en `UvhCrypto::secret` (`app/Support/UvhCrypto.php:13-37`), invocada bajo demanda por cifrado, hash IP, MFA o webhooks; `bootstrap/app.php` no valida configuración al boot. Los valores críticos se consumen sin salvaguarda adicional: `SessionManager` aplica literalmente `COOKIE_DOMAIN` y `COOKIE_SECURE` (`app/Support/SessionManager.php:93-101`) y los enlaces bearer de verificación/reset/invitación se construyen a partir de `APP_URL` sin exigir HTTPS ni que coincida con `APP_HOST` (`AuthController.php:626-629`, `WorkspaceController.php:387-390`). Sin embargo, README y despliegue declaran obligatorios secreto, cookie host-only y hosts seguros (`README.md:8`, `:88-90`, `docs/deployment.md:76`).
- Impacto: un despliegue sin `APP_SECRET` puede arrancar y responder health, pero fallar con `500` al primer login, CAPTCHA, MFA o webhook. Otros errores comunes no fallan cerrados: `COOKIE_DOMAIN=.uvh.es` rompe el aislamiento de sesión entre landing y panel, `COOKIE_SECURE=false` permite cookies no seguras y un `APP_URL` HTTP o de host equivocado envía por email tokens bearer a un enlace inseguro o ajeno. El error aparece bajo tráfico y contradice el contrato operativo documentado.
- Corrección propuesta: validar en boot/deploy healthcheck secret, `APP_URL=https://APP_HOST`, `COOKIE_SECURE=true`, `COOKIE_DOMAIN` vacío y hosts distintos/permitidos cuando `APP_ENV=production`; detener el proceso antes de entrar en servicio y añadir pruebas de cada configuración incompleta o insegura.

### BAF-028 — Dominios y verificaciones DNS no tienen cuota ni rate limit

- Severidad: media de disponibilidad
- Evidencia: las rutas de crear, verificar y revalidar dominio sólo requieren rol editor, sin `throttle` en `routes/api.php:87-96`. `DomainController::store` no aplica máximo por workspace (`app/Http/Controllers/DomainController.php:22-46`) y `verify`/`revalidate` ejecutan `dns_get_record` síncrono en cada llamada (`:49-77`, `:115-130`, `:152-167`).
- Impacto: un editor puede crear un número no acotado de dominios y provocar consultas DNS repetidas y bloqueantes contra el resolvedor del servidor. Esto permite consumir conexiones PHP, tablas e infraestructura DNS sin pasar por las cuotas de enlaces.
- Corrección propuesta: límite estricto de dominios y verificaciones por workspace/IP, rate limit específico para verify/revalidate, timeout/resolver controlado y, preferiblemente, verificación en job con deduplicación.

### BAF-029 — Carreras al registrar el mismo dominio devuelven una excepción de base de datos

- Severidad: baja de disponibilidad
- Evidencia: `DomainController::store` comprueba existencia y luego inserta sin lock ni captura de conflicto (`app/Http/Controllers/DomainController.php:32-42`). La base exige unicidad case-insensitive en `custom_domains_domain_unique` (`database/migrations/2026_08_18_000007_add_postgres_indexes.php:13`).
- Impacto: dos workspaces que intenten registrar simultáneamente el mismo dominio pasan la lectura inicial; una inserción falla como error interno en lugar de un `409` recuperable.
- Corrección propuesta: tratar el conflicto único como `409` o efectuar una inserción condicional; añadir un test paralelo entre workspaces.

### BAF-030 — Un CAPTCHA correcto puede consumirse más de una vez bajo concurrencia

- Severidad: baja de defensa antiabuso
- Evidencia: `Captcha::verify` hace `Cache::get` de estado en `app/Support/Captcha.php:69`, valida la respuesta y sólo después ejecuta `Cache::forget` en `:79-91`; no usa `Cache::pull`, compare-and-delete ni lock. El contador de intentos fallidos tiene la misma lectura-modificación-escritura no atómica (`:74-84`).
- Impacto: peticiones simultáneas desde la misma IP con el mismo reto y respuesta correcta pueden pasar antes de que una elimine la clave. El limitador de registro reduce el alcance, pero se pierde la garantía declarada de reto de un solo uso y se debilita la barrera contra altas automatizadas.
- Corrección propuesta: consumir el reto bajo un lock atómico o mediante operación compare-and-delete del store compartido; probar replays concurrentes y fallos paralelos.

### BAF-031 — Un Referer largo puede romper la redirección pública con un 500

- Severidad: media de disponibilidad
- Evidencia: `RedirectService::referrerDomain` devuelve el host del header sin limitar su longitud (`app/Support/RedirectService.php:230-241`). `RedirectController` lo pasa a `AnalyticsService::recordClick` (`app/Http/Controllers/RedirectController.php:170-181`) y éste lo inserta de forma síncrona en `click_events.referrer_domain` (`app/Support/AnalyticsService.php:21-32`). La migración define ese campo como `string`, es decir `varchar(255)` en PostgreSQL (`database/migrations/2026_08_18_000004_create_analytics_tables.php:19`).
- Impacto: una petición anónima a cualquier enlace con un `Referer` cuyo host supere 255 caracteres puede provocar un error de tamaño de columna antes de que se emita el `302`. Es una denegación de servicio repetible para el redirect mientras se acepte ese header.
- Corrección propuesta: validar y truncar estrictamente el host a 255 caracteres antes de persistir, aislar los fallos de analítica del flujo de redirect y añadir pruebas con Referer sobredimensionado/malformado.

### BAF-032 — Actualizaciones concurrentes de un enlace sobrescriben campos no modificados

- Severidad: media de integridad y control de acceso
- Evidencia: el controlador toma una instantánea del enlace antes de construir el PATCH (`app/Http/Controllers/LinkController.php:188-204` y `:382-405`). `LinkService::update` vuelve a leer sin `lockForUpdate` (`app/Support/LinkService.php:187-195`) y escribe todos los campos derivados de esa instantánea (`:213-238`), sin versión ni `updated_at` condicional.
- Impacto: dos editores que modifican propiedades distintas pueden perder cambios según el último escritor. En particular, una actualización de notas/destino basada en una instantánea anterior puede sobrescribir `password_hash` y retirar una contraseña que otro editor acaba de aplicar.
- Corrección propuesta: usar versionado optimista (`updated_at`/contador de versión y `409`), o lock pesimista y PATCH de sólo los campos explícitos; cubrir conflictos concurrentes de destino, estado, contraseña, tags y reglas.

### BAF-033 — Un editor puede reactivar un enlace bloqueado por la plataforma mediante borrar/restaurar

- Severidad: alta
- Evidencia: sólo `LinkController::state` protege cambios desde/hacia `blocked` para administradores de plataforma (`app/Http/Controllers/LinkController.php:242-276`). Sin embargo, `destroy` queda disponible a cualquier editor y fija el estado a `deleted` sin preservar el bloqueo (`:279-294`); luego `restore`, también disponible a cualquier editor, fija incondicionalmente `active` o `expired` (`:297-312`).
- Impacto: el propietario o un editor de un workspace puede ejecutar `DELETE /links/{id}` y `POST /links/{id}/restore` sobre un enlace bloqueado y devolverlo a `active`, anulando una acción de abuso de plataforma sin privilegios de administrador.
- Corrección propuesta: hacer que bloqueo/moderación sea un atributo o transición irreversible para roles de workspace; rechazar delete/restore de enlaces bloqueados salvo administrador de plataforma y conservar el estado bloqueado al restaurar. Añadir pruebas de bypass y carreras contra bloqueo.

### BAF-034 — La comprobación de alias no protege contra inserciones o cambios concurrentes

- Severidad: baja de disponibilidad
- Evidencia: al crear, `LinkService::create` consulta `aliasExists` antes de iniciar la transacción de inserción (`app/Support/LinkService.php:133-145`) y crea la fila en `:156-175`. Al actualizar repite el patrón (`:197-207` frente a `:213-230`). Los índices únicos de alias están en `database/migrations/2026_08_18_000007_add_postgres_indexes.php:14-15`. `LinkController` sólo convierte `LinkException` en una respuesta controlada (`app/Http/Controllers/LinkController.php:140-143` y `:228-231`), no una violación `QueryException` del índice.
- Impacto: dos creaciones, o dos cambios de alias, que pasan la comprobación al mismo tiempo hacen que una operación falle como error interno, incluso cuando el comprobador de alias había indicado disponibilidad. Es independiente del caso de alias borrado lógicamente de BAF-010.
- Corrección propuesta: mantener los índices como autoridad y traducir la violación única a `409`; para creación manual, realizar el insert condicional/atómico. Añadir pruebas paralelas de create y update sobre el mismo alias.

### BAF-035 — Las precomprobaciones de email presentan carreras que rompen el flujo de alta

- Severidad: baja de disponibilidad y flujo
- Evidencia: `AuthController::register` comprueba la existencia case-insensitive de email en `app/Http/Controllers/AuthController.php:57-67` y sólo después ejecuta `User::create` en la transacción de `:71-85`. `changeRegistrationEmail` hace la misma lectura en `:127-129` antes de actualizar en `:132-142`. PostgreSQL impone el índice `users_email_unique` sobre `lower(email)` (`database/migrations/2026_08_18_000007_add_postgres_indexes.php:11`), pero no hay captura de la violación única ni renderizado de excepción específico en `bootstrap/app.php:45-49`.
- Impacto: dos altas con el mismo email, o un alta y un cambio de email que coincidan, pueden superar ambas lecturas y provocar un `500` para una de ellas. En registro, además se rompe la respuesta anti-enumeración diseñada para ese flujo y el usuario puede no saber si la cuenta terminó creada por la otra petición.
- Corrección propuesta: capturar la violación del índice y devolver la misma respuesta anti-enumeración de registro o un `409` controlado en cambio de email; alternativamente, usar inserción/actualización condicional y pruebas de concurrencia por email.

### BAF-036 — El identificador de visitante es un hash sin clave de IP y user-agent

- Severidad: media de privacidad
- Evidencia: `RedirectController::visitorHash` persiste `substr(hash('sha256', "{$day}|{$ip}|{$userAgent}"), 0, 32)` en `app/Http/Controllers/RedirectController.php:184-192`; `AnalyticsService::recordClick` lo escribe en `click_events.visitor_hash` (`app/Support/AnalyticsService.php:17-32`). En cambio, el proyecto ya dispone de una pseudonimización con clave para IPs en `UvhCrypto::hashIp` (`app/Support/UvhCrypto.php:65-67`).
- Impacto: quien obtenga la base analítica puede comprobar offline candidatos de IP, fecha y user-agent hasta recuperar o correlacionar visitantes. SHA-256 no añade secreto ni resistencia a diccionarios y la fecha es predecible; el valor se conserva por evento, por lo que permite seguimiento diario por enlace incluso sin acceso a los logs de red.
- Corrección propuesta: sustituirlo por un HMAC domain-separated con `APP_SECRET` (por ejemplo, `hmac('uvh:visitor:v1|día|ip|ua')`), documentar su periodo de retención y migrar o purgar hashes existentes según la política de privacidad.

### BAF-037 — Borrar o reconfigurar un webhook no detiene un job que ya lo cargó

- Severidad: media de confidencialidad e integridad
- Evidencia: `WebhookService::attempt` carga entrega y relación webhook, comprueba `active` y conserva URL/secreto en memoria antes de iniciar la petición de red (`app/Support/WebhookService.php:65-82`). Un borrado posterior elimina el webhook y sus entregas por cascada (`database/migrations/2026_08_18_000005_create_integrations_tables.php:25-48`), y una actualización puede cambiar URL/secreto (`app/Http/Controllers/WebhookController.php:80-122`), pero no existe una reclamación, lock ni relectura justo antes de `Ssrf::safeFetch`.
- Impacto: un job concurrente puede publicar el evento a la URL antigua después de que un editor borre el webhook para revocar ese destino, o después de rotar su secreto/cambiar endpoint. La posterior actualización de estado de la entrega puede no afectar filas ya borradas, pero la filtración o la entrega duplicada ya se produjo.
- Corrección propuesta: reclamar la entrega de forma atómica y, antes de la conexión, comprobar en base de datos que el webhook sigue existiendo, activo y con la versión/URL esperada. Al borrar o rotar, invalidar las entregas pendientes mediante una versión de configuración o cancelación explícita.

### BAF-038 — Una sesión revocada por reset puede ganar la carrera y volver a cambiar la contraseña

- Severidad: alta
- Evidencia: `changePassword` comprueba la contraseña actual sobre el objeto de usuario hidratado antes de su transacción (`app/Http/Controllers/AuthController.php:456-470`) y actualiza el hash sin bloquear ni revalidar la sesión (`:470-474`). En paralelo, `resetPassword` cambia el hash y revoca todas las sesiones (`:408-424`). `SessionManager::hydrate` sólo verifica la revocación al principio de la petición (`app/Support/SessionManager.php:47-73`), por lo que una petición de cambio ya autenticada no vuelve a comprobarla.
- Impacto: si un atacante conserva una sesión y conoce la contraseña comprometida, puede iniciar `change-password`, superar la comprobación y esperar. Si la víctima resetea su contraseña después, el atacante puede dejar que su transacción escriba al final un nuevo hash elegido por él. Aunque su cookie queda revocada, puede iniciar sesión otra vez con esa contraseña, anulando el propósito de recuperación de cuenta.
- Corrección propuesta: dentro de una única transacción bloquear la fila de usuario, recargar y volver a comprobar la contraseña; verificar que el `session_id` actual continúa sin revocar inmediatamente antes de escribir. Introducir una versión de credenciales/sesión que el reset incremente y exigirla en acciones sensibles; cubrir expresamente la carrera reset frente a cambio de contraseña.

### BAF-039 — Acciones de credenciales autenticadas no tienen rate limit propio

- Severidad: media de control de cuenta
- Evidencia: el grupo de rutas elimina el limitador API por defecto en `bootstrap/app.php:39-43`. Las rutas `auth/change-password`, `auth/mfa/setup`, `auth/mfa/enable` y `auth/mfa/disable` sólo exigen sesión (`routes/api.php:46-50`) y no añaden ningún `throttle`; sin embargo, `changePassword` y `mfaSetup` prueban contraseñas, y los flujos MFA prueban TOTP (`app/Http/Controllers/AuthController.php:456-599`).
- Impacto: alguien que obtenga una cookie de sesión, aunque no conozca la contraseña, puede intentar sin presupuesto de peticiones la contraseña actual y, al acertarla, cambiarla o configurar su propio MFA para persistir el acceso. Los límites de login no cubren estos endpoints y el ataque puede distribuirse o ejecutarse directamente con la sesión robada.
- Corrección propuesta: añadir límites por usuario, sesión e IP a todas las acciones de credenciales/MFA, con presupuestos separados y auditoría/alertas de fallos. Para cambios irreversibles, exigir reautenticación reciente y aplicar una espera progresiva.

### BAF-040 — La denuncia pública permite llenar indefinidamente la cola de moderación

- Severidad: media de disponibilidad operativa
- Evidencia: `PublicController::report` inserta una fila por cada petición válida en `abuse_reports` (`app/Http/Controllers/PublicController.php:51-94`) sin CAPTCHA, deduplicación por enlace/reportante ni cupo global. La única defensa es `throttle:uvh-report`, diez peticiones por minuto y por IP (`routes/api.php:17-20`, `app/Providers/AppServiceProvider.php:48-53`). El housekeeping no purga `abuse_reports` (`app/Console/Commands/UvhHousekeeping.php:62-99`) y el panel administrativo lista sólo las 100 más recientes (`app/Http/Controllers/AdminController.php:74-89`).
- Impacto: una red de IPs puede crear denuncias ilimitadas sobre cualquier enlace, incrementar permanentemente la tabla y ocultar casos reales en la lista de moderación. También distorsiona `openReports`, que el panel usa como señal operativa.
- Corrección propuesta: limitar por enlace, IP y/o huella de navegador, deduplicar denuncias abiertas, aplicar challenge adaptativo y definir retención/triage para reportes. Añadir límites globales y paginación/filtros robustos en administración.

### BAF-041 — Las invitaciones de workspace se pueden usar para abuso de correo

- Severidad: media de disponibilidad y reputación de envío
- Estado actual: parcialmente mitigado, no cerrado. El throttle anterior era
  por sesión/workspace y faltaba capacidad activa; BAF-134/135 corrigen esas
  ramas. BAF-136 añade código de destinatario/IP/volumen diario; migración,
  calibración, concurrencia real y alertas siguen en `INVITATION-004`.
- Evidencia: cualquier administrador de workspace puede crear una invitación para cada dirección distinta (`app/Http/Controllers/WorkspaceController.php:214-262`) y reenviar una pendiente cuantas veces quiera, rotando el token y enviando un nuevo email (`:331-350`). Estas rutas no tienen `throttle` en `routes/api.php:71-85`; tampoco hay cuota de invitaciones en el modelo/migraciones. `UvhMail` intenta el envío en el request (`app/Support/UvhMail.php:14-31`).
- Impacto: una cuenta verificada maliciosa puede utilizar el proveedor y dominio de UVH para enviar campañas de invitación a direcciones arbitrarias, o acosar a una dirección con reenvíos. Además de ocupar workers, eleva el riesgo de bloqueo del proveedor de correo que afectaría registro y recuperación de todos los usuarios.
- Corrección propuesta: límite de invitaciones y reenvíos por workspace, actor, destinatario e IP; ventana mínima por destinatario, CAPTCHA/riesgo adaptativo y cuota diaria de correo. Separar el envío mediante outbox/cola y alertar sobre anomalías.

### BAF-042 — Los API tokens no tienen límite de cantidad ni control de frecuencia

- Severidad: media de disponibilidad y control de credenciales
- Evidencia: `TokenController::store` crea un token por petición sin contar tokens previos (`app/Http/Controllers/TokenController.php:22-54`). La ruta `POST /api/v1/tokens` sólo exige editor verificado y no lleva `throttle` (`routes/api.php:99-103`); la tabla `api_tokens` tampoco impone un máximo por workspace (`database/migrations/2026_08_18_000005_create_integrations_tables.php:12-23`). Además, `expiresAt` sólo se parsea si es un string no vacío (`TokenController.php:40-46`): un valor JSON malformado de otro tipo se ignora y se persiste como `NULL`, es decir sin caducidad.
- Impacto: un editor, o una sesión comprometida, puede crear un número ilimitado de credenciales de larga duración y filas asociadas; un cliente defectuoso que envíe una caducidad no textual puede convertir silenciosamente un token que pretendía ser temporal en permanente. Esto aumenta superficie de secretos expuestos, trabajo de revocación, consumo de base de datos y el coste de búsquedas/gestión; combinado con BAF-001, algunos de esos tokens pueden seguir operativos después de retirar al creador.
- Corrección propuesta: imponer máximo configurable de tokens activos por workspace/actor, validar estrictamente `expiresAt` (o rechazar tipos distintos de `null`/string), establecer expiración máxima o revisión periódica y alertas ante creación masiva. Revocar automáticamente al reducir o eliminar la membresía.

### BAF-043 — Cada correo de cuenta registra la dirección y el tipo de acción en logs

- Severidad: media de privacidad
- Evidencia: `UvhMail::send` llama siempre a `Log::info` con `to` y `subject`, incluso cuando usa un proveedor real, en `app/Support/UvhMail.php:9-25`. Registro/verificación, recuperación de contraseña e invitaciones usan ese método (`:34-61`). El asunto revela la acción de seguridad o el workspace invitante; la configuración de logging por defecto acepta nivel `debug` (`backend-laravel/config/logging.php:55-73`) y no hay retención específica para estos logs.
- Impacto: cualquier operador, agregador de logs o tercero con acceso al canal de observabilidad obtiene un registro de direcciones de email y de eventos sensibles —por ejemplo que una persona solicitó reset de contraseña o recibió una invitación a un workspace— aunque no pueda ver el token, excediendo el mínimo necesario para entregar el correo.
- Corrección propuesta: no registrar destinatarios ni asuntos en producción; si hace falta trazabilidad, usar un identificador interno/HMAC de corta retención y controles de acceso al log. Mantener la redacción de URLs y documentar retención/sanitización del canal de correo.

### BAF-044 — El CAPTCHA de registro es resoluble automáticamente desde la propia respuesta

- Severidad: media de defensa antiabuso
- Evidencia: `Captcha::issue` entrega al cliente el texto `¿Cuánto es {left} + {right}?` y calcula como respuesta exactamente la suma de ambos operandos (`app/Support/Captcha.php:20-42`). La propia suite automatiza su resolución extrayendo los dos números y sumándolos (`backend-laravel/tests/Feature/ApiParityTest.php:327-340`). El token cifra el identificador, pero no oculta ningún dato necesario para calcular la respuesta.
- Impacto: un bot no necesita reconocimiento visual, IA ni interacción humana: obtiene el reto, suma dos enteros y pasa el control. El único freno restante para registros automatizados es el límite por IP, que se puede distribuir; la barrera se combina además con la carrera de reuso descrita en BAF-030.
- Corrección propuesta: sustituirlo por una defensa antiabuso que no revele determinísticamente la solución al cliente (proveedor CAPTCHA/turnstile, proof-of-work adaptativo, reputación y rate limit por cuenta/IP/dispositivo). Si se conserva un reto propio, evaluar su resistencia real contra automatización antes de llamarlo CAPTCHA.

### BAF-045 — Se aceptan contraseñas más largas que el límite efectivo de bcrypt

- Severidad: media de autenticación
- Evidencia: `validPassword` permite hasta 128 bytes para cuentas (`app/Http/Controllers/AuthController.php:614-617`) y las contraseñas de enlace admiten hasta 256 (`app/Http/Controllers/LinkController.php:358-360`, `RedirectController.php:85-87`). Todos se procesan con `Hash::make`/`Hash::check`. La configuración `hashing.php` no existe, por lo que `HashManager` construye `BcryptHasher` sin `limit` (`vendor/laravel/framework/src/Illuminate/Hashing/HashManager.php:18-21`); el propio hasher usa `PASSWORD_BCRYPT` (`BcryptHasher.php:43-54`), cuyo límite efectivo es 72 bytes.
- Impacto: dos contraseñas que sólo difieran después del byte 72 se autentican como la misma. Una persona que configure una contraseña larga puede creer que un sufijo secreto la protege, cuando quien conozca los primeros 72 bytes puede iniciar sesión o desbloquear el enlace protegido. El defecto es especialmente fácil de pasar por alto con passphrases/gestores que generan valores largos.
- Corrección propuesta: rechazar explícitamente valores de más de 72 bytes si se mantiene bcrypt, con mensaje claro y pruebas multibyte; preferiblemente usar Argon2id con parámetros y límite apropiados, y migrar/rehashear al siguiente login. Aplicar la misma política a contraseñas de cuenta y enlace.

### BAF-046 — Un único presupuesto por IP bloquea conjuntamente todos los flujos de autenticación

- Severidad: baja de disponibilidad
- Evidencia: `uvh-auth` usa únicamente `$request->ip()` como clave y permite diez peticiones cada 15 minutos (`app/Providers/AppServiceProvider.php:18-23`). Esa misma bolsa protege login, MFA, verificación de email, reenvío, recuperación y reset (`routes/api.php:28-38`), incluidos endpoints a los que se pueden enviar tokens aleatorios sin conocer una cuenta.
- Impacto: alguien que comparta NAT/proxy con una víctima puede gastar diez llamadas inocuas a `verify-email` o `forgot-password` y bloquearle también login, MFA y recuperación durante 15 minutos. Además, un pico legítimo en una de esas acciones degrada las demás porque no están aisladas por endpoint ni por cuenta.
- Corrección propuesta: separar presupuestos por finalidad, combinar IP con email/usuario cuando exista y reservar una cuota de recuperación para usuarios legítimos. Mantener límites globales contra abuso, pero no usar una sola clave IP como punto único de denegación.

### BAF-047 — El desbloqueo de enlaces protegidos comparte límite con la denuncia y el endpoint de estado

- Severidad: baja de disponibilidad
- Evidencia: `POST /r/{alias}/unlock` aplica tanto `throttle:uvh-unlock` como `throttle:uvh-report` (`routes/web.php:11-12`). Esa última bolsa se indexa sólo por IP y permite diez peticiones por minuto (`app/Providers/AppServiceProvider.php:48-53`), y también se asigna a la denuncia pública y al `GET /api/v1/status` (`routes/api.php:17-20`).
- Impacto: diez consultas anónimas y baratas a `status`, o denuncias desde la misma NAT, impiden durante el periodo al usuario legítimo probar la contraseña de cualquier enlace protegido, aunque aún no haya agotado su límite específico por alias. Varias páginas protegidas también compiten entre sí innecesariamente.
- Corrección propuesta: eliminar `uvh-report` de unlock y usar sólo un limitador específico con claves host/alias/IP; separar estado, denuncia y autenticación de enlace en presupuestos independientes.

### BAF-048 — Tipos no booleanos permiten eludir la garantía de “queda un administrador”

- Severidad: media de disponibilidad administrativa
- Evidencia: `AdminController::updateUser` sólo activa su guardia de último administrador si los valores son estrictamente `false` o `true` (`app/Http/Controllers/AdminController.php:50-58`), pero después convierte cualquier valor no nulo a booleano de PHP (`:60-72`). Así, `isAdmin: []` no satisface `=== false` pero se convierte a `false`, y `blocked: "true"` no satisface `=== true` pero se convierte a `true`.
- Impacto: una llamada JSON malformada desde una sesión administrativa puede despromover o bloquear al último administrador activo en una sola petición, eludiendo la invariante sin necesitar la carrera de BAF-024. Cadenas como `"false"` también se interpretan como `true`, por lo que un cliente que no tipa correctamente puede otorgar o retirar privilegios al usuario equivocado.
- Corrección propuesta: aceptar únicamente booleanos JSON con `is_bool` antes de cualquier cálculo o escritura, rechazar otros tipos con `422` y ejecutar la comprobación de último administrador dentro de una transacción bloqueada.

### BAF-049 — “Cancelar” una invitación ya aceptada da éxito pero no revoca el acceso

- Severidad: baja de flujo y autorización operativa
- Evidencia: `cancelInvitation` carga cualquier invitación del workspace y siempre cambia su estado a `cancelled` (`app/Http/Controllers/WorkspaceController.php:312-328`), sin exigir `status = pending` ni eliminar una membresía. La aceptación ya creó/actualizó la membresía de forma independiente (`:281-286`).
- Impacto: un administrador puede cancelar una invitación aceptada y recibir `ok: true`, pero la persona continúa siendo miembro y conserva acceso. El estado histórico además queda como `cancelled`, dificultando entender que el usuario sigue dentro; para retirarlo hay que llamar a otra ruta (`members/{userId}`), algo que el endpoint no comunica.
- Corrección propuesta: permitir cancelación sólo de invitaciones pendientes y devolver conflicto para estados finales; si se desea revocar acceso, exponer una operación explícita que elimine la membresía y audite ambos cambios.

### BAF-050 — Un secreto de webhook ilegible deja la entrega pendiente sin estado de fallo

- Severidad: baja de disponibilidad operativa
- Evidencia: `WebhookService::attempt` descifra el secreto y serializa el payload antes de entrar en su `try/catch` (`app/Support/WebhookService.php:72-77`). `UvhCrypto::decryptAtRest` lanza cuando el material cifrado no puede autenticarse, por ejemplo tras una rotación accidental de `APP_SECRET` o ante un valor dañado (`app/Support/UvhCrypto.php:57-70`). El job no declara `tries`, `backoff` ni método `failed` (`app/Jobs/WebhookDeliveryJob.php:15-27`); por tanto la excepción de esa fase no ejecuta `scheduleRetry`, no actualiza la fila y la entrega se queda con `status = pending`. El housekeeping vuelve a despacharla mientras siga pendiente (`app/Console/Commands/UvhHousekeeping.php:33-42`), y la purga sólo elimina entregas `success` (`:82-88`).
- Impacto: un secreto cifrado que deja de ser descifrable genera fallos de worker y una entrega que aparenta seguir reintentable, no muestra `last_error` ni llega a `failed`, y no se purga. El scheduler la reinyecta repetidamente, creando ruido en `failed_jobs`/logs y acumulando filas que requieren intervención manual. Es independiente de BAF-005: aquí la excepción evita por completo la lógica de intentos.
- Corrección propuesta: incluir descifrado, serialización y firma dentro del bloque de manejo; al fallar, registrar un error seguro y marcar la entrega como `failed` (o aplicar una política acotada de reintento). Añadir `failed(Throwable)` al job para cerrar la entrega ante excepciones no controladas y una ruta de rotación de claves que recifre secretos antes de cambiar `APP_SECRET`. Probar payload/secreto corrupto y rotación controlada.

### BAF-051 — Un `User-Agent` válido pero largo puede impedir crear una sesión

- Severidad: baja de disponibilidad
- Evidencia: al completar login, MFA o recuperación, `SessionManager::create` persiste el header completo `user-agent` sin validar ni truncar (`app/Support/SessionManager.php:17-30`). La columna `sessions.user_agent` se crea como `string`, equivalente a `varchar(255)` en PostgreSQL (`database/migrations/2026_08_18_000001_create_users_and_sessions_tables.php:25-34`). Ninguno de esos flujos captura la excepción de longitud de columna.
- Impacto: una petición de autenticación legítima con un `User-Agent` de 256 caracteres o más —dentro de los límites habituales de HTTP y de proxies— puede terminar la verificación de credenciales pero fallar al insertar la sesión con `500`. Afecta a login directo y a los pasos finales de MFA/recuperación; el usuario queda sin poder iniciar sesión desde ese cliente.
- Corrección propuesta: limitar el valor a 255 caracteres de forma UTF-8 segura antes de persistir, o ampliar conscientemente el tipo a `text`; aplicar una política de normalización de headers persistidos y cubrir login, MFA y recuperación con un `User-Agent` sobredimensionado.

### BAF-052 — El ranking “top links” calcula primero el top global y luego filtra el workspace

- Severidad: media de integridad analítica y disponibilidad
- Evidencia: en `AnalyticsController::buildOverview`, cuando no se solicita `linkId`, el subquery de `topLinks` agrega `metric_rollups` de todos los enlaces, ordena por clics y aplica `LIMIT 8` antes de hacer join con `links` y aplicar `where('l.workspace_id', $workspaceId)` (`app/Http/Controllers/AnalyticsController.php:124-142`). El filtro de workspace no forma parte del subquery agregado; los otros totales de la misma respuesta sí parten de una consulta filtrada por workspace (`:98-107`).
- Impacto: si los ocho enlaces con más clics del periodo pertenecen a otros workspaces, un workspace con tráfico propio recibe un ranking vacío; si sólo algunos son externos, recibirá menos de ocho y no necesariamente sus enlaces más vistos. Además, cada consulta recorre/agrega rollups de todos los tenants para formar ese top global, por lo que un endpoint sin throttle hace trabajo transversal creciente aunque el resultado final sea de un único workspace.
- Corrección propuesta: limitar `metric_rollups` al workspace dentro del subquery (join o `whereIn` antes de `GROUP BY`/`LIMIT`), añadir un índice compatible con el filtro temporal y cubrir con dos workspaces cuyos enlaces globalmente dominantes pertenezcan sólo a uno de ellos. Aplicar un límite específico a consultas analíticas costosas.

### BAF-053 — Un token de reset emitido antes del bloqueo aún cambia la contraseña de la cuenta bloqueada

- Severidad: media de control de cuenta
- Evidencia: al bloquear, el administrador marca `users.deleted_at` y revoca sesiones y API tokens, pero no invalida `email_tokens` (`app/Http/Controllers/AdminController.php:64-70`). `resetPassword` consume un token de tipo `reset` válido y ejecuta `User::where('id', $row->user_id)->update(...)` sin filtrar `deleted_at` ni bloquear/comprobar la fila de usuario (`app/Http/Controllers/AuthController.php:408-424`). En contraste, la verificación de email sí exige explícitamente `whereNull('deleted_at')` (`:309-313`).
- Impacto: quien conserve un enlace de recuperación emitido antes del bloqueo —incluido un atacante con acceso al correo comprometido— puede establecer una contraseña nueva mientras la cuenta está deshabilitada. No obtiene sesión mientras continúe bloqueada, pero cuando un administrador la reactive, esa contraseña ya queda preparada para iniciar sesión. Esto debilita el bloqueo como contención de incidente y deja una mutación de credenciales sin señal específica para la revisión.
- Corrección propuesta: en el mismo bloqueo revocar o borrar tokens de email pendientes; durante reset, bloquear y exigir que el usuario exista y no esté bloqueado antes de consumir el token y escribir el hash. Al desbloquear, considerar requerir un reset iniciado de nuevo y auditar los intentos de uso de tokens de cuentas bloqueadas.

### BAF-054 — Las intenciones anónimas permiten llenar la caché durante 24 horas

- Severidad: media de disponibilidad
- Evidencia: `POST /api/v1/link-intents` es público y reutiliza el limitador `uvh-link-create` (`routes/api.php:21-23`), configurado a 30 peticiones por minuto y sólo por IP (`app/Providers/AppServiceProvider.php:31-35`). Cada solicitud válida genera una clave aleatoria nueva y guarda destino, estado y caducidad en la caché durante 24 horas (`app/Http/Controllers/LinkIntentController.php:20-43`). El store por defecto es la tabla de caché de la base de datos (`config/cache.php:18,42-48`); no hay cuota de intenciones activas por IP ni límite global de tamaño.
- Impacto: una única IP dentro de su presupuesto puede retener hasta 43.200 registros/día, cada uno con una URL de hasta 2.048 bytes; un actor puede distribuirlo o variar un parámetro de una URL válida para evitar cualquier reutilización. La nueva ruta convierte tráfico anónimo barato en crecimiento persistente de la tabla/cache y carga de housekeeping/BD durante 24 h, sin necesidad de crear una cuenta ni un enlace real.
- Corrección propuesta: aplicar un presupuesto mucho menor y separado para emisión de intenciones, limitar atómicamente las intenciones vivas por IP/huella, reutilizar/reemplazar la intención reciente del mismo navegador y definir un máximo de almacenamiento/alertas. Considerar un challenge adaptativo antes de reservar 24 h de estado.

### BAF-055 — Reconfigurar MFA invalida el autenticador anterior antes de confirmar el nuevo

- Severidad: media de disponibilidad de cuenta
- Evidencia: para una cuenta con MFA activo, `mfaSetup` comprueba contraseña y TOTP actual (`app/Http/Controllers/AuthController.php:513-534`) pero acto seguido sobrescribe directamente `mfa_secret` con un secreto nuevo (`:536-542`). `mfa_enabled` permanece en `true`; `mfaEnable` sólo comprueba el código del secreto ya sobrescrito y genera recovery codes (`:545-570`). No existe estado temporal, confirmación atómica ni posibilidad de volver al secreto previo.
- Impacto: si la respuesta de setup se pierde, se cierra la pestaña o el usuario abandona antes de registrar el nuevo autenticador, el TOTP anterior deja de funcionar inmediatamente aunque MFA siga requerido. Las recovery codes permiten crear una sesión, pero no sirven para reconfigurar ni desactivar MFA porque esos endpoints vuelven a exigir el TOTP ya perdido (`:527-533`, `:573-587`). El usuario puede quedar bloqueado de su propia configuración MFA hasta intervención de soporte o agotamiento de otros mecanismos.
- Corrección propuesta: guardar el secreto nuevo como pendiente con TTL y no reemplazar el secreto activo ni los recovery codes hasta validar el primer TOTP nuevo dentro de una transacción. Permitir cancelar/expirar la configuración pendiente y diseñar una recuperación MFA autenticada que use un recovery code de un solo uso para restablecer el factor, con auditoría y reautenticación.

### BAF-056 — Un secreto MFA no descifrable provoca `500` y no tiene recuperación integrada

- Severidad: media de disponibilidad de cuenta
- Evidencia: `UvhCrypto::decryptAtRest` lanza una excepción cuando el cifrado autenticado no valida (`app/Support/UvhCrypto.php:57-70`). Las rutas `mfaVerify`, `mfaSetup` para MFA activo, `mfaEnable` y `mfaDisable` lo invocan directamente sin capturarla (`app/Http/Controllers/AuthController.php:211`, `:531`, `:553`, `:586`). No hay flujo de rotación de `APP_SECRET` ni de marcado/reset de secretos MFA ilegibles. Aunque `mfaRecovery` permite entrar usando un código de recuperación, después la misma sesión no puede reconfigurar o desactivar MFA porque esas rutas vuelven a fallar al descifrar.
- Impacto: una rotación no coordinada de clave, una fila dañada o un error de restauración deja a las cuentas MFA afectadas con respuestas `500` al iniciar sesión o administrar su segundo factor. Los recovery codes no solucionan plenamente el incidente y el único desbloqueo es una intervención manual en datos.
- Corrección propuesta: capturar el error y devolver un estado de recuperación no sensible; permitir que una sesión autenticada mediante recovery code, con reautenticación adecuada, reemplace/elimine un secreto MFA ilegible. Definir rotación con versionado de claves y recifrado gradual, y añadir pruebas de secreto corrupto/cambio de clave.

### BAF-057 — Los códigos de recuperación MFA generados no se pueden validar por diferencia de mayúsculas

- Severidad: alta de disponibilidad de cuenta
- Evidencia: al activar MFA, el sistema genera códigos mediante `Ids::randomToken(10)` y guarda el hash de cada valor original (`app/Http/Controllers/AuthController.php:557-565`; `Ids::randomToken` usa Base64URL y conserva mayúsculas/minúsculas en `app/Support/Ids.php:9-12`). Sin embargo, al recuperar MFA calcula el hash de `strtoupper($code)` (`AuthController.php:248-255`). Un código devuelto con letras minúsculas —lo normal para Base64URL— no puede coincidir con el hash persistido de su forma original.
- Impacto: los recovery codes entregados a la persona usuaria fallan casi siempre aun cuando se introducen literalmente. Cada intento además incrementa el contador compartido de BAF-013, por lo que tratar de usar los diez códigos puede bloquear temporalmente también el TOTP legítimo. Se rompe el mecanismo de contingencia principal ante pérdida del autenticador.
- Corrección propuesta: normalizar de forma idéntica al generar, mostrar y verificar (por ejemplo, usar un alfabeto explícitamente uppercase y hashear `strtoupper` desde el inicio), o dejar de transformar la entrada y documentar sensibilidad a mayúsculas. Invalidar y regenerar de forma segura los hashes existentes, y añadir pruebas que activen MFA y consuman literalmente un código de recuperación real.

### BAF-058 — Un desafío MFA previo al reset puede crear una sesión nueva después de revocar todas las sesiones

- Severidad: alta de control de cuenta
- Evidencia: tras validar contraseña, `login` guarda en caché un desafío MFA de cinco minutos asociado al usuario (`app/Http/Controllers/AuthController.php:149-180`, `:642-653`). `resetPassword` cambia la contraseña y revoca las filas de sesión existentes, pero no invalida desafíos MFA pendientes (`:408-424`). Más tarde `mfaVerify` acepta el desafío sólo comprobando usuario, verificación y secreto MFA, y crea una sesión nueva (`:197-223`); no compara una versión de credenciales ni verifica que la contraseña no haya cambiado desde la emisión del desafío.
- Impacto: un atacante que inició login con la contraseña comprometida y obtuvo un desafío antes de que la víctima restablezca la contraseña puede completar MFA durante su TTL y recibir una cookie nueva después de la revocación global. El reset aparenta cerrar todas las sesiones pero no invalida esta autenticación parcialmente completada; la misma ventana existe alrededor del cambio de contraseña.
- Corrección propuesta: asociar cada desafío a una versión/fecha de credenciales o a un nonce de autenticación que se invalide al reset, cambio de contraseña, bloqueo y cambios MFA. En `mfaVerify`, bloquear/recargar el usuario y rechazar desafíos anteriores a `password_changed_at` o a una versión de seguridad. Añadir una prueba concurrente login-MFA frente a reset/cambio de contraseña.

## Ampliación manual — dominios personalizados y DNS (2026-08-31)

### BAF-059 — No existe aprovisionamiento TLS para dominios de clientes

- Severidad: bloqueante de producción
- Estado: confirmado, pendiente de infraestructura
- Evidencia: el `default_server` de `docker/nginx/uvh.conf.template` reenvía
  cualquier hostname a PHP, mientras `docker-compose.production.yml` sólo
  publica Nginx en loopback y delega TLS a un proxy externo. El repositorio no
  contiene ACME, custom hostnames, emisión, renovación, revocación ni estado de
  certificado para dominios arbitrarios.
- Impacto: un dominio puede figurar como activo en UVH y fallar antes de llegar
  a la aplicación por SNI/certificado. Un wildcard de UVH no cubre el dominio
  del cliente; una baja local tampoco garantiza retirar recursos del edge.
- Corrección: completar los P0 de `docs/todos.md` y bloquear activación comercial
  hasta disponer de evidencia de emisión, renovación, SNI y teardown.

### BAF-060 — Activar sólo acredita TXT, no ruta DNS ni disponibilidad HTTPS

- Severidad: alta de flujo e integridad operativa
- Estado: confirmado, pendiente de diseño de infraestructura
- Evidencia: `DomainController::activate` sólo comprueba estado y fecha de
  verificación; `VerifyDomainDnsJob` sólo consulta TXT. No se consulta el
  CNAME/A/AAAA de tráfico ni existe un estado de certificado.
- Impacto: el panel puede declarar activo un hostname que no apunta a UVH, tiene
  un CNAME erróneo o carece de certificado, generando enlaces publicados que no
  funcionan y diagnósticos engañosos.
- Corrección: separar propiedad, routing y certificado; permitir `active` sólo
  después de las tres confirmaciones idempotentes.

### BAF-061 — Un job DNS antiguo podía pisar o liberar una verificación nueva

- Severidad: alta de integridad concurrente
- Estado: remediado manualmente; validación pendiente
- Evidencia: el lock anterior expiraba a los cinco minutos y cada job ejecutaba
  `Cache::forget` sobre la misma clave. No existía generación en
  `custom_domains`, por lo que dos comprobaciones con estado/token iguales podían
  aplicar resultados y eventos fuera de orden.
- Impacto: una respuesta antigua podía cambiar a `error` un dominio que una
  comprobación posterior validó, duplicar `domain.verified` o abrir la admisión
  de una tercera comprobación al liberar el lock ajeno.
- Corrección aplicada: migración `2026_08_31_000016`, generación monotónica,
  lock con owner transferido al worker, reintentos y evento sólo en la primera
  verificación satisfactoria.

### BAF-062 — No hay revalidación periódica ni gracia ante transferencia DNS

- Severidad: alta de takeover y disponibilidad
- Estado: confirmado, pendiente
- Evidencia: sólo se revalida por acción manual. Un dominio `active` conserva ese
  estado indefinidamente; una consulta sin TXT lo desactiva de inmediato y un
  fallo del resolver se reintenta, pero no existe `last_checked_at`, siguiente
  revisión, contador de fallos ni periodo de gracia.
- Impacto: tras transferencia o pérdida de control DNS, UVH puede conservar una
  asociación obsoleta; en sentido contrario, una incidencia DNS breve puede
  interrumpir todos sus enlaces cuando alguien revalida manualmente.
- Corrección: scheduler de revalidación con múltiples señales, backoff, gracia,
  desactivación persistente y coordinación con el proveedor TLS.

### BAF-063 — El TXT de propiedad ocupaba el nombre necesario para CNAME

- Severidad: alta funcional
- Estado: remediado manualmente; compatibilidad y validación pendientes
- Evidencia: la UI sólo mostraba el valor TXT y el job consultaba TXT sobre el
  propio hostname. DNS no permite un CNAME junto con otros datos en el mismo
  owner name, que es el patrón normal de conexión de un subdominio al edge.
- Impacto: seguir la verificación podía impedir configurar la ruta requerida, o
  configurar el CNAME podía borrar la prueba y hacer fallar futuras revisiones.
- Corrección aplicada: challenge en `_uvh-verification.<dominio>`, nombre y valor
  explícitos en la UI, y fallback temporal de lectura del formato anterior.

### BAF-064 — La prueba TXT aceptaba una coincidencia por subcadena

- Severidad: media de validación
- Estado: remediado manualmente; validación pendiente
- Evidencia: `VerifyDomainDnsJob` utilizaba `str_contains` después de recortar
  comillas. Cualquier TXT que incluyera el token dentro de otro valor se aceptaba.
- Impacto: la prueba no correspondía exactamente al challenge emitido y podía
  producir validaciones accidentales en registros agregados por proveedores.
- Corrección aplicada: normalización limitada de comillas/fragmentos y
  comparación completa con `hash_equals`.

### BAF-065 — Reactivación con prueba histórica y ausencia de nombres reservados

- Severidad: media de control de dominio
- Estado: remediado manualmente; validación pendiente
- Evidencia: un dominio `disabled` podía volver a `active` con cualquier
  `verified_at` histórico y el alta no rechazaba `PUBLIC_HOST`, `APP_HOST` ni sus
  variantes `www`.
- Impacto: una vinculación antigua podía reactivarse tras cambios de propiedad;
  además, la tabla aceptaba intentar registrar superficies de primera parte.
- Corrección aplicada: los deshabilitados deben revalidar, los verificados sólo
  activan con una prueba reciente (24 h por defecto) y se reservan hostnames UVH.

### BAF-066 — Borrar un dominio alteraba enlaces recuperables de la papelera

- Severidad: media de integridad
- Estado: remediado manualmente; validación pendiente
- Evidencia: el borrado sólo buscaba enlaces no eliminados y la FK usa
  `nullOnDelete`; un enlace soft-deleted quedaba sin `domain_id`. Al restaurarlo,
  su URL pasaba silenciosamente al host público y podía colisionar por alias.
- Impacto: restaurar no recuperaba la identidad pública original del enlace.
- Corrección aplicada: bloquear el borrado mientras exista cualquier enlace,
  incluidos los eliminados, y explicar la reasignación requerida en la UI.

### BAF-067 — Los viewers recibían el challenge y controles no autorizados

- Severidad: baja de mínimo privilegio y UX
- Estado: remediado manualmente; validación pendiente
- Evidencia: listar dominios requería rol viewer, pero el DTO siempre incluía el
  token y Angular mostraba verificación, activación y borrado aunque las rutas de
  escritura exigieran editor.
- Impacto: exposición innecesaria de metadatos internos y una interfaz que
  conducía sistemáticamente a `403`.
- Corrección aplicada: token nullable sólo para editor/admin/owner y UI de
  consulta separada para viewer.

## Limitaciones de validación

- La validación se ha ejecutado con PostgreSQL y PHP en Docker local; no se han enviado webhooks, correos ni tráfico de prueba a servicios externos.
- PHPUnit usa una base aislada `uvh_test`. El bind mount de Windows bloquea PHPUnit por E/S `p9_client_rpc`, por lo que la suite se ejecutó tras copiar el backend a un contenedor efímero; el resultado completo está registrado arriba.
- Aún faltan pruebas de concurrencia de varios procesos (cuotas, primeros clics y transiciones de invitación), una prueba de navegador/e2e del MFA real y una prueba de integración de proxy de producción.
- Los webhooks mantienen semántica de entrega al menos una vez: el receptor debe deduplicar por `event_id`, incluso aunque UVH no confirme un cambio o borrado hasta que termine su propia petición activa. Continúa siendo recomendable instrumentar alertas de cola, correo y caché en producción.
- La ampliación del 31 de agosto fue una revisión manual sin ejecutar suites,
  builds, linters ni consultas contra DNS/TLS externos. Las remediaciones
  BAF-059 a BAF-067 tienen cambios locales posteriores, pero todos requieren
  validación externa y bloquean afirmar que los dominios funcionan de extremo
  a extremo.

## Ampliación manual — autenticación, eventos y producción (2026-09-01)

Esta pasada revisó código y configuración sin ejecutar pruebas automatizadas.
Los cambios descritos como resueltos son remediaciones manuales pendientes de
typecheck, PHPUnit, migración y E2E en entorno aislado.

### BAF-068 — Verificación y reset compartían un rate limit global vacío

- Severidad: alta de disponibilidad.
- Estado: remediado manualmente; validación pendiente.
- Evidencia: `AppServiceProvider.php:43-72` construía la identidad únicamente
  desde `email`; `verify-email` y `reset-password` sólo envían `token`, por lo
  que usuarios distintos consumían el mismo presupuesto derivado de cadena
  vacía.
- Impacto: diez verificaciones o resets legítimos podían bloquear ese paso para
  todo el servicio durante quince minutos.
- Corrección aplicada: las rutas de consumo usan hash del bearer y las de envío
  usan hash de cuenta. La selección depende de la ruta, no de campos extra que
  pueda introducir el cliente.

### BAF-069 — El rollback de invitaciones escribía una columna inexistente

- Severidad: alta de manejo de errores e integridad de flujo.
- Estado: remediado manualmente; validación pendiente.
- Evidencia: la migración de `invitations` sólo crea `created_at` y el modelo
  declara `UPDATED_AT = null`, pero los dos caminos de fallo de cola añadían
  `updated_at`. Las rutas corregidas están en `WorkspaceController.php:375-385`
  y `:539-552`.
- Impacto: una caída de cola convertía la respuesta recuperable en `500`, podía
  dejar una invitación no entregada como pendiente y, durante un reenvío, podía
  impedir restaurar el bearer anterior ya entregado.
- Corrección aplicada: se actualizan exclusivamente columnas existentes y la
  restauración sigue condicionada al hash del token nuevo para no pisar un
  reenvío posterior.

### BAF-070 — El listado administrativo de denuncias usaba variables sin definir

- Severidad: media de disponibilidad operativa.
- Estado: remediado manualmente; validación pendiente.
- Evidencia: `AdminController::reports` llegaba a filtros/paginación con
  `$query`, `$status` y `$search` no inicializados. La implementación actual
  comienza en `AdminController.php:153` y construye explícitamente join,
  selección, filtros, total y página.
- Impacto: abrir la cola de denuncias podía devolver `500`, dejando al equipo
  sin herramienta de moderación justo ante abuso activo.
- Corrección aplicada: validación de estado, búsqueda acotada, consulta
  paginada y selección explícita de campos del reporte/enlace.

### BAF-071 — Desactivar MFA podía aceptar un código arbitrario si el secreto era ilegible

- Severidad: crítica de control de cuenta, condicionada a secreto cifrado
  corrupto/clave rotada y sesión MFA previa.
- Estado: remediado manualmente; validación pendiente.
- Evidencia: el fallback anterior confiaba en el indicador histórico de la
  sesión cuando no podía descifrar el TOTP. La implementación actual
  `AuthController.php:997-1047` exige contraseña y una comprobación concreta de
  TOTP descifrable o recovery code válido.
- Impacto: bajo esa precondición, seis dígitos cualesquiera podían eliminar el
  segundo factor y todos los códigos de recuperación.
- Corrección aplicada: no existe bypass por estado de sesión; los secretos
  ilegibles sólo se recuperan mediante código de recuperación de un uso.

### BAF-072 — La recuperación MFA no estaba ligada al login con contraseña

- Severidad: alta de diseño de autenticación.
- Estado: remediado manualmente; validación pendiente.
- Evidencia: `AuthController.php:194-424` ahora emite un challenge opaco sólo
  después de password+hCaptcha correctos y tanto TOTP como recovery consumen ese
  mismo challenge bajo lock distribuido y `security_version`.
- Impacto previo: un endpoint basado en email+código separaba indebidamente el
  segundo factor del primer factor y facilitaba enumeración/ataques aislados
  contra recovery codes.
- Corrección aplicada: challenge de cinco minutos, uso único, bloqueo entre
  métodos, límite por challenge/IP, consumo transaccional del recovery code y
  auditoría de fallo/agotamiento.

### BAF-073 — El cliente declaraba logout antes de confirmar revocación

- Severidad: media de seguridad percibida y manejo de red.
- Estado: remediado manualmente; validación pendiente.
- Evidencia: `frontend/src/app/core/services/auth.service.ts:155-160` espera la
  respuesta del servidor antes de borrar la identidad local y avisar a otras
  pestañas; panel y revocación de la sesión actual presentan error recuperable.
- Impacto previo: con red caída la UI mostraba una sesión cerrada aunque la
  cookie y la fila siguieran activas, induciendo al usuario a abandonar un
  dispositivo compartido con una sesión válida.
- Corrección aplicada: estado local y navegación sólo cambian tras revocación
  confirmada; un fallo conserva la representación de sesión activa.

### BAF-074 — Reemplazar bearers antes de admitir el email destruía el último enlace útil

- Severidad: alta de disponibilidad de cuenta/equipo.
- Estado: remediado manualmente; validación pendiente.
- Evidencia: `AuthController.php:488-604` y `WorkspaceController.php:496-557`
  conservan el token anterior hasta que el mensaje nuevo entra en cola; si la
  admisión falla eliminan/restauran sólo la generación no entregada.
- Impacto previo: una caída de cola al reenviar verificación, reset o invitación
  invalidaba el enlace ya recibido y podía bloquear al usuario sin entregar
  sustituto.
- Corrección aplicada: orden de vida útil seguro, condición por hash/generación,
  respuestas `503` recuperables y eventos de fallo sin PII.

### BAF-075 — Bloquear al creador no detenía sus webhooks

- Severidad: alta de aislamiento y salida de datos.
- Estado: remediado manualmente; validación pendiente.
- Evidencia: la admisión y los intentos filtran creadores activos en
  `WebhookService.php:34-48`, `:76-91` y vuelven a comprobar antes de enviar.
- Impacto previo: bloquear una cuenta revocaba sesiones y API tokens, pero los
  hooks que había creado podían seguir recibiendo eventos del workspace.
- Corrección aplicada: se omiten nuevas entregas, se desactiva el webhook si el
  bloqueo se detecta al intentar y las filas legacy sin creador conservan
  compatibilidad explícita.

### BAF-076 — Los errores externos de webhook podían persistir topología sensible

- Severidad: media de fuga operativa.
- Estado: remediado manualmente; validación pendiente.
- Evidencia: `WebhookService.php:335-349` mapea excepciones a categorías seguras
  antes de escribir `last_error`.
- Impacto previo: mensajes de cURL, TLS, resolución o SSRF podían incluir IP,
  host interno o detalles de red visibles a miembros del workspace.
- Corrección aplicada: sólo se persisten mensajes genéricos de política,
  resolución, serialización o conexión; logs reciben como máximo la clase.

### BAF-077 — La validación de producción permitía desactivar controles por configuración

- Severidad: alta operativa.
- Estado: remediado manualmente; validación pendiente.
- Evidencia: `ProductionSecurity.php:79-170` ahora acota rate limits,
  credenciales, retenciones, mailer/remitente, `failed_jobs` y prohíbe
  `QUEUE_CONNECTION=failover`, cuya configuración local termina en `deferred`.
- Impacto previo: límites enormes o retenciones peligrosas pasaban el gate;
  `failover` podía ejecutar trabajo sensible en el proceso web tras perder la
  cola persistente y un driver nulo podía ocultar jobs agotados.
- Corrección aplicada: arranque fail-fast y ejemplo de entorno actualizado. La
  validez material de secretos/CA/servicios aún requiere despliegue real.

### BAF-078 — Emitir API tokens no realiza reautenticación real

- Severidad: alta, condicionada a sesión robada o dispositivo desbloqueado.
- Estado: remediado manualmente; validación pendiente.
- Evidencia actual: `TokenController::store` vuelve a bloquear workspace,
  usuario y sesión, y exige contraseña más TOTP/recovery mediante
  `MfaStepUp`; la UI no habilita la emisión sin esas credenciales.
- Impacto: quien controle una sesión de editor puede crear un bearer de hasta
  un año y trasladar el acceso fuera del navegador.
- Corrección aplicada: step-up por operación, consumo del recovery bajo lock y
  auditoría del tipo de factor sin revelar el bearer. Un grant temporal de UX
  ligado a acción/workspace sigue siendo opcional y no está implementado.

### BAF-079 — El borrado de workspace no exige step-up

- Severidad: alta de integridad y disponibilidad.
- Estado: remediado manualmente; validación pendiente.
- Evidencia actual: `WorkspaceController::destroy` exige nombre exacto,
  contraseña y TOTP/recovery, revalida owner/usuario/sesión bajo locks y conserva
  la exclusión con entregas webhook. El panel presenta un formulario explícito.
- Impacto: una sesión secuestrada del propietario puede eliminar enlaces,
  dominios, equipo, analítica e integraciones por cascada.
- Corrección aplicada: step-up específico, confirmación con nombre, resumen de
  impacto y evento auditado. El borrado continúa siendo inmediato e irreversible;
  una papelera de workspace requeriría un modelo de datos separado.

### BAF-080 — El MFA administrativo permanece válido toda la sesión

- Severidad: alta condicionada a sesión administrativa de larga duración.
- Estado: abierto.
- Evidencia: `RequireMfa.php:10-19` sólo comprueba un booleano hidratado a partir
  de `mfa_verified_at`; no valida su antigüedad. La cookie puede durar hasta 30
  días según la configuración aceptada.
- Impacto: robar una sesión antigua permite acciones administrativas sin volver
  a demostrar el segundo factor.
- Corrección propuesta: step-up con TTL corto para administración y operaciones
  destructivas, challenge dentro de sesión y revocación al cambiar factor,
  contraseña, rol o riesgo.

### BAF-081 — La entrega final de correo no actualizaba el recurso que la originó

- Severidad: media de consistencia operativa.
- Estado: remediado manualmente con outbox general; operación/E2E pendientes.
- Evidencia actual: `SendUvhMailJob` recibe tipo, ID y un hash de generación no
  reversible. Al agotar una invitación, sólo cancela la fila si sigue pendiente
  y su token hash aún coincide; un reenvío nuevo no puede ser cancelado por un
  job antiguo. Export y eliminación tienen compensación específica.
- Impacto: una invitación admitida puede seguir apareciendo pendiente después
  de que el proveedor agote todos los reintentos, sin estado visible ni acción
  automática de recuperación.
- Corrección aplicada: cada sobre cifrado se inserta transaccionalmente en
  `mail_outbox`, se publica por ID, se reclama con lock token y conserva estados
  `pending/queued/processing/sent/failed`. Housekeeping recupera publicación o
  workers atascados y administración muestra conteos/antigüedad sin PII. Falta
  validar fault injection y diseñar reenvío terminal seguro para mensajes aún vigentes.

### BAF-082 — Varias colecciones históricas pueden crecer sin límite contractual

- Severidad: media de disponibilidad y minimización.
- Estado: mitigación avanzada; política final de conservación pendiente.
- Evidencia: sesiones y tokens ya limitan a 100 filas por respuesta en
  `AuthController.php:726-747` y `TokenController.php:21-28`; miembros e
  invitaciones siguen retornándose completos y no existe purga aprobada de API
  tokens revocados/expirados.
- Impacto: cuentas/workspaces longevos incrementan latencia, memoria y volumen
  de datos personales/operativos más allá de lo necesario.
- Corrección aplicada: miembros e invitaciones usan página, tamaño, total y
  orden estable; tokens API se purgan tras una ventana configurable desde
  revocación/caducidad. Falta cerrar retención legal de auditoría, denuncias,
  outbox y jobs fallidos.

### BAF-083 — Supply chain y gestión de secretos aún no alcanzan el gate de producción

- Severidad: alta operativa.
- Estado: abierto.
- Evidencia: `Dockerfile.production` usa imágenes por etiqueta y paquetes apt sin
  pin; Compose consume secretos desde `env_file`. No hay digest, SBOM, firma,
  gestor de secretos ni proceso probado de rotación/rollback en el repositorio.
- Impacto: builds no totalmente reproducibles, mayor exposición de secretos a
  inspección del runtime y ausencia de evidencia sobre procedencia del release.
- Corrección propuesta: digests aprobados, actualización automatizada, SBOM y
  firma, usuario mínimo, secret files/gestor, rotación ensayada y attestation del
  artefacto desplegado.

## Corrección de estado de la ampliación DNS anterior

BAF-059, BAF-060 y BAF-062 ya tienen implementación local: Caddy On-Demand TLS
con `ask`, comprobación CNAME+TXT, provisioning TLS antes de `active` y
revalidación periódica con gracia. Dejan de ser ausencia de código, pero siguen
siendo bloqueantes de lanzamiento hasta validar DNS, CAA, ACME, SNI, renovación,
multi-edge, alertas y transferencia con infraestructura real.

## Ampliación de cuenta y privacidad — 1 de septiembre de 2026

Los cambios siguientes se revisaron manualmente en fuente. No se ejecutaron
PHPUnit, typecheck, build, linters, migraciones ni E2E por la restricción activa
de esta pasada; “resuelto” describe implementación, no validación de runtime.

### BAF-084 — El cambio de contraseña no exigía el segundo factor activo

- Severidad: alta de control de cuenta.
- Estado: remediado manualmente; validación pendiente.
- Evidencia: `AuthController::changePassword` exige un TOTP concreto no
  reutilizable o recovery code de un uso cuando `mfa_enabled=true`, bajo locks de
  usuario/sesión y límite de intentos. `settings.component` recoge el factor.
- Impacto previo: una sesión robada y la contraseña podían rotar credenciales,
  revocar al resto de dispositivos y consolidar el control sin demostrar MFA.
- Corrección aplicada: step-up, consumo atómico de recovery, `security_version`,
  revocación de otras sesiones, invalidación de resets, auditoría sin código y
  aviso de contraseña cambiada.

### BAF-085 — El email de una cuenta verificada no tenía transición segura

- Severidad: alta de identidad y recuperación.
- Estado: remediado manualmente; validación concurrente pendiente.
- Evidencia: migración `000019`, `EmailChangeRequest`, endpoints de solicitud,
  cancelación y confirmación, y pantalla `/auth/confirm-email`.
- Impacto previo: no existía forma profesional de cambiar email manteniendo el
  anterior hasta verificar el nuevo, ni de revocar sesiones/tokens de reset.
- Corrección aplicada: bearer aleatorio almacenado como SHA-256, TTL de una hora,
  contraseña+MFA, reserva única, avisos a ambos buzones, revocación total de
  sesiones al confirmar y advisory lock de PostgreSQL compartido con alta y
  corrección de registro para cerrar la carrera entre tablas.

### BAF-086 — No existía exportación de acceso/portabilidad con garantías

- Severidad: alta de privacidad y disponibilidad operativa.
- Estado: implementado manualmente; alcance jurídico y pruebas pendientes.
- Evidencia: migración `000020`, `AccountController` y
  `GenerateDataExportJob`; el panel expone solicitud/estado/cancelación y las
  pantallas de email limpian el bearer del historial.
- Impacto previo: la persona no podía obtener una copia estructurada; una
  solución síncrona improvisada habría expuesto datos o bloqueado el proceso web.
- Corrección aplicada: solicitud con step-up y confirmación email, job
  asíncrono ligado a `security_version`, selección explícita sin hashes/secretos,
  JSON de hasta 25 MiB cifrado AES-GCM en volumen privado, descarga POST manual
  de un uso/no-store, caducidad de 24 h, cancelación y purga.
- Límite: falta separar formalmente art. 15 y art. 20 RGPD y definir la vía para
  volúmenes superiores o categorías que requieran revisión humana.

### BAF-087 — No existía ciclo seguro de eliminación y anonimización de cuenta

- Severidad: alta de privacidad e integridad multitenant.
- Estado: implementado manualmente; validación y aprobación legal pendientes.
- Evidencia: migración `000021`, endpoints de impacto/solicitud/confirmación/
  cancelación, UI de Ajustes y ejecución acotada en `UvhHousekeeping`.
- Impacto previo: no había ejercicio autocontenido de supresión ni protección
  frente a dejar workspaces sin propietario o borrar datos de otros miembros.
- Corrección aplicada: frase explícita, contraseña+MFA, doble confirmación, veto
  a administradores/propietarios, transferencia de propiedad separada, revocación
  inmediata, siete días de gracia, cancelación bearer y anonimización posterior.
- Límite: backups, logs, denuncias, bases jurídicas y retenciones finales siguen
  requiriendo procedimiento operativo y revisión jurídica.

### BAF-088 — Agotar el correo de recuperación podía dejar un ciclo irreversible

- Severidad: crítica de disponibilidad de cuenta, condicionada a caída sostenida
  del proveedor después de admitir el job.
- Estado: remediado para export y eliminación; las invitaciones tienen ahora
  compensación condicionada por generación, aunque el outbox general de BAF-081
  continúa pendiente.
- Evidencia: `SendUvhMailJob` recibe tipo/ID no sensible y su callback `failed`
  compensa sólo la generación concreta.
- Impacto previo del diseño inicial: la cuenta podía quedar cerrada y programada
  para anonimización aunque nunca se hubiese entregado el enlace de cancelación.
- Corrección aplicada: al agotar reintentos se restaura automáticamente la cuenta
  y se invalida la solicitud; para exports se marca fallo y se borra el artefacto
  privado si no se entrega confirmación o descarga.

### BAF-089 — El timeout del worker era menor que el nuevo trabajo de exportación

- Severidad: alta de consistencia y consumo de recursos.
- Estado: remediado en configuración; despliegue pendiente.
- Evidencia: `docker-compose.production.yml` usa worker de 180 s,
  `DB_QUEUE_RETRY_AFTER` pasa a 240 s y `ProductionSecurity` rechaza valores por
  debajo de 200 s; el job declara 120 s.
- Impacto previo al ajuste: el worker podía matar una exportación válida antes
  de su timeout propio y la cola volver a reservarla, generando duplicados u
  artefactos huérfanos.
- Corrección aplicada: jerarquía `job timeout < worker timeout < retry_after`,
  ruta de artefacto persistida antes de publicar, limpieza en retry/fallo y
  recuperación de procesamientos atascados por housekeeping.

### BAF-090 — Los bearers de correo podían llegar a access logs y cabeceras Referer

- Severidad: alta de confidencialidad, condicionada a observabilidad o recursos
  externos con acceso al URL completo.
- Estado: remediado manualmente; compatibilidad y E2E pendientes.
- Evidencia: verificación, reset, cambio de email, export y eliminación emitían
  `?token=`. Los nuevos enlaces usan `#token=`; Angular captura el fragmento,
  limpia la dirección y conserva lectura temporal de enlaces query antiguos.
- Corrección aplicada: el fragmento no se envía en la petición HTTP inicial y
  tiene precedencia sobre un parámetro legacy. Las invitaciones usan ahora un
  handoff local con TTL, `returnTo` corto y confirmación explícita; la lectura de
  query se conserva sólo para correos emitidos antes de la migración.

### BAF-091 — Una cuenta eliminada no podía revocar intenciones ya reclamadas

- Severidad: media de minimización y cierre de ciclo.
- Estado: remediado manualmente; migración y concurrencia pendientes.
- Evidencia: la caché sólo guardaba `claimed_by` dentro de una clave derivada del
  bearer, sin índice por usuario. La migración `000022` añade exclusivamente
  hash, usuario y caducidad; no almacena destino ni token recuperable.
- Corrección aplicada: claim idempotente con límite atómico de 100 por usuario,
  limpieza al completar/caducar y revocación de caché/cuotas al programar o
  ejecutar eliminación de cuenta.

### BAF-092 — Cancelar una exportación durante publicación podía dejar una ruta huérfana

- Severidad: media de consistencia operativa.
- Estado: remediado manualmente; carrera multiproceso pendiente de validación.
- Evidencia: el worker registraba `artifact_path` antes de publicar, pero si una
  cancelación cambiaba el estado entre las dos transacciones se borraba el
  archivo sin limpiar siempre la ruta persistida.
- Corrección aplicada: la rama que pierde elegibilidad borra el artefacto y
  limpia condicionalmente la misma ruta, sin sobrescribir una generación nueva.

### BAF-093 — Un conflicto tardío podía desactivar sólo parte de los webhooks

- Severidad: alta de integridad operativa.
- Estado: remediado manualmente; carrera multiproceso pendiente de validación.
- Evidencia: `deactivateOwnedBy` y `deactivateWorkspace` recorrían webhooks uno a
  uno; si un lock posterior estaba ocupado devolvían `false`, pero las
  desactivaciones anteriores podían confirmarse al salir normalmente de la
  transacción de expulsión, abandono o borrado.
- Impacto previo: la API respondía `409` y conservaba miembro/workspace, pero una
  parte de sus integraciones quedaba silenciosamente desactivada.
- Corrección aplicada: el lote completo se ejecuta en una transacción/savepoint
  ordenada por ID; una señal interna específica fuerza rollback del subconjunto
  antes de devolver el mismo `409` recuperable.

### BAF-094 — Abrir un correo podía confirmar acciones por efecto de un link scanner

- Severidad: alta para cambio de identidad y media para disponibilidad de export.
- Estado: remediado manualmente; prueba con proveedores reales pendiente.
- Evidencia: las pantallas de verificación inicial, confirmación de nuevo email
  y export ejecutaban el POST consumidor desde el constructor. Un escáner capaz
  de ejecutar la SPA podía activar la cuenta, completar el cambio o iniciar el
  job sin una acción humana.
- Corrección aplicada: todas capturan y limpian el fragmento, pero no consumen
  el bearer hasta pulsar un botón explícito. Eliminación, descarga e invitación
  siguen el mismo patrón. Falta validar el comportamiento con los proveedores
  reales de correo y protección de enlaces.

### BAF-095 — La autorización administrativa no caducaba durante la vida de la sesión

- Severidad: alta de autorización privilegiada.
- Estado: remediado manualmente; E2E y revisión multipestaña pendientes.
- Evidencia: `RequireMfa` sólo comprobaba que `mfa_verified_at` no fuese nulo.
  Una sesión de hasta 30 días conservaba administración después de un único MFA
  presentado al iniciar sesión.
- Corrección aplicada: `uvh.mfa:fresh` exige una antigüedad máxima configurable,
  devuelve una razón estructurada y la SPA fuerza contraseña más TOTP/recovery.
  La marca se actualiza sobre la sesión bloqueada, los recovery codes se consumen
  atómicamente y cada éxito o fallo queda auditado sin registrar credenciales.

### BAF-096 — El ejemplo de producción violaba el timeout seguro de su propia cola

- Severidad: alta de disponibilidad operativa.
- Estado: remediado manualmente; arranque con configuración real pendiente.
- Evidencia: `.env.production.example` declaraba `DB_QUEUE_RETRY_AFTER=90`, el
  worker usa `--timeout=180` y `ProductionSecurity` rechaza valores inferiores a
  200. Copiar el ejemplo impedía arrancar o permitía una reserva duplicada si se
  relajaba el gate.
- Corrección aplicada: el ejemplo usa 240 segundos, por encima del timeout del
  worker y coherente con `config/queue.php` y el gate de producción.

### BAF-097 — Una caída del store de replay MFA podía producir un 500 ambiguo

- Severidad: media de disponibilidad y manejo de errores.
- Estado: remediado manualmente; fallo real del store pendiente de simulación.
- Evidencia: `Cache::add` se invocaba directamente al reservar contadores TOTP y
  challenges consumidos. Una excepción del backend de caché escapaba como `500`
  durante login, reautenticación u operaciones sensibles.
- Corrección aplicada: una excepción específica aborta la transacción y se
  convierte globalmente en `503` sin revelar infraestructura ni confundir la
  caída con un código incorrecto. El mensaje confirma que no se aplicó el cambio.

### BAF-098 — Un fallo entre recovery code y challenge podía gastar el código sin iniciar sesión

- Severidad: alta de disponibilidad de cuenta.
- Estado: remediado manualmente; simulación de fallo intermedio pendiente.
- Evidencia: el login por recuperación confirmaba primero la eliminación del
  recovery code en PostgreSQL y después consumía el challenge de caché. Un fallo
  en ese segundo paso devolvía error con el código ya perdido.
- Corrección aplicada: validación, consumo del challenge y eliminación del código
  ocurren dentro de la misma transacción. La excepción de infraestructura fuerza
  rollback; un challenge ya usado devuelve `401` sin contabilizarlo como código
  erróneo. Lecturas, escrituras y borrados de challenges usan el mismo `503` seguro.

### BAF-099 — El frontend olvidaba la intención antes de confirmar su eliminación

- Severidad: media de continuidad y minimización.
- Estado: remediado manualmente; recarga/offline pendiente de E2E.
- Evidencia: `PendingLinkIntentService.complete()` borraba primero localStorage y
  lanzaba el POST sin esperar ni conservar el error. Un fallo dejaba el destino
  y la cuota vivos en servidor, pero sin token local para reintentar.
- Corrección aplicada: el token opaco pasa a estado local `completing`, deja de
  mostrarse como tarea activa y sólo se borra tras `200` o `404`. Otros errores
  conservan el token y se reintentan al volver a cargar el mismo navegador.

### BAF-100 — Contención o caída de caché podía parecer expiración y consumir cuota fantasma

- Severidad: media de disponibilidad.
- Estado: remediado manualmente; fallos distribuidos pendientes de simulación.
- Evidencia: no adquirir el lock de una intención devolvía `null`, igual que un
  bearer inexistente; además se incrementaban contadores antes de comprobar que
  el registro temporal se había escrito.
- Corrección aplicada: locks/store transitorios devuelven `503`; sólo un registro
  realmente inválido devuelve `404`. Una escritura fallida intenta compensar los
  contadores exactos bajo el mismo orden global→IP y éstos siguen teniendo TTL.

### BAF-101 — `afterCommit` podía confirmar estado sin admitir realmente el correo

- Severidad: alta de consistencia y recuperación de cuenta.
- Estado: remediado manualmente; migración/fault injection pendientes.
- Evidencia: el envío anterior devolvía `true` al registrar un callback; la
  inserción real del job ocurría después del commit y podía fallar cuando el
  estado crítico ya era durable.
- Corrección aplicada: migración `000023` y outbox cifrado en la misma transacción
  que el recurso. La cola transporta sólo el ID; un callback perdido deja una
  fila `pending`, el scheduler recupera `queued/processing` estancados y cinco
  intentos agotados ejecutan la compensación generacional existente.
- Límite: entrega al proveedor sigue siendo al menos una vez; una caída después
  de aceptación remota y antes de marcar `sent` puede producir un duplicado.

### BAF-102 — Los hashes de tokens API inservibles crecían sin purga

- Severidad: media de minimización y disponibilidad a largo plazo.
- Estado: remediado manualmente; retención jurídica y scheduler pendientes.
- Evidencia: la UI truncaba a 100, pero no existía eliminación de filas revocadas
  o caducadas.
- Corrección aplicada: housekeeping elimina en lotes sólo después de una ventana
  `API_TOKEN_PURGE_DAYS` validada entre 7 y 365 días en producción.

### BAF-103 — El aviso de contraseña cambiada no permitía contener una intrusión

- Severidad: alta de control de cuenta.
- Estado: remediado manualmente; correo/E2E y soporte posterior pendientes.
- Evidencia: el aviso sólo recomendaba recuperar la contraseña; quien hubiese
  tomado la cuenta podía conservar sesiones, tokens o programar su eliminación.
- Corrección aplicada: bearer aleatorio de 32 bytes, hash en base de datos, TTL
  de 24 horas, fragmento URL y confirmación humana explícita. Su consumo único
  revoca sesiones/API, resets, cambio de email, exports, intenciones y eliminación
  pendiente sin autenticar, modificar el email ni desactivar MFA. Se preserva
  frente a una eliminación solicitada, pero se invalida al bloquear la cuenta.

### BAF-104 — El listado de expedientes RGPD multiplicaba consultas por página

- Severidad: media de rendimiento y disponibilidad administrativa.
- Estado: remediado manualmente; volumen representativo pendiente de validación.
- Evidencia: `PrivacyRightsController::publicRequest()` consultaba y descifraba
  los mensajes por separado para cada expediente. Una página administrativa de
  50 elementos ejecutaba una consulta base, el recuento y hasta 50 consultas de
  mensajes adicionales.
- Corrección aplicada: los mensajes de todos los expedientes de la página se
  cargan en una sola consulta acotada y ordenada. El límite de 20 mensajes por
  expediente mantiene la hidratación en un máximo contractual de 1.000 filas.

### BAF-105 — Una acción RGPD administrativa invertía el orden global de locks

- Severidad: media de disponibilidad por riesgo de deadlock condicionado.
- Estado: remediado manualmente; concurrencia multiproceso pendiente.
- Evidencia: la acción administrativa bloqueaba usuarios, luego el expediente y
  finalmente la sesión MFA. Los flujos sensibles de cuenta siguen el orden
  usuario → sesión → recurso, por lo que una operación concurrente podía formar
  un ciclo de espera cuando compartiera esos registros.
- Corrección aplicada: la autoridad y frescura de la sesión se bloquean y
  revalidan antes de adquirir el expediente. El orden queda documentado junto al
  código para evitar regresiones al ampliar las acciones de privacidad.

### BAF-106 — La exportación personal omitía los expedientes RGPD del usuario

- Severidad: media de completitud funcional y privacidad.
- Estado: remediado manualmente; artefacto real pendiente de inspección.
- Evidencia: `GenerateDataExportJob::buildPayload()` incluía cuenta, recursos,
  analítica y auditoría, pero no las solicitudes ni mensajes de derechos que la
  propia persona había registrado desde Ajustes.
- Corrección aplicada: la exportación incorpora metadatos mínimos de cada
  expediente y su conversación descifrada, sin generaciones, actores internos
  ni ciphertext. Un cuerpo irrecuperable conserva cronología, se marca como no
  disponible y genera una métrica sin PII en lugar de abortar todo el archivo.

### BAF-107 — El orden administrativo podía ocultar solicitudes RGPD activas

- Severidad: alta operativa por riesgo de incumplimiento de plazo.
- Estado: remediado manualmente; datos representativos pendientes.
- Evidencia: la vista sin filtro priorizaba sólo expedientes ya vencidos y luego
  ordenaba todo por `due_at`; historiales terminales antiguos podían llenar las
  primeras páginas antes que solicitudes activas próximas a vencer.
- Corrección aplicada: todo estado activo precede al historial, los vencidos
  aparecen primero y el resto se ordena por su próxima fecha límite. Los casos
  terminales se muestran por recencia.

### BAF-108 — Las acciones RGPD no respetaban una transición mínima de estados

- Severidad: media de integridad de flujo y notificaciones.
- Estado: remediado manualmente; E2E administrativo pendiente.
- Evidencia: un administrador podía volver a “tomar” un expediente que esperaba
  respuesta del usuario o pedir información repetidamente mientras ya estaba en
  `waiting_user`, alterando su estado/generación y generando correos redundantes.
- Corrección aplicada: `start_review` sólo admite `submitted` y
  `request_information` sólo `submitted`/`in_progress`; el backend devuelve un
  `409` recuperable ante estado obsoleto y la interfaz oculta acciones inválidas.

### BAF-109 — El alta no probaba qué aviso de privacidad se mostró

- Severidad: media de trazabilidad legal.
- Estado: remediado manualmente; política de cambios materiales pendiente.
- Evidencia: el registro exigía una versión de Términos y auditaba su aceptación,
  pero la misma casilla decía aceptar también la Política de privacidad sin
  enviar ni conservar una versión independiente.
- Corrección aplicada: el contrato exige `privacyVersion`, el backend valida la
  versión publicada y audita el acuse del aviso por separado de la aceptación
  contractual. La interfaz aclara que la persona confirma haber leído la
  política, evitando presentarla como consentimiento general.

### BAF-110 — La evidencia legal del alta dependía de auditoría no bloqueante

- Severidad: alta de trazabilidad contractual condicionada a un fallo de DB.
- Estado: remediado en código; migración `000031` pendiente de aplicar/validar.
- Evidencia: `Audit::write()` absorbe deliberadamente sus errores para no
  convertir una operación ya confirmada en un falso `500`. Por tanto, una cuenta
  podía crearse aunque no se insertase el único evento que probaba la versión de
  Términos aceptada.
- Corrección aplicada: `legal_acceptances` conserva documento, versión, origen y
  fecha con unicidad e integridad referencial. Las dos evidencias se insertan en
  la misma transacción que cuenta y workspace; se minimizan datos al no guardar
  IP/user-agent y se incluyen en la exportación de la persona.

### BAF-111 — La consola local bloqueaba su hilo visual durante el arranque

- Severidad: media de operabilidad local.
- Estado: remediado en código; interacción gráfica y reinicio de Windows pendientes.
- Evidencia: `Iniciar todo`, detener, reiniciar y migrar ejecutaban Docker/npm de
  forma síncrona desde el evento WinForms. Una recreación observada de unos 30
  segundos dejaba la ventana sin procesar mensajes y parecía colgada.
- Corrección aplicada: cada operación se ejecuta ahora en un proceso hijo
  acotado, con exclusión de acciones concurrentes, latido visual, captura de
  salida y recuperación de la barra al terminar. El arranque rutinario ya no
  fuerza `--build`; `Start` y `Status` se validaron manualmente sin migraciones.

### BAF-112 — El diagnóstico local confundía un backend lento con uno caído

- Severidad: baja funcional, con impacto en diagnóstico.
- Estado: remediado en código; rendimiento del bind mount sigue siendo local.
- Evidencia: `/health` tardó entre 3,6 y 14,2 segundos durante el calentamiento
  de Laravel sobre Windows, mientras la consola abandonaba la petición a los
  tres segundos y mostraba `NO DISPONIBLE` pese a obtener después HTTP `200`.
- Corrección aplicada: el estado se consulta fuera del hilo visual con timeout
  local acotado y distingue `OK`, `LENTO`, error HTTP y ausencia. El servidor de
  desarrollo usa un pequeño pool de workers y OPcache CLI para que una carga en
  frío no monopolice todas las peticiones locales.

### BAF-113 — Docker Desktop no podía reiniciar por sockets IPC corruptos

- Severidad: alta de disponibilidad local.
- Estado: remediado en el host y en la consola; recurrencia tras otro cierre
  anómalo pendiente de observar.
- Evidencia: Docker Desktop 4.88.1 abortaba primero al retirar
  `Docker\run\sailor-ingest.sock` y, tras limpiar ese runtime, al retirar
  `docker-secrets-engine\engine.sock`, ambos con Win32 “acceso al archivo”. Los
  objetos eran reparse points AF_UNIX de 0 bytes; ni `Remove-Item` ni `fsutil`
  elevados podían operar sobre el endpoint individual.
- Corrección aplicada: con Docker/WSL detenidos se archivaron de forma atómica
  los directorios IPC completos y recuperables, sin tocar imágenes, volúmenes o
  PostgreSQL. `Iniciar todo` puede arrancar Docker Desktop y detectar el patrón
  de logs; la GUI ofrece una reparación UAC acotada que restaura los servicios
  previamente activos en un bloque `finally`.

### BAF-114 — El estado de migraciones local daba un falso total pendiente

- Severidad: media de operabilidad y seguridad de despliegue.
- Estado: remediado manualmente; migraciones pendientes no aplicadas.
- Evidencia: una sonda inicial a través de `sh -lc` devolvía salida vacía bajo
  Windows PowerShell y la consola mostraba “33 de 33 pendientes”. La consulta
  directa confirmó 17 identificadores ya registrados.
- Corrección aplicada: se eliminó la interpolación de shell. Usuario y base se
  validan y pasan como argumentos separados a `psql` por el socket interno, sin
  contraseña. El estado actual muestra correctamente 17 aplicadas y 16
  pendientes; no se ejecutó ninguna migración.

### BAF-115 — Varios bearers se confirmaban antes de admitir su correo en el outbox

- Severidad: alta de consistencia y recuperación de cuenta.
- Estado: remediado manualmente en código; fault injection y E2E pendientes.
- Evidencia: registro, corrección y reenvío de verificación, solicitud de reset,
  cambio de email e invitación/reenvío confirmaban primero el recurso o bearer y
  llamaban a `UvhMail` después del commit. Una caída entre ambos pasos podía dejar
  estado durable sin correo recuperable; las restauraciones posteriores eran de
  mejor esfuerzo y podían perder una generación válida bajo concurrencia.
- Corrección aplicada: cada flujo inserta ahora el recurso y el sobre cifrado del
  outbox dentro de la misma transacción. Un fallo de admisión lanza
  `MailAdmissionException` y revierte también reemplazos, consumo de recovery
  codes persistidos y cambios de identidad. Los bearers anteriores sólo se
  invalidan en el commit que admite el reemplazo; la publicación del job sigue
  siendo posterior al commit y recuperable por housekeeping.
- Límite: la revisión fue estática. No se ejecutaron suites, migraciones ni fault
  injection; la semántica `afterCommit`, los rollbacks y las carreras siguen sin
  evidencia runtime en `uvh_test`.

### BAF-116 — La antigüedad del outbox era visible pero no accionable externamente

- Severidad: media de operabilidad.
- Estado: remediado manualmente en código; alerta del monitor externo pendiente.
- Evidencia: la consola administrativa devolvía la edad del correo pendiente,
  pero no degradaba su estado por atasco, omitía compensaciones pendientes en el
  total visual y el endpoint Prometheus sólo exponía contadores por estado. Un
  monitor no podía alertar directamente por la edad de la cola de correo.
- Corrección aplicada: una espera superior a diez minutos degrada el chequeo
  administrativo, el total visual incluye `comp_pending`/`compensating` y las
  métricas privadas exponen `uvh_mail_outbox_oldest_pending_age_seconds` sin
  destinatario, asunto, recurso ni URL.
- Límite: UVH sólo expone la señal. La regla, el receptor y el canal de alerta
  deben configurarse y probarse en la plataforma de observabilidad real.

### BAF-117 — Las pruebas de email seguían ancladas al job anterior al outbox

- Severidad: media de fiabilidad de validación.
- Estado: corregido estáticamente; suite no ejecutada.
- Evidencia: `AuthEmailTokenTest` esperaba dos publicaciones de
  `SendUvhMailJob`, aunque el código productivo publica únicamente
  `DeliverMailOutboxJob` por ID. Además, varios `setUp` no vaciaban
  `mail_outbox` —tabla sin relación foránea con el recurso— ni las métricas,
  permitiendo que estado de una prueba contaminase otra.
- Corrección aplicada: las expectativas usan el job vigente y los fixtures que
  generan o consultan correo limpian explícitamente `mail_outbox`; las pruebas
  operativas limpian también `operational_metrics`.
- Límite: no se afirma que las pruebas pasen. PHP no está disponible en el host
  y Docker Desktop estaba detenido durante esta revisión.

### BAF-118 — DNS, TLS y webhooks sólo exponían volumen, no tiempo de atasco

- Severidad: media de operabilidad.
- Estado: remediado manualmente en código; alertas externas pendientes.
- Evidencia: Prometheus publicaba conteos de dominios y entregas webhook, pero no
  la edad de la entrega pendiente, verificación DNS o emisión TLS más antigua.
  Housekeeping sí recuperaba esos estados, de modo que el monitor no podía
  distinguir trabajo reciente de una recuperación que ya había vencido.
- Corrección aplicada: se añadieron los gauges privados
  `uvh_webhook_oldest_pending_age_seconds`,
  `uvh_dns_oldest_in_progress_age_seconds` y
  `uvh_tls_oldest_provisioning_age_seconds`. La consola administrativa expone
  las mismas edades y degrada sus chequeos a los diez minutos para webhook/DNS
  y a una hora para TLS, alineada con sus ventanas de recuperación.
- Límite: no se configuró ni probó ningún receptor o regla del monitor externo.

### BAF-119 — El listado de entregas devolvía el payload persistido sin necesitarlo

- Severidad: baja de minimización y defensa ante evolución del contrato.
- Estado: remediado manualmente en código; inspector dedicado pendiente.
- Evidencia: `WebhookController::deliveries` serializaba `payload` completo para
  viewers del workspace, aunque la interfaz sólo utiliza evento, identificador,
  estado, intentos, error y tiempos. Los eventos actuales son acotados, pero una
  ampliación futura del payload se habría reflejado automáticamente en esta API.
- Corrección aplicada: el listado devuelve sólo metadatos operativos y el modelo
  frontend ya no declara `payload`. Un futuro inspector deberá construir una
  proyección explícita por evento mediante allowlist antes de mostrar contenido.
- Límite: la revisión fue estática; no se ejecutaron pruebas de contrato.

### BAF-120 — La presión HTTP 429 y los incidentes recientes no eran visibles en la consola

- Severidad: media de operabilidad.
- Estado: remediado manualmente en código; reglas externas pendientes.
- Evidencia: `OperationalMetrics` ya registraba hCaptcha, `5xx`, lentitud,
  locks, auditoría y fallos de housekeeping, pero no contabilizaba respuestas
  429. Además, esos contadores sólo se exportaban por el endpoint Prometheus;
  la consola administrativa mostraba estados de colas sin el contexto de los
  incidentes de la última hora.
- Corrección aplicada: el middleware global registra cada 429 bajo la única
  clave `http.too_many_requests`, sin ruta, IP, sesión, cuenta ni token. El
  endpoint administrativo devuelve `events60m`, muestra `5xx`, 429, hCaptcha no
  disponible y fallos de auditoría/housekeeping, y exige atención cuando hay
  señales recientes de disponibilidad o durabilidad. Se añadieron contratos de
  prueba para los contadores, sin ejecutarlos en esta pasada.
- Límite: 429 agrega tanto throttles como límites de capacidad expresados con
  ese código; su finalidad es detectar presión, no atribuirla. Las alarmas,
  umbrales históricos, receptores y monitorización de backups siguen fuera de
  la aplicación y requieren configuración real.

### BAF-121 — La rotación de APP_SECRET estaba implementada pero no tenía ceremonia operativa

- Severidad: alta de disponibilidad y recuperación, condicionada a una rotación.
- Estado: implementación y runbook completados estáticamente; ensayo pendiente.
- Evidencia: el código ya disponía de keyring actual/anterior, deadline de 31
  días, compatibilidad de tokens firmados, overlay Compose y el comando
  reanudable `uvh:crypto:rotate`. El TODO seguía describiéndolo como diseño
  ausente y no existía un procedimiento que fijara orden, writers concurrentes,
  drenaje de jobs/tokens, criterios de retirada o rollback.
- Corrección aplicada: se documentó el inventario cifrado, preflight, despliegue
  simultáneo de procesos PHP, dry-run, recifrado, repetición a cero, drenaje,
  rollback bidireccional y evidencia de cierre. El `.env.example` local expone
  las variables vacías y comentadas, y se añadieron contratos para keyring,
  escritura con clave actual, retirada fail-closed, duplicados y deadlines.
- Límite: ninguna clave real fue creada ni rotada; no se ejecutó el comando ni
  las pruebas. Backup, gestor de secretos y ceremonia sobre copia continúan como
  gates obligatorios.

### BAF-122 — Un respaldo de correo podía registrar bearers y producir falsos éxitos

- Severidad: alta de confidencialidad y fiabilidad, condicionada a usar la
  configuración afectada y a un fallo del transporte primario.
- Estado: remediado en código; validación de ejecución y proveedor pendientes.
- Evidencia: `config/mail.php` declaraba `failover` con SMTP y `log`. El gate
  de producción, la consola y `UvhMail` comprobaban el nombre del mailer, no el
  transporte efectivo. Laravel `LogTransport` registra el MIME completo y
  devuelve una confirmación; un alias o respaldo `log` podía filtrar enlaces
  bearer y terminar el outbox como `sent` sin entrega. `MAIL_URL` también puede
  sustituir el transporte aunque el alias parezca SMTP.
- Corrección aplicada: `MailTransportPolicy` inspecciona las ramas efectivas,
  resuelve URL/alias y rechaza simuladores anidados, ciclos, referencias ausentes
  y transportes desconocidos. Arranque, envío y consola usan esa misma política;
  el gate valida además claves Resend por rama. Se retiró el respaldo `log` del
  ejemplo. Sólo un simulador independiente fuera de producción puede aceptar sin
  enviar, sin registrar el contenido del mensaje.
- Límite: validar la topología no acredita credenciales ni disponibilidad del
  proveedor. Los casos de regresión están escritos pero no se ejecutaron.

### BAF-123 — El outbox aceptaba un envío cancelado y descartaba su parte de texto

- Severidad: media de fiabilidad de avisos y compatibilidad del correo.
- Estado: remediado en código; pruebas de transporte y entrega real pendientes.
- Evidencia: `UvhMail::sendNow` invocaba `Mail::html` y devolvía `true` siempre que
  no hubiera excepción. Laravel puede devolver `null` si un listener cancela
  `MessageSending` o el transporte no confirma; el worker lo trataba como envío
  aceptado y vaciaba el sobre. Además, la parte de texto guardada en el outbox
  nunca se pasaba al mailer.
- Corrección aplicada: se construyen ambas partes HTML/texto y sólo una instancia
  de `SentMessage` confirma aceptación. Una respuesta nula conserva el camino de
  fallo/reintento y emite un aviso genérico sin PII ni contenido. El runbook
  distingue admisión, publicación, aceptación y recepción, y explica la posible
  duplicación tras una caída posterior a la aceptación.
- Límite: revisión de código propio y del Laravel instalado, sin ejecutar suites
  ni enviar correo. `sent` sigue sin probar entrega al buzón ni ausencia de rebote.

### BAF-124 — Las credenciales nuevas podían confirmarse sin aviso durable de incidente

- Severidad: alta de consistencia y recuperación de incidentes, condicionada a
  una caída o fallo de admisión entre las dos transacciones.
- Estado: remediado en código en cambio de contraseña, reset y finalización de
  recuperación reforzada; fault injection y ejecución pendientes.
- Evidencia: los tres flujos confirmaban primero contraseña, versión de seguridad
  y revocaciones. Después llamaban a `sendPasswordChangedNotice`, que abría otra
  transacción para el bearer `security_revoke` y su sobre. El helper protegía su
  atomicidad interna, pero una caída entre ambos commits dejaba credenciales
  cambiadas sin aviso recuperable; un fallo del helper tampoco impedía el `200`.
- Corrección aplicada: `admitPasswordChangedNotice` recibe al usuario ya bloqueado
  y exige una transacción activa. Bearer, sobre y limpieza se ejecutan dentro del
  commit de credenciales. La admisión rechazada lanza `MailAdmissionException`,
  revierte también sesiones, tokens, expediente y recovery code persistido, y
  responde `503` sin afirmar que la contraseña cambió o la recuperación terminó.
  El envío al proveedor sigue fuera de la transacción mediante `afterCommit`;
  proveedor/cola caídos no deshacen un cambio que ya dispone de outbox durable.
- Límite: un contador TOTP consumido en caché compartida no se revierte con SQL;
  se conserva la marca antirreplay y se necesita el siguiente código para repetir
  ese factor. No se elimina una marca válida para facilitar el reintento.
- Evidencia preparada, no ejecutada: `PasswordNoticeAtomicityTest` interrumpe
  después del INSERT del sobre, exige rollback y permite repetir los tres flujos;
  comprueba además rollback exterior y publicación diferida. No se ejecutaron
  suites, lint PHP, migraciones ni envíos reales.

### BAF-125 — La limpieza podía invalidar el enlace de incidente recién creado

- Severidad: media de disponibilidad del control de emergencia.
- Estado: remediado en código; regresión preparada, no ejecutada.
- Evidencia: tras admitir el nuevo aviso, el helper retenía cinco tokens mediante
  `created_at DESC, id DESC` y `offset(5)`, incluyendo al recién insertado en esa
  selección. Con fechas iguales y orden de hashes desfavorable, o relojes
  desfasados, podía borrarlo antes del commit; su outbox pasaría a `obsolete`.
- Corrección aplicada: la limpieza excluye explícitamente el ID nuevo y conserva
  otros cuatro enlaces recientes. La selección ya no depende de que el hash o
  timestamp nuevo gane el orden; mantiene la cota de cinco dentro del invariante
  existente y no hace obsoleto el aviso que acaba de admitir.
- Evidencia preparada, no ejecutada: fixture con cinco fechas anteriores que
  ordenan por delante de la nueva, sin depender de hashes aleatorios. Se exige
  que el nuevo outbox siga siendo elegible y que permanezcan cinco tokens.

### BAF-126 — Los avisos de MFA y cambio de email aún dependían de pasos posteriores al commit

- Severidad: alta de consistencia de avisos de seguridad, condicionada a una
  caída o fallo de admisión después de modificar los factores o la identidad.
- Estado: remediado estáticamente; pruebas y entrega real pendientes.
- Evidencia: `mfaEnable` (alta y sustitución), `mfaRegenerateRecoveryCodes` y
  `mfaDisable` guardaban sus avisos después de confirmar el factor/códigos y
  revocar sesiones. La solicitud de cambio de email admitía la confirmación al
  buzón nuevo dentro de la transacción, pero el aviso al antiguo fuera; la
  confirmación final emitía ambos avisos después del commit. Una caída podía
  perder un aviso obligatorio, y un fallo de admisión mantenía el éxito HTTP.
- Corrección aplicada: todos esos sobres se admiten con las mutaciones y el
  usuario bloqueado. Un `MailAdmissionException` revierte MFA, códigos, sesiones,
  expediente o cambio/reserva de email según el flujo, y devuelve `503`. En los
  flujos de dos buzones, el fallo del segundo revierte también el primer sobre
  y descarta su publicación `afterCommit`. No se contacta al proveedor bajo lock.
- Semántica preservada: los avisos describen hechos ya confirmados y no conceden
  capacidades; un cambio posterior de email/MFA no los convierte en obsoletos.
  La admisión es obligatoria, aunque el aviso no lleve un bearer. Los contadores
  TOTP consumidos fuera de SQL conservan su marca antirreplay tras rollback.
- Evidencia preparada, no ejecutada: `SecurityNoticeAtomicityTest` incluye ocho
  casos MFA (cuatro operaciones, éxito/fallo), y solicitud/confirmación de email
  interrumpidas tras el segundo INSERT con rollback y reintento. Revisa estado,
  recovery hashes, sesiones, expedientes, destinatarios y ausencia de publicación
  prematura. No se ejecutaron suites, lint PHP, migraciones ni correo real.

### BAF-127 — Tokens y operaciones de workspace podían confirmarse sin su aviso

- Severidad: alta de consistencia de avisos de seguridad, condicionada a caída
  o fallo de admisión después del commit.
- Estado: remediado estáticamente; pruebas y entrega real pendientes.
- Evidencia: emisión de tokens API, transferencia de propiedad y borrado de
  workspace llamaban al correo después de confirmar recurso/roles/borrado y
  auditar. Perder ese paso dejaba la operación sin aviso durable recuperable.
- Corrección aplicada: los sobres se admiten bajo los locks ya existentes y
  en la misma transacción. El fallo lanza `MailAdmissionException`, devuelve
  `503` y revierte recurso, roles, consumo de recovery code y desactivación de
  webhooks/borrados en cascada. La transferencia admite juntos los dos avisos.
  No se entrega `plainToken` si la emisión revierte ni se incluye ese secreto en
  el correo. El outbox no depende de la FK del workspace eliminado.
- Límite: los cambios SQL son reversibles en estas operaciones; no se añadió
  ninguna llamada al proveedor bajo lock. El contador TOTP externo sigue sin
  poder desconsumirse por un rollback de DB.
- Evidencia preparada, no ejecutada: tres casos de fallo tras INSERT y reintento
  en `WorkspaceNoticeAtomicityTest`, con roles, hashes, hijos en cascada y sobres.

### BAF-128 — Un borrado rechazado por webhook ocupado gastaba un recovery code

- Severidad: media de disponibilidad de credenciales de recuperación.
- Estado: remediado estáticamente; prueba preparada, no ejecutada.
- Evidencia: `WorkspaceController::destroy` persistía el juego reducido de
  recovery codes antes de `WebhookService::deactivateWorkspace`. Si éste devolvía
  `false`, el closure retornaba `busy` normalmente y confirmaba ese consumo,
  aunque la respuesta fuera `409` y el workspace permaneciese intacto.
- Corrección aplicada: persistir el consumo sólo después de superar la barrera
  de webhooks. El savepoint ya existente del servicio revierte desactivaciones
  anteriores si otro webhook está ocupado; no se modifica su protocolo de locks.
- Evidencia preparada, no ejecutada: dos webhooks, lock del segundo retenido,
  `409` sin gastar recovery code ni modificar el primero, y borrado posterior
  con el mismo código al liberar el lock. No es una prueba multiproceso ejecutada.

### BAF-129 — El aviso de cancelación de cuenta tenía una ventana posterior al commit

- Severidad: media de fiabilidad del aviso; cancelación protectora prioritaria.
- Estado: ventana normal cerrada en código; fallo de admisión sigue siendo una
  excepción explícita de mejor esfuerzo, con validación pendiente.
- Evidencia: cancelar una eliminación confirmaba primero la restauración de
  cuenta y luego admitía el aviso. Una caída en medio perdía el aviso. Convertirlo
  sin más en requisito de commit haría que una avería del correo dejase activa
  la eliminación irreversible, empeorando el comportamiento protector existente.
- Corrección aplicada: el aviso se intenta en un savepoint dentro de la
  cancelación. Si se admite, comparte su commit; si falla, se revierte sólo el
  savepoint y se conserva la cancelación. Así, un error SQL de admisión no deja
  abortada la transacción PostgreSQL exterior. El fallo se audita después del
  commit sin reactivar la eliminación ni crear un sobre parcialmente insertado.
- Límite deliberado: si no se pudo admitir, no hay outbox que reintentar y no se
  promete entrega posterior; la auditoría sigue siendo auxiliar/no bloqueante.
  Esta excepción no se extiende a emisión de credenciales ni acciones destructivas.
- Evidencia preparada, no ejecutada: éxito, excepción PHP tras INSERT y error
  PostgreSQL de división por cero; los tres deben conservar la cuenta y consumir
  el enlace de cancelación. Ningún caso, suite o migración fue ejecutado.

### BAF-130 — Recibir una transferencia omitía el límite de workspaces propios

- Severidad: media de integridad de cuotas y consumo de recursos.
- Estado: corregido estáticamente; validación y concurrencia real pendientes.
- Evidencia: `WorkspaceController::store` rechazaba con `429` a propietarios
  de 20 workspaces, pero `transferOwnership` cambiaba `owner_user_id` sin contar
  los del destinatario. Podía aumentar indefinidamente su total mediante este
  segundo flujo, sin vulnerar las comprobaciones de roles existentes.
- Corrección: comprobar la misma constante de 20 después de validar propiedad
  y pertenencia, pero antes del step-up. El usuario receptor ya está bloqueado:
  crear y recibir transferencias se serializan sobre esa misma fila. Se mantiene
  el orden de locks de usuarios por ID y no se añaden locks de otros workspaces.
  Un rechazo devuelve `429`, sin consumir TOTP/recovery ni modificar roles/avisos.
- Compatibilidad: sólo se cuentan filas de `workspaces.owner_user_id`, no
  pertenencias. El exceso histórico no se borra ni impide transferir hacia fuera;
  borrar libera una plaza. El alta inicial crea un solo workspace dentro de la
  transacción del usuario nuevo y no constituye otra vía de acumulación.
- Evidencia preparada, no ejecutada: seis casos de `WorkspaceOwnershipLimitTest`
  con fronteras 19/20/21 al crear y transferir, pertenencias ajenas, donante con
  exceso y reintento tras borrado usando el recovery code del intento rechazado.
  No son ensayos multiproceso; las carreras de crear/transferir y dos transferencias
  hacia una misma cuenta siguen en `WORKSPACE-VALID-001`.

### BAF-131 — La caducidad seguía bloqueando reinvitaciones pese al cierre de BAF-009

- Severidad: media de disponibilidad y consistencia del ciclo de invitación.
- Estado: corregido estáticamente; once casos preparados, no ejecutados.
- Evidencia actual: `invite` rechazaba cualquier `pending`, aunque hubiese
  vencido. No había transición automática de caducidad en housekeeping y el
  listado devolvía el estado almacenado. La reutilización de filas terminales y
  el índice parcial habían corregido otras ramas de BAF-009, no ésta. Reenviar
  una pendiente vencida era una alternativa, pero su fallo afirmaba erróneamente
  que el enlace anterior seguía siendo válido.
- Corrección: bajo el lock del workspace, retirar pendientes vencidas de ese
  email antes de la comprobación/reutilización. Caducidad, bearer nuevo y outbox
  comparten transacción; un fallo de admisión revierte los tres. El listado
  presenta caducidad efectiva sin escribir. Aceptar/rechazar usa `<= now()` para
  concordar con la elegibilidad de entrega, que exige `expires_at > now()`.
- Reenvío y panel: se permite renovar pendientes y expiradas, pero no estados
  aceptado/rechazado/cancelado. Se comprueba pertenencia u otra fila pendiente
  antes de revivir una expirada, evitando el conflicto del índice único. El
  panel mantiene Reenviar para expiradas y refresca estado/fecha tras el éxito;
  un fallo de refresco no se presenta como fallo del correo ya admitido.
- Límites: el listado no materializa la caducidad, no se añadió una purga ni se
  revocan pertenencias existentes. La compensación conserva su comprobación de
  generación. Las restricciones de rol e identidad siguen siendo obligatorias.
- Evidencia preparada: `InvitationExpiryTest` incluye seis renovaciones
  (reinvitar/reenvío pendiente/reenvío expirado, con éxito y fallo tras INSERT),
  dos decisiones en la frontera exacta, listado sin escritura y dos conflictos.
  Comprueba reintento, aceptación sólo del bearer nuevo y compensación antigua.
  No se ejecutaron PHPUnit, compilación frontend, navegador ni migraciones.

### BAF-132 — Las invitaciones de admin podían revivir al recuperar la propiedad

- Severidad: media de consistencia de revocación, condicionada al retorno de
  propiedad antes de caducar y sin intento intermedio que cancelase el enlace.
- Estado: corregido estáticamente; validación pendiente.
- Evidencia: transferencia cambiaba owner a admin sin cancelar sus invitaciones
  de admin. Aceptación/entrega comprobaban autoridad actual y las bloqueaban
  mientras no fuese owner, pero al devolverle propiedad el mismo bearer pendiente
  volvía a satisfacer la comprobación. Degradación, expulsión y salida ya tenían
  revocación persistente, por lo que el comportamiento no era uniforme.
- Corrección: cancelar sólo pendientes de rol admin del emisor anterior en ese
  workspace, dentro de la transferencia y sus avisos. Editor/visor siguen dentro
  de sus facultades; otros workspaces no se modifican. Un fallo del segundo
  sobre revierte también la cancelación. Se explicita el efecto en el diálogo.
- Evidencia preparada: dos casos de transferencia y retorno por endpoints reales,
  con/sin fallo del segundo sobre; aceptación rechazada del bearer antiguo y
  elegibilidad conservada para roles menores y otro workspace. No ejecutados.

### BAF-133 — Cancelar la eliminación podía reactivar invitaciones emitidas antes de suspenderse

- Severidad: media de consistencia de revocación de capacidades de una cuenta.
- Estado: corregido estáticamente; validación pendiente.
- Evidencia: `confirmDeletion` cancelaba las invitaciones dirigidas al email,
  pero no las del `invited_by`. La cuenta suspendida impedía aceptarlas/entregarlas,
  pero cancelación protectora o compensación de correo restauraba el emisor sin
  modificar esos bearers. El bloqueo administrativo ya anulaba ambas direcciones.
- Corrección: cancelar emitidas pendientes dentro de la suspensión, además de
  recibidas. Aceptación serializa sobre el emisor, por lo que la transición no
  depende de que alguien intente consumir el enlace mientras está bloqueado.
  Restaurar la cuenta no recupera esas invitaciones; se conserva la posibilidad
  de emitir otra explícitamente. No se toca la cancelación protectora ni sus avisos.
- Evidencia preparada: cancelación explícita, fallo después del UPDATE de
  revocación con rollback/reintento y restauración mediante llamada directa al
  compensador. Un caso adicional conserva el contrato de degradación/promoción.
  Los seis casos totales están en `InvitationAuthorityLifecycleTest`, sin ejecutar.
- Límite de ambos parches: actúan sobre transiciones nuevas. No se modificaron
  datos heredados ni se acredita saneamiento de suspensiones/transferencias
  anteriores; tampoco carreras multiproceso, proveedor o E2E del frontend.

### BAF-134 — Una nueva sesión o ceros en el ID renovaban el presupuesto de invitaciones

- Severidad: media de disponibilidad y reputación de correo.
- Estado: corregido estáticamente; nueve casos de presupuesto preparados, sin ejecutar.
- Evidencia: `uvh-invitation` limitaba 20 intentos/15 minutos usando hash de
  sesión y parámetro `id` crudo. Iniciar otra sesión generaba otra clave. Las
  rutas admiten dígitos con ceros iniciales, mientras el controlador recibe un
  entero: `/1` y `/01` actuaban sobre el mismo workspace con contadores distintos.
- Corrección: identidad estable del usuario autenticado y representación del ID
  sin ceros iniciales, compartidas por invitación y reenvío de cualquier ID de
  invitación. Se conserva el presupuesto 20/15 y respuesta con `Retry-After`.
- Límite: sigue siendo por cuenta/workspace, no un presupuesto global. El
  middleware de Laravel comprueba y aumenta el contador en pasos separados;
  no se afirma una cota exacta bajo ráfagas paralelas. Producción necesita store
  compartido. Cuentas coordinadas, destinatarios e IP requieren trabajo adicional.

### BAF-135 — No existía una cota transaccional de invitaciones activas

- Severidad: media de capacidad y consistencia del control de admisión.
- Estado: máximo inicial 100 implementado; validación y calibración operativa pendientes.
- Evidencia: `invite` evitaba duplicados por email pero no contaba pendientes;
  `resendInvitation` reactivaba expiradas sin capacidad máxima. El throttle sólo
  restringía frecuencia por clave, no el total mantenido por varios administradores.
- Corrección: contar `pending` con `expires_at > now()` bajo el lock existente
  del workspace; crear o renovar una vencida requiere una plaza. El reenvío vivo
  reutiliza su plaza y no se bloquea por exceso heredado. El fallo del outbox
  revierte la admisión, por lo que no deja una plaza ocupada. No hay nuevo esquema.
- Límites: 100 es una cota inicial, no evidencia de dimensionamiento ni límite
  del total histórico. No se borran filas, ni se limita por esta cota el volumen
  de reenvíos de una invitación viva. BAF-041 y retención siguen pendientes.
- Evidencia preparada: `InvitationBudgetTest` contiene un caso HTTP de 20
  intentos con rotación de sesión/ID y reenvío, dos fronteras de creación y
  cancelación, cinco reenvíos y rollback del último hueco: nueve casos en total.
  Requieren `*_test` y caché array de PHPUnit. No se ejecutaron; las carreras de
  administradores distintos y cache compartida quedan por validar.

### BAF-136 — El presupuesto de correo no se compartía por destinatario/IP ni volumen agregado

- Severidad: media de disponibilidad y reputación de envío.
- Estado: servicio, integración, migración 000032 y trece casos preparados;
  no aplicados/verificados en ejecución. BAF-041 sigue mitigado, no cerrado.
- Evidencia: el throttle por cuenta/workspace y la cota activa no restringían
  reenvíos coordinados a una dirección ni volumen agregado entre workspaces.
  Un presupuesto fuera de la transacción también podía gastar cuota por una
  operación que después revirtiera.
- Corrección: `InvitationMailBudget::reserve` después de autoridad/conflictos y
  capacidad, antes de cambiar bearer. En reenvío usa email de la fila bloqueada.
  Contadores HMAC sin email/IP en claro y ventanas con reloj PostgreSQL. Sembrado
  y lock ordenados por clave; agotamiento lanza excepción para rollback exterior,
  incluyendo filas cero recién creadas. Error SQL/configuración devuelve `503`
  después de rollback; agotamiento `429` con espera sin dimensión/identidad.
- Admisiones: 100/cuenta, 200/workspace, 5/destinatario, 200/IP y 2000/global por
  ventana de 24 horas, más una por destinatario/60 segundos. Valores iniciales,
  no capacidad acreditada. Se cuenta el sobre confirmado, no reintentos del worker.
  No se reembolsa por fallo posterior, cancelación o caducidad.
- Keyring: se reservan todas las generaciones para evitar cuota nueva durante
  rotación. Retener antiguas 24 horas tras retirar el último escritor antiguo;
  el runbook de rotación fue actualizado. Housekeeping limpia contadores que
  llevan 24 horas vencidos, en lotes con `SKIP LOCKED`; sin purga de invitaciones.
- Operación: dos métricas de cardinalidad fija, alertas externas pendientes.
  Falta coordinar política/versiones, instalar esquema y probar concurrencia.
  La tabla vacía no reconstruye correo histórico. El contador global serializa
  admisiones; evaluar latencia/capacidad y posible agotamiento deliberado.
- Evidencia preparada: `InvitationMailBudgetTest` cubre seis dimensiones,
  reenvío con email falso y emisor distinto, fallo SQL tras INSERT, fallo outbox,
  autoridad, configuración inválida, rotación y limpieza. `TestCase` limpia contadores después del guard
  `*_test`; se añadió contrato de esquema. Ninguna prueba/migración fue ejecutada.

### BAF-137 — Conectividad y heartbeats podían ocultar un esquema pendiente

- Severidad: media de disponibilidad y despliegue incoherente.
- Estado: gate implementado estáticamente; siete casos preparados, sin ejecutar.
- Evidencia: el entrypoint sólo generaba caché de configuración; los healthchecks
  validaban conexión/caché y heartbeats, no migraciones. Una imagen dependiente de
  000032 podía arrancar y marcarse sana sin la tabla necesaria para invitar.
- Corrección: `ReleaseReadiness` enumera migraciones empaquetadas sin ejecutarlas,
  contrasta el ledger y verifica las tres columnas de presupuesto. Comparte la
  validación pura de límites con `InvitationMailBudget`. Errores de inspección
  cierran readiness con mensajes sin SQL ni detalles de conexión.
- Integración: `uvh:release-check` retorna fallo; el entrypoint de producción lo
  exige antes de PHP-FPM y comandos directos queue/scheduler. Excluye `migrate`
  y herramientas para permitir preparar una base vacía explícitamente. Los
  healthchecks de contenedor repiten el gate incluso con heartbeats recientes.
- Límites: no migra, no repara datos, no verifica todos los tipos/índices/constraints
  ni prueba compatibilidad de rollback. No se modificó el endpoint `/health`.
  Wrappers de arranque personalizados deben invocarlo; comprobarlo en la imagen
  real sigue pendiente. Un contenedor unhealthy no implica retirada automática
  del tráfico: depende del despliegue/supervisor.
- Evidencia preparada: `UvhReleaseCheckTest` cubre esquema completo sin reservar
  cuota, ledger pendiente, registro/tabla/columna ausentes, configuración inválida
  y excepción de inspección. Fixtures DDL con rollback tras el guard `*_test`;
  no se ejecutaron tests, lint, arranques ni migraciones.

### BAF-138 — El cliente descartaba la espera del servidor al reenviar invitaciones

- Severidad: baja de usabilidad y peticiones repetidas innecesarias.
- Estado: implementación validada; los diecisiete casos pasaron dentro de la
  suite frontend completa.
- Evidencia: `ApiService.errorOf` y errores JSON de `postBlob` sólo conservaban
  mensaje/status/details. Equipo mostraba un snackbar genérico, sin espera ni
  guard adicional para volver a pulsar o usar Enter.
- Corrección: campo opcional `retryAfterSeconds` compatible con llamadas existentes,
  parser sin plazo inventado para valores ausentes/inválidos y conservación en
  promesas, observables y errores blob. Servicio acotado a la vida de Equipo con
  deadline por workspace/email canónico, compartido crear/reenviar. Un `429` usa
  identidad de la petición original, no del formulario editado después.
- Interfaz: cuenta atrás legible y vinculada con `aria-describedby`, sin anunciar
  cada segundo; guards de botón/Enter, cancelación independiente y ningún envío
  programado. Un temporizador corto se limpia al vencer las esperas o destruir
  el componente; respuesta tardía no vuelve a iniciarlo tras destrucción.
- Límites: no persiste emails ni tiempos, no coordina pestañas y no revela/infiere
  la dimensión agotada. Otras operaciones pueden recibir un nuevo `429` del
  servidor; vencer la espera no garantiza admisión. Un `503` genérico no crea
  este cooldown. No prueba accesibilidad, renderizado ni navegación concurrente.
- Evidencia: cuatro casos de parser, cuatro de API, seis del servicio y tres de
  handlers de Equipo pasaron; typecheck y build también. E2E real sigue pendiente.

### BAF-139 — El panel daba éxito a una parada fallida y continuaba el reinicio

- Estado: corregido y validado con dependencias simuladas.
- Evidencia: `Stop-UvhLocal` invocaba Compose con `-AllowFailure`; un código
  distinto de cero se convertía en texto, la CLI devolvía éxito y `Restart`
  continuaba hacia `Start-UvhLocal` pese a la parada parcial.
- Corrección: propagar la excepción del helper de Compose y conservar el
  diagnóstico. El flujo de reinicio se interrumpe antes del arranque.
- Regresión: `tools/tests/control-stop.tests.ps1` carga mediante AST las
  funciones y el despacho reales, simula las dependencias externas y comprueba
  parada fallida, reinicio abortado, parada correcta y reinicio correcto.
  No ejecuta Docker, terminación de procesos ni migraciones.

### BAF-140 — Completar una intención confundía consumo y limpieza auxiliar

- Severidad: media de continuidad y disponibilidad.
- Estado: corregido; cuatro casos relacionados pasan con 65 aserciones en
  `uvh_test`.
- Evidencia: `complete` no comprobaba el resultado de `Cache::forget`; podía
  responder éxito dejando el bearer reutilizable. En sentido inverso, si el
  token ya se había borrado pero fallaba después el lock o la escritura de sus
  contadores, devolvía `503` aunque el consumo fuese irreversible.
- Corrección: el borrado autoritativo debe confirmar éxito. Después, la limpieza
  de contadores mantiene el orden global→IP, valida ambas escrituras, registra
  indisponibilidad y converge por TTL sin cambiar la respuesta ya confirmada.
- Regresión: se simulan por separado rechazo del borrado y contención durante la
  limpieza; se comprueban reintento seguro y ausencia del token consumido.

### BAF-141 — Una revocación fallida perdía su índice de reintento

- Severidad: media de cierre de sesión y minimización.
- Estado: corregido; un caso dedicado pasa con 7 aserciones en `uvh_test`.
- Evidencia: `LinkIntentRegistry::revokeForUser` ignoraba un `false` de
  `Cache::forget`, incrementaba `revoked` y eliminaba la fila inversa aunque el
  registro con destino continuase en caché.
- Corrección: conservar la fila inversa, contabilizarla como ocupada y continuar
  con las demás intenciones. Cada entrada aísla fallos del store y el release del
  lock tiene una métrica genérica; una ejecución posterior completa la revocación.

### BAF-142 — Housekeeping podía encolar indefinidamente el mismo webhook

- Severidad: media de disponibilidad de cola.
- Estado: corregido; dos regresiones y cinco casos SSRF/webhook pasan con 73
  aserciones en `uvh_test`.
- Evidencia: una entrega `pending` seguía con `next_attempt_at` vencido después
  de publicar su job. Con el worker detenido, cada pasada de housekeeping volvía
  a publicar la misma fila y hacía crecer `jobs`, aunque los locks evitasen la
  entrega externa simultánea.
- Corrección: reclamar la publicación mediante `locked_at` durante diez minutos.
  Una segunda pasada no publica de nuevo; un job perdido recupera elegibilidad
  al vencer el lease. Si el dispatcher falla de inmediato, se libera el claim y
  se programa un reintento al minuto sin alterar una decisión escrita por un
  worker síncrono.
- Contrato: `next_attempt_at` conserva su significado público. Las pruebas
  comprueban deduplicación, recuperación tras caducidad y publicación fallida.

### BAF-143–180 — Respuestas tardías, Storage y descargas debilitaban el aislamiento del panel

- Severidad: combinación de media de confidencialidad/estado y baja de robustez.
- Estado: corregido; 125 casos frontend, typecheck y build correctos.
- Alcance: 38 modos reproducibles en carga/cambio/destrucción de ocho vistas,
  sondeos DNS/TLS, secretos webhook/token, intenciones e invitaciones persistidas,
  QR, descargas, compatibilidad de tema e identificadores de workspace.
- Corrección estructural: `LatestRequest` exige revisión, contexto y vista viva;
  `browser-download` conserva y limpia Object URLs de forma segura. Los bearers
  persistidos validan estructura/TTL y toleran fallos parciales sin reaparecer.
- Inventario y límites: `docs/frontend-stability-batch-2026-09-05.md`.
