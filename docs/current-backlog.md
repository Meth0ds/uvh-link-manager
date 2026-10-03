# UVH — Backlog vigente

Última revisión: 3 de octubre de 2026.

Este archivo es el backlog **vigente** del producto. Sustituye a
[`todos.md`](archive/todos.md), archivado como registro histórico (su contenido
ya no se actualiza; se conserva por trazabilidad de decisiones y mediciones).

Una casilla marcada sólo acredita implementación revisada. No acredita E2E,
despliegue, conformidad jurídica ni preparación para producción. Los bloqueos
externos (CI con cuenta de GitHub bloqueada por facturación, DNS/TLS reales,
revisión jurídica) se listan aparte porque no dependen del código.

## Plan de revisión por sistemas —01/10

[Plan maestro](superpowers/plans/2026-10-01-system-by-system-review.md) y [matriz por función](superpowers/plans/2026-10-01-system-review-coverage.md):13 sistemas,185 rutas reales de partida. Comenzar S01 identidad/acceso/recuperación; añadir Jobs/comandos/helpers/frontend a la matriz y demostrar cada función antes de cerrar el sistema. Las suites previas no acreditan revisión completa.

## Continuación de revisión de código —01/10

- [x] Solicitud/confirmación de borrado con actor vigente y auditoría exacta transaccional.
- [x] Cancelación protectora con marcador durable y recuperación en housekeeping; migración requerida2026_10_01.
- [x] Reintento de confirmación/cancelación ante conexión fallida,429 y5xx; enlaces inválidos definitivos.
- [x] Cambio de contraseña y solicitud/cancelación de email revalidan autorización vigente; eventos exactos de contraseña/reset/email comparten transacción.
- [x] Confirmación de email permite reintento de errores temporales sin publicar un cierre de sesión fallido.
- [x] S01, alcance política:medidores conectados al runtime generado, rechazos/límite Unicode coherentes y comparación real de drift en Docker.
- [x] S01, rama login sin MFA:revalidación de credencial bajo bloqueo, perfil actual y admisión de sesión/evento transaccional.
- [ ] Completar S01 por función:registro/login/MFA/recovery, tokens, sesiones, perfil, errores y avisos; compensación automática corresponde a S02.
- Evidencia actual: 1128 backend/8235 aserciones; 651 frontend reejecutadas en el lote de recuperación; calidad y compilación correctas; [informe y límites](project-completion-audit-2026-09-30.md). Objetivo amplio aún abierto.

## P0 — Invariantes y exportación de datos

- [x] **Exportación autoservicio con step-up** (PR #26): solicitud con
  step-up, generación encolada, descarga con sesión + step-up reintentable,
  consumo único, TTL 48 h, motivos de fallo (`automated_size_limit |
  generation_error | stalled`), correo «listo» como anuncio y polling con pausa.
  Los apartados §2.1/§5/§retry de la revisión quedan cerrados por este diseño;
  §2.2/§2.3 (reenviar confirmación/enlace) son obsoletos: ya no hay confirmación
  por email ni bearer en la descarga.
- [x] **F1 — Invariantes de seguridad** (primer lote; verificado con
  `composer quality`, PHPUnit 587 y Karma 448):
  - [x] `decoy()` firma siempre `0/0`, imposible como id real.
  - [x] Telemetría de formato legacy sólo tras validación semántica
    (expiración/parseo), no al abrir el sobre.
  - [x] `down()` de `pending_registrations` irreversible y explícito.
  - [x] Administración: «Registros pendientes» sobre `pending_registrations`
    (email, creado, último correo, caducidad) sin oracle de existencia.
  - [x] `resend-verification` con coste igualado entre cuenta conocida y
    desconocida (suelo de duración anti-oráculo, no operable a la baja).
  - [x] `openLegacy()` acumula todo el keyring sin salida temprana.
- [x] **F2 — Exportación de datos, segunda fase**:
  - [x] Historial de exportaciones (10 últimas) con estado y re-descarga
    (`GET /data-export/history`; el panel lista las últimas diez).
  - [x] Etapas de progreso visibles (`collecting|analytics|encoding|
    encrypting|finalizing`), con `stage` en la API sólo mientras se genera.
  - [x] Generación por bloques/streaming para cuentas grandes; retirar el
    límite de 10 000 filas/12 MiB con «contacta soporte» (techo operativo de
    256 MiB de texto claro, que traduce a `automated_size_limit`).
  - [x] Separación contractual «Descarga de cuenta» (art. 15) vs «Derecho
    RGPD» (art. 20) en el producto y la API.
  - [x] `docs/data-export-matrix.md`: matriz autoritativa de contenidos.

## P1 — Superficie de producto

- [x] **F3 — Centro de notificaciones**: tabla `notifications` (user_id,
  workspace_id, kind, dedupe_key, route, created_at, read_at, digested_at) y
  `notification_preferences`, allowlist de kinds (avisos obligatorios de seguridad
  o solicitud propia y avisos operativos, espejada en el frontend), campana 🔔 en
  topbar, `/app/notifications`, y preferencias por canal (obligatorias vs
  operativas: Inmediato / Resumen diario / Solo UVH / Desactivado).
  - [x] Productores de seguridad cableados junto al aviso de correo (password,
    MFA ×4, email ×2, exportación, eliminación ×2, privacidad ×2) y operativos
    con compuerta de preferencia (token API, transferencia y borrado de
    workspace, recuperación rechazada); `dedupe_key` para eventos repetibles.
  - [x] Resumen diario `uvh:notifications-digest` (08:00, sin solape): un
    correo por cuenta con lo pendiente `daily_digest`, sellado al admitirse;
    cambiar de preferencia retira lo pendiente del kind.
  - [x] Cambios de preferencia auditados (`account.notification_preferences_updated`);
    los obligatorios no aceptan cambios ni siquiera con filas plantadas.
  - [ ] Ampliación de kinds operativos (PRODUCT-004): webhooks agotados,
    dominios/DNS/TLS, enlaces próximos a expirar o agotar clics, tokens API
    próximos a caducar e invitaciones, con sus productores en housekeeping e
    inspección.
- [x] **F4 — Operaciones asíncronas coherentes**: componente común
  `AsyncOperationStatus`, errores convertidos en acciones (429 con
  `Retry-After` y cuenta atrás visible), patrones compartidos de
  polling/pausa (`RetryCountdown`, `AsyncPoller`)
- [x] **F5 — Sesiones**: `POST /auth/sessions/revoke-others` (+ cerrar todas
  las sesiones) y crear `security-center.component.spec.ts`. Los cierres
  masivos admiten en su transacción un aviso de seguridad por email con el
  portador de incidente del cambio de contraseña
  (`SessionsRevocationNoticeTest`).
- [x] **F6 — Pulido transversal**: buscador remoto de miembros en la
  transferencia de propiedad (`GET /workspaces/:id/members`, la búsqueda cubre
  todo el workspace y el propietario nunca es candidato), onboarding fuera de
  `localStorage` (`memberships.onboarding_dismissed_at`, PATCH de presentación
  que sigue a la cuenta), rango personalizado en analítica (`period=custom` con
  `from`/`to`, `to` sin hora cubre el día completo), auto-TLS al confirmar
  ownership+routing en comprobaciones pedidas por una persona (el barrido
  periódico nunca inicia ACME) y rutas de sección
  `/app/settings/{profile,security,notifications,privacy}` que activan su
  sección, con las rutas del catálogo de notificaciones apuntando al punto
  exacto.

## P2 — Escala y operación del código

- [x] **F7 — Gestión a escala**: acciones masivas con idempotency key
  (`POST /links/bulk`, clave obligatoria, respuesta sellada en la misma
  transacción que el efecto y `Idempotent-Replay` en repeticiones; todo o
  nada sobre la selección), import/export CSV (`GET /links/export.csv` con
  guard anti-fórmulas y tope explícito; `POST /links/import` con `dryRun`,
  errores por fila y la misma política de clave), gestor de tags (renombrar y
  fusionar sin duplicar adhesiones), colecciones de un nivel (borrar
  desagrupa, nunca borra enlaces), plantillas de enlace (payload validado con
  el contrato de creación y sin alias) y export de analítica CSV/JSON
  (`GET /analytics/export`, sólo agregados, sin visitor hashes). UI:
  selección masiva con barra de acciones en la biblioteca, diálogos de
  etiquetas/colecciones/importación, colección y plantillas en el diálogo de
  enlace y export en analítica; la clave de idempotencia se reutiliza sólo en
  reintentos sin respuesta.
- [x] **Hotfix 2026-09-26 — cierre de la auditoría externa (P1–P2)**,
  verificado con suite backend completa (687 pruebas/5.590 aserciones sobre
  `uvh_test`), `composer quality` (pint + phpstan) y frontend (lint,
  typecheck, 527 pruebas):
  - [x] Escrituras de exportación verificadas y fail-closed (`Streams::
    writeAll`/`flush` en artefacto y documento) y etapas de generación
    persistidas por conexión lateral reutilizable (`export-stage`), que ya no
    se congela en `collecting`.
  - [x] Resumen diario de notificaciones como claim transaccional: lock de
    filas, revalidación de preferencias, outbox y sellado en la misma
    transacción, con generación determinista y sin duplicados tras un crash.
  - [x] Idempotencia con arriendo de ejecución (`lease_until`/`lease_token`),
    scope por workspace (fin del replay cross-tenant) y takeover condicionado.
  - [x] CSV round-trip portable: parseo RFC 4180 real, columnas de sólo
    lectura del export aceptadas e ignoradas, `domain` resuelto por hostname
    en el workspace destino, anti-fórmulas reversible, fin del N+1 de dominios
    e importación reanudable (`link_import_batches`/`link_import_rows`).
  - [x] Rotación de `APP_SECRET` por bloques en streaming (`reencryptStream`):
    memoria viva de un bloque, formato conservado y segunda pasada que no
    reescribe lo ya recifrado.
  - [x] Confirmación de descarga de exportación ligada a la sesión que la
    realizó (`download_served_session_id`, `409` desde otra sesión).
  - [x] Frontend: diálogos de importación/tags/colecciones/ligadura anclados
    al workspace en el momento de abrirse (cierre ante A→B, guards síncronos
    antes de enviar) y exportación con refresco al recuperar foco y cierre por
    timer hasta `downloadExpiresAt`.
  - [x] Gestión: `untag` exacto (sólo cuenta y sube versión lo que cambió),
    carreras de nombre `23505` → `409` en rename/store de tags, colecciones y
    plantillas, uso de tags con una consulta agrupada (fin del N+1), fusión de
    tags con candados en orden determinista y revalidación bajo lock, y
    borrado de colección que limpia su referencia en plantillas en la misma
    transacción.
  - [x] P3 y deuda previa **diferidos por decisión**: aviso en la revocación
    individual de sesión, step-up de `revokeOtherSessions` y bridge legacy
    `/auth/download-export#token=`.
- [x] **Incremento 2026-09-27 — concurrencia, idempotencia e integridad de
  artefactos** (lista de la segunda revisión externa), verificado con suite
  backend completa (726 pruebas sobre `uvh_test`), `composer quality` (pint +
  phpstan) y frontend (typecheck, lint, 541 pruebas):
  - [x] Workspace correcto en frontend: `WORKSPACE_SCOPED` cubre
    `tags`/`collections`/`link-templates`/`analytics/export` y `usesSession()`
    deriva de la misma clasificación (fin del workspace por defecto al operar
    en otro).
  - [x] Mutadores F7 bajo `WorkspaceMutation::run()`: lock de membresía
    (`getMembershipLocked`) dentro de la transacción —nada se escribe tras una
    expulsión/degradación concurrente— y `linkChanged()` que sube
    `links.version`, toca `updated_at` y emite `link.updated` (rename/merge de
    tags y desagrupado por borrado de colección incluidos: una edición obsoleta
    ya no resucita tags ni deja desagrupados sin notificar).
  - [x] Lecturas fail-closed de artefactos (`Streams::readChunk`/`readLine`):
    un `fread`/`fgets` fallido ya no es EOF —nunca más parciales servidos como
    completos— y la rotación aborta sin publicar el temporal.
  - [x] Artefacto `uvh-private-artifact-v3` con pie sellado
    (`{chunks, plaintextBytes, sha256}` cifrado y autenticado): lo truncado en
    un límite de bloque deja de ser indistinguible de lo íntegro; el último
    bloque se entrega sólo tras verificar el pie, `Content-Length` va sellado
    en la descarga y `v2`/legado siguen abriéndose en la ventana de
    convivencia.
  - [x] Idempotencia con relevo verificado: `commit()` exige sellar la fila o
    lanza `IdempotencyLeaseLost` (revierte la transacción de negocio),
    `renew()` como heartbeat dentro de la transacción y CSV releyendo el
    registro persistido por fila tras cada fallo (el informe sellado nunca
    contradice el ledger).
  - [x] CSV: preflight real en dry-run (alias duplicados en archivo y
    ocupados, cuota, dominios no preparados), columna `tags_json` (lista JSON
    reversible con `;` en nombres; incompatible con `tags` legacy), y ventana
    de lote de 24 h renovable junto con la reserva (`expires_at`).
  - [x] Auth: el fallo de admisión de correo en el reenvío de verificación ya
    no accede a `null` en la rama legacy (audit genérico + rollback) y cierra
    el oráculo 500/200.
  - [x] Bulk move bloquea la colección destino dentro de la transacción (fin
    del `23503` → `500` frente a un borrado concurrente).
- [x] **F8 — Analítica medida y caché** (01/10/2026): dos rondas locales de contención dentro de async 128/128; conservar lock link/día por corrección y documentar variabilidad. Caché configurable 0–60 s (30 por defecto) por workspace/enlace/rango y snapshot coherente. Capacidad en hardware real sigue en F11.
- [x] **F9 — Entitlements y límites** (01/10/2026): modalidad standard sin pagos, cuotas configurables compartidas, admisión transaccional de miembros y prueba reciente de purga ligada a la política vigente.
- [ ] **F10 — Observabilidad**: correlation ID edge→jobs→outbox/logs, buckets separados de preparación/streaming, SLOs iniciales y reglas Prometheus implementados (01/10/2026). Falta conectar el canal real, demostrar alerta recibida al detener queue-mail y configurar monitor externo de `/status`.
- [x] **Corrección de auditoría 30/09–01/10**: B01–B19 y ocho hallazgos adicionales corregidos; avisos operativos, revocación individual y outbox de auditoría críticos implementados. Alcance y límites en [el informe](project-completion-audit-2026-09-30.md) y [el runbook](remediation-operations-2026-09-30.md).

## Bloqueos externos (no código)

- [ ] **F11 — Operación real** (requiere infraestructura/cuentas):
  - [ ] CI remoto de GitHub Actions (§42): el bloqueo por
    facturación consta en la evidencia histórica; su estado actual no se ha vuelto a comprobar. Las puertas locales no acreditan el resultado remoto.
  - [ ] Backups con cron y restauración periódica medida (RPO/RTO).
  - [ ] Migraciones con volumen real sobre copia representativa.
  - [ ] Cosign/provenance y promoción de artefactos por digest (ver
    [`image-provenance-runbook.md`](image-provenance-runbook.md)).
  - [ ] DNS/TLS y webhooks con fallos reales (ver
    [`redirect-and-webhook-availability-policy.md`](redirect-and-webhook-availability-policy.md)).
  - [ ] Accesibilidad manual con NVDA/JAWS/VoiceOver.
  - [ ] Revisión jurídica ES/UE: bases jurídicas, encargados, retenciones,
    textos legales definitivos.

## Después (F12, sólo cuando P0–P2 estén cerrados)

- [ ] Service credentials (credenciales de servicio/máquina).
- [ ] OpenAPI y portal de desarrollo.
- [ ] Passkeys.
- [ ] SSO/SCIM.

## Índice de documentación operativa relacionada

- [`api.md`](api.md) — contratos de la API.
- [`e2e-testing.md`](e2e-testing.md) — alcance y límites del E2E.
- [`production-readiness.md`](production-readiness.md) — preparación de
  producción.
- [`data-export-matrix.md`](data-export-matrix.md) — matriz de contenidos de
  exportación.
- [`incident-runbook.md`](incident-runbook.md), [`mail-outbox-runbook.md`](mail-outbox-runbook.md),
  [`backup-and-restore.md`](backup-and-restore.md) — operación.

## Revisión sistemática S01 — última evidencia

Admisión MFA: B56/B57 corregidos,978 backend/7389aserciones y Pint403/PHPStan0. El plan y la matriz por función conservan S01 abierto;challenge inicial, registro/activación/reenvío y errores de cache específicos pendientes. No confundir estos resultados locales con cierre de todos los sistemas ni con preparación productiva.

Activación S01: B58/B59 corregidos,991backend/7489aserciones,Pint404/PHPStan0. Matriz mantiene revisión parcial:registro/edición/reenvío y demás funciones del sistema siguen pendientes.

Registro/edición S01:B60/B61 corregidos,1005backend/7587aserciones,Pint405/PHPStan0. Pendiente siguiente:comprobar entrega del reenvío legacy hasta DeliverMailOutboxJob;el test histórico sólo acreditaba encolado. S01 y demás sistemas del plan siguen abiertos.

S01:B62 entrega verify legacy y B63/B64 admisión de reto MFA corregidos. Última evidencia1033backend/7748aserciones,Pint407/PHPStan0. Próximas revisiones:reautenticación/expiry/eventos,perfil,sesiones y controles restantes de autenticación según matriz. Ninguna cifra de suite cierra automáticamente el sistema ni el objetivo completo.

Reautenticación/perfil S01:B65/B66/B67 corregidos,1051backend/7854aserciones,Pint408/PHPStan0. Matriz sigue parcial;lectores/sesiones/volumen,current/logoutprotector y controles restantes de S01 aún pendientes.


Lectores/sesiones S01: B68–B72 corregidos; 45 regresiones nuevas y 99 pruebas específicas/850 aserciones. Frontend reejecutado: 642 pruebas, lint/tipos/build correctos. Logout protector mantiene revocación aunque falle admisión de auditoría; historial fallido conserva outbox recuperable. Suite completa cerrada: 1096 backend/8014 aserciones; Pint 410/PHPStan sin errores. Continúan pendientes incidentes/recuperación y pantallas de S01. Los sistemas S02–S13 aún necesitan revisión completa según matriz.


Recuperación S01: B73–B78 corregidos; apertura/reenvío/confirmación con evento exacto en TX, caducidad coherente hasta finalización/decisión, y pantalla con reintento/foco de teclado.32 regresiones backend y9 frontend nuevas. Full1128/8235 y651 frontend; Pint413/PHPStan0, lint/tipos/build correctos. Capturas390/1440 claro/oscuro inspeccionadas; respuestas simuladas, sin prueba nueva de proveedor/release. La dependencia administrativa no cierra S11. Continúan revisión de incidentes/MFA y cobertura de cada función del plan.


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


S01 B116–B118/O06 (2026-10-02): edición OTP conserva posiciones/invalida huecos, reset/completado correctamente; métodos MFA/recovery se serializan durante verificación; foco/modal/tab y caducidad/error/Escape conservan paso vigente.15regresiones nuevas, final52dedicadas; frontend849/lint/tipos/build correctos; browser4contextos/32POSTsimulados; backend77/541+filtro separado14/82 en uvh_test, sin sumar como suite completa. Ledger52funciones leídas/11archivos con fronteras pendientes explícitas; inventario440/2143con nombre/1127callbacks/3firmas y propuestas de propiedad refinadas. S01 parcial; todos los sistemas/objetivo conservan alcance. Informe completion y ledger2026-10-02 contienen evidencia y límites.


S01 B119/B120/O07 (2026-10-02): navegación después de autenticar maneja cancelación y fallo con reintento sin credenciales ni factores, con generación/flujo/foco protegidos. Caducidad MFA ahora excluye el instante expiresAt; status y step-up coinciden y factor no se consume al caducar. Frontend864, controles dedicados67, calidad/build correctos; backend filtro85/572 y Pint421/PHPStan0; full backend1251/8941 aserciones correcto,209,09s en uvh_test. Browser12 recorridos/20 POST simulados sin repetir credenciales. Inventario440/2146 con nombre/1128 callbacks/3 firmas; ledger59 lecturas explícitas, aún parcial. Detalle y límites en informe completion y ledger; S01–S13 abiertos.


S01 B121/B122/O08 (2026-10-02): reautenticación maneja navegación fallida con reintento sin otro factor, conservando contexto/vida/roles/busy/foco; promoción exige MFA utilizable bajo lock y conserva legacy/keyring. Destino de retorno usa regla compartida. Vectores TOTP oficiales19/23 aserciones; backend completo1274/8983 aserciones y frontend885/calidad/build correctos. Browser8 recorridos/4 POST simulados, status una vez y factor como máximo una vez. Autorretorno /auth no reprodujo bloqueo por renovación del componente. Ledger77 lecturas/16 archivos e inventario440/2148 con nombre/1129 callbacks/3 firmas; S01–S13 mantienen pendientes. Detalle y límites en informe completion.


S03/S13 parcial (02/10): B123 auditoría transaccional en doce mutaciones explícitas de workspace; B124 caducidad de sesión bajo lock en transferencia/borrado. 56+4 regresiones nuevas;131/954 controles y Pint423/PHPStan0. Contrato y ledger de autoridad documentados; backend completo1334/9474 aserciones,279,36s en uvh_test, exit0. CI36950477409 no arranca por bloqueo de facturación confirmado en GitHub; resolver cuenta y verificar ejecución real. S01–S13 abiertos; detalle/alcance en informe completion y ledger S03.


S01/S03 B125/O09–O10 (02/10): revalidación de sesión concreta bajo lock en las doce mutaciones de workspace y conservación del bearer ante identidad obsoleta; contexto compartido con Auth sin cambiar política de sus callers. Primera separación Auth implementada: LoginAdmission y MfaChallengeStore, preservando TX/audit/TTL/keys y respuestas.251 contratos/1636 aserciones; Pint428/PHPStan0 con baseline activo. Inventario444/2158 funciones con nombre/1130 callbacks/3 firmas y hashes actuales; ledger S01 95/19. Full final1431/10041 correcto; detalle en informe/ledgers/contrato. S01–S13 y gates externos siguen abiertos.


Verificación definitiva del árbol final B125/O09–O10:1431/1431 backend,10041 aserciones,249,51s en uvh_test (s01-auth-extraction-full-backend-final.log), exit0. Pint428/PHPStan0 con baseline existente y sin ampliación (s01-auth-extraction-quality-final.log), exit0. Último cambio PHP ID0/000 incluido en esta suite. Inventario444/2158 con nombre/1130 callbacks/3 firmas;444 hashes y anchors de ambos ledgers actuales, Node --check y git diff --check correctos. Backend97 regresiones nuevas frente al full1334 anterior; frontend no modificado en este lote y no se acredita nueva ejecución de su suite. S01–S13 y objetivo global abiertos; siguiente extracción admisión final TOTP/recovery según plan. CI billing permanece externo pendiente. No DB local, migración, proveedor, worker/scheduler, commit/push ni despliegue.


S01 B126/O11 (02/10): segundo paso Auth extrae admisión SQL TOTP/recovery y factores compartidos con StepUp/enrollment, preservando locks/TX/keys/TTL/replay. Traslado89/606 antes/después; B126 corregido después de red4fallos/2controles: cuenta obsoleta no cobra intento de recovery ni registra factor incorrecto. Final91/640;Pint430/PHPStan0 y baseline191→188. Inventario446/2160/1130/3 con hashes actuales, ledger101/21; full final1441/10137 correcto,269,95s. Detalle/alcance en informe/ledger S01; S01–S13 permanecen abiertos.


Verificación final B126/O11:1441/1441 backend,10137 aserciones,269,95s en uvh_test (s01-mfa-admission-full-backend.log), exit0; incluye10 casos nuevos frente a1431 anterior. Pint430/PHPStan0, baseline191→188 con sólo3 entradas resueltas retiradas (s01-mfa-admission-quality-final.log), exit0.91/640 contratos dedicados y traslado89/606 antes/después. Inventario446 archivos/2160 con nombre/1130 callbacks/3 firmas;446 hashes y101/16 anchors S01/S03 comprobadas. Ledger S01 101 funciones/21 archivos, todavía parcial. Node --check y git diff --check correctos, sin cambio de PHP después de la suite. Frontend no modificado ni nueva ejecución/browser atribuidos a este lote. Auth y objetivo global S01–S13 siguen abiertos; siguiente RegistrationEdit/registro/verificación antes de extraer su admisión. CI billing conocido y gates de producción permanecen externos. Sin migración, DB local, proveedor, worker/scheduler, commit/push ni despliegue.


S01 B127/O12 (02/10): registro/activación separados conservando admisión SQL completa y compatibilidad legacy; deadline exclusivo del permiso de edición corregido. Full1451/10213 correcto,257,75s en uvh_test; Pint434/PHPStan0 con baseline186. AuthController2637líneas; funciones restantes siguen pendientes, S01–S13 abiertos. Evidencia y siguiente bloque de corrección/reenvío en informe y ledger S01.


S01 O13/B128 (02/10): corrección/reenvío extraídos, emisión pending/legacy unificada, cookie v3 con lectura v2 y rangos completos. Full habitual1480/10386,258,44s, y calidad437/PHPStan0 correctos. B129(P2) confirmado y abierto: un signup anónimo obtiene201 uniforme pero sus posteriores login/corrección distinguen dirección libre de ocupada. Probe separado falla; full verde no prueba privacidad ni finalización. Prioridad siguiente B129 según plan maestro; resto S01–S13 y gates externos pendientes.


O14/B129/B130 (03/10): intento de registro durable independiente de ocupación, cookie v4 y compatibilidad v2/v3, corrección coherente y single-use para todos los ACK. El aviso de login describe la solicitud; contraseña correcta conserva prioridad. Activación y retención comparten raíz estable/contexto antes de pending; purga conserva una renovación confirmada durante su espera. Probe original B129 ahora es regresión permanente; B130 reproducido rojo y corregido. Suite completa1527/1527 backend,11020aserciones,348,85s sólo uvh_test (s01-registration-attempt-full-backend.log), exit0;47 casos nuevos frente a1480.198/2255 contratos dedicados (98,94s, s01-registration-attempt-contracts-definitive.log). Pint442/PHPStan0 (s01-registration-attempt-quality-final.log), exit0, baseline sin ampliar. Frontend885/885 y lint/tipos/build correctos, sin nueva revisión visual manual/browser de API local. Inventario452/2176con nombre/1134callbacks/3firmas,452hashes y136anchors S01/28archivos más16S03/2archivos verificados; captura actual03/10, nombre histórico02/10. AuthController2488→2438líneas; no se atribuye ahorro de latencia global. Migración aplicada/verificada sólo uvh_test con guard explícito; NO aplicada uvh_local. Esquema y recambio coordinado de código/procesos pendientes antes de usarlo en otro entorno. S01–S13 y objetivo global siguen abiertos; próximo bloque admisión forgot/reset y helpers compartidos, más gates externos/CI billing sin cambio. Sin entrega real, worker/scheduler productivo, commit/push ni despliegue.


O15/B131 (03/10): PasswordRecovery extrae completas las transacciones de solicitud/reset, SecurityIncidentNotice reúne los avisos de contraseña y sesiones, y CredentialChangeResponse conserva la limpieza de cookie sólo para la cuenta afectada. Seis cuerpos comparados sin cambios de orden/política. AuthController2438→2289líneas; mejora de organización, sin ahorro de latencia/consultas medido.17 nuevas caracterizaciones;151/1246 antes y después. Full1544/1544 backend,11155aserciones,336,31s sólo uvh_test (s01-password-recovery-full-backend.log), exit0. Pint446/PHPStan0 (s01-password-recovery-quality.log), exit0; baseline184→182 findings/171entradas, sólo dos return types resueltos retirados. B131(P3): registro prometía otras24h y disponibilidad de URL sin renovar su deadline ni confirmar existencia. Rojo2fallos/66controles; texto condicionado a caducidad/disponibilidad, sin cambiar TTL/bearer/API; Auth68/68 y frontend887/887, lint/tipos/build correctos. Inventario455/2179con nombre/1134callbacks/3firmas,455hashes y150anchors S01/31archivos más16S03/2archivos comprobados. No nueva revisión visual/browser/E2E atribuida. S01–S13 y objetivo global siguen abiertos; siguientes fronteras: revocación protectora con evidencia recuperable y recuperación de cuenta, luego módulos restantes. CI billing y gates reales externos siguen pendientes. Sin migración, modificación de uvh_local, correo real, worker/scheduler productivo, commit/push ni despliegue.


O16/B132/B133 (03/10): revocación protectora conserva evidencia recuperable ante fallo de admisión audit general; cancelación de borrado no se revierte por logging de fallback roto. TX completa separada en CompromisedAccessRevocation, sin cambiar autoridad/bloqueo/MFA/cookie ni SQLorder. Contratos99/1105 y Pint452/PHPStan0; baseline180 findings/169entradas, sin nuevos ignores. Schema incident receipts aplicado sólo uvh_test, NO uvh_local; down protege pendientes, no backfill histórico. Gauge privado y alerta15min preparados, YAML7reglas validado, sin promtool/scheduler/alerta real atribuida. Full backend definitivo1568/11349,337,83s,exit0 (s01-incident-full-backend.log). Inventario457/2183/1137/3, ledgerS01 158/35 aún parcial. S01–S13/global siguen abiertos: recuperación de cuenta y funciones/roles/gates externos restantes. Detalle y evidencias en informe completion. Sin frontend nuevo/browser/entrega real/commit/push/despliegue.


O16/B132/B133 verificados (03/10): full1568/1568 backend,11349aserciones,337,83s exclusivamente uvh_test (s01-incident-full-backend.log), exit0;24 controles nuevos frente a1544.99/1105 dedicados,22,28s (s01-incident-contracts-definitive.log), exit0. Pint452/PHPStan0 (s01-incident-quality-final-fixed.log), exit0; baseline182→180 findings/169entradas, dos supresiones resueltas retiradas y ninguna añadida. B132 conserva evidencia recuperable sin revertir revocación por audit general; B133 impide rollback de cancelación por logger de fallback. TX incidente completa comparada tras extracción, AuthController2289→2220líneas; sin latencia/consultas ahorradas medidas. Inventario457archivos/2183con nombre/1137callbacks/3firmas,457hashes y158anchorsS01/35archivos más16S03/2archivos comprobados tras full. YAML7reglas completas únicas validado, Node--check/diff correctos; no promtool/monitorización real atribuida. Migración2026_10_03_000002 aplicada sólo uvh_test con guard; uvh_local intacta, sin backfill histórico. Frontend sin cambio/nueva ejecución/browser atribuidos. S01–S13/objetivo global activos: siguiente separación request/confirm/complete recovery con caracterización previa y resto de funciones/roles/gates externos pendientes. CI billing conocido permanece externo. Sin proveedor real, worker/scheduler productivo, commit/push/deploy.


O17/B134 (03/10): request/confirm/complete recovery separados conservando TX completas.103/765 antes/después y139/991 final. B134 cookie sólo propia + current estricto/estadoSPA/generación:2redAPI y5redfrontend, corregidos; frontend50dedicados y895full actuales. Pint454/PHPStan0, baseline177/166 sin nuevos ignores; AuthController1985líneas. Inventario458/2187/1137/3 y ledger176/42 aún parcial. Full backend1600/11589,338,08s verificado; lint sólo test corregido por if/else y gatesfrontend895/lint/tipos/build definitivos exit0. No nueva migración/DBlocal/browser/proveedor real. Global S01–S13 y gates externos abiertos; cleanup físico/fallbacks y resto Auth pendientes. Detalle en informe completion.


O17/B134 verificados (03/10): full1600/1600 backend,11589aserciones,338,08s exclusivamente uvh_test (s01-account-recovery-full-backend.log), exit0;32 casos nuevos frente a1568.103/765 antes/después del traslado,139/991 dedicado final,36,63s; Pint454/PHPStan0 (s01-account-recovery-quality-final.log), exit0. Baseline180→177 findings/166entradas, sólo3 retornos resueltos eliminados. AccountRecoveryAdmission conserva tres TX completas comparadas; AuthController2220→1985líneas. B134 cookie sólo propia/current booleano y SPA con generación/validación/destruction/nueva identidad: redAPI2fallos/1control, redfrontend5fallos/3controles;50dedicados pasan. Fullfrontend895/895 definitivo (s01-account-recovery-full-frontend-definitive.log), lint/tipos/build definitivos exit0. Lint inicial señaló ternario de assert; sustituido por if/else sin relajar regla ni tocar PHP. Inventario458archivos/2187con nombre/1137callbacks/3firmas;458hashes y176anchorsS01/42archivos más16S03/2archivos verificados tras full. Node--check/gitdiff--check correctos. Sin ganancia de latencia/SQL medida ni nueva concurrencia multiproceso/QA visual/E2E/proveedor atribuida. No nueva migración/uvh_local/worker/scheduler/commit/push/deploy. Objetivo yS01–S13 abiertos; siguiente frontera cleanup físico/fallback en callers Auth y resto de mutaciones/lecturas/frontends/roles por función. CI billing conocido y gates reales externos mantienen estado.


O18 (03/10, verificación completa en curso): B135 posterga cleanup HTTP al commit exterior, B136 contiene el logger de cleanup, B137 contiene el fallback de métricas y B138 incluye la admisión exacta del audit ready en su TX. 31 controles nuevos;123/869 dedicados y Pint456/PHPStan0 verificados. Revalidación de estado/ruta bajo lock; worker conserva booleano inmediato y housekeeping recupera pointer terminal. No cambio frontend, nueva migración ni DB local. Detalle y límites en informe completion; Auth/S01–S13 y gates reales abiertos. No usar esta nota como prueba de la suite completa.


O18/B135–B138 verificación final (03/10): full1631/1631 backend,11741 aserciones,357,71s exclusivamente uvh_test (`s01-artifact-full-backend.log`), exit0;31 controles nuevos.123/869 dedicado final y Pint456/PHPStan0 definitivos, exit0. Baseline177 findings/166 entradas conservado sin nuevos ignores. Inventario458 archivos/2190 funciones con nombre/1138 callbacks/3 firmas;458 hashes y192 anchors S01/45 archivos más16 S03/2 archivos comprobados tras full. Node--check y gitdiff--check correctos. No edición de PHP/tests durante suite ni cambio frontend/migración/uvh_local/proveedor real/worker o scheduler productivo/commit/push/deploy. La revisión global y gates reales siguen abiertos; siguiente caracterización/separación de contraseña autenticada, email y MFA con TX completas, más fronteras export pendientes.


O19 (03/10, full en curso): cambio autenticado separado a AuthenticatedPasswordChange conservando TX completa y policy;18 nuevas caracterizaciones,93/873 antes/después y Pint458/PHPStan0 verificados. AuthController1985→1937líneas y baseline176/165, sólo1 ignore resuelto retirado. Sin bug nuevo atribuido ni ganancia de latencia/SQL medida. Fuente estable durante suite; sin frontend/migración/DBlocal/proveedor real. S01–S13 abiertos; siguiente separación email/MFA con caracterización previa. Full no se acredita por estos filtros.


O19 verificación final (03/10): full1649/1649 backend,11925 aserciones,310,68s sólo uvh_test (`s01-password-change-full-backend.log`), exit0;18 controles nuevos.93/873 antes (19,32s) y después (22,95s), exit0. Comparación del cuerpo trasladado repetida tras format conserva orden/policy; AuthController1985→1937líneas. Pint458/PHPStan0 (`s01-password-change-quality.log`), exit0; baseline176 findings/165 entradas, sólo1 ignore resuelto retirado. Inventario459 archivos/2191 funciones con nombre/1138 callbacks/3 firmas;459 hashes y196 anchors S01/46 archivos más16 S03/2 archivos verificados después de full. Node--check/gitdiff--check correctos. No PHP/tests editados durante suites, ni frontend/migraciones/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. Fuente de los tres flows email releída para siguiente fase; posible deadlock al intercambiar reservas sigue candidato sin B/prueba, se reproducirá con dos procesos antes de corregir. Auth/S01–S13 y gates globales continúan abiertos.


O20 verificación final (03/10): full1672/1672 backend,12108 aserciones,307,24s sólo uvh_test (`s01-email-change-full-backend.log`), exit0;23 controles nuevos (22 caracterizaciones y1 native concurrency).105/810 antes (21,55s) y después del traslado (21,40s);106/823 final (27,44s), exit0. B139 deadlock cruzado40P01 reproducido con dos procesos y corregido; ambos409, sin ciclo, reservas/recovery conservados; freshness rollback comprobado. Tres TX completas comparadas antes del fix; import ausente detectado por8 fallos durante traslado, corregido antes del definitivo. AuthController1937→1782líneas. Pint463/PHPStan0 (`s01-email-change-quality.log`), exit0; baseline173/162, sólo3 ignores resueltos retirados. Inventario461 archivos/2194 funciones con nombre/1138 callbacks/3 firmas;461 hashes y199 anchorsS01/47archivos más16S03/2 comprobados después de full. Node--check/gitdiff--check correctos. Sin PHP/tests edits durante suites, frontend/migraciones/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. Siguiente MFA/lecturas y demásS01–S13/gates reales; goal abierto.


O21 verificación final (03/10): full1714/1714 backend,12722 aserciones,325,82s sólo uvh_test (`s01-mfa-configuration-full-backend.log`),exit0.42 caracterizaciones nuevas;146/1430 antes31,00s y después36,04s,exit0, sin fallos de fixture. Cinco TX completas comparadas después de format; sólo adaptación SecurityContext. AuthController1782→1604líneas. Pint465/PHPStan0 (`s01-mfa-configuration-quality.log`),exit0; baseline168/157, sólo5 ignores resueltos retirados, sin nuevos. Inventario462 archivos/2199 funciones con nombre/1138 callbacks/3 firmas;462 hashes y211 anchorsS01/48archivos más16S03/2 comprobados después de full. Node--check/gitdiff--check correctos. No PHP/tests edits durante suites ni frontend/migraciones/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. No nuevo bug ni ganancia de latencia/SQL medida en O21. O20+B139 y O21 suman65 controles nuevos. Continúa reautenticación/perfil/reads/revocaciones y restoS01–S13/gates externos; objetivo activo.


### S01 O22/O23 — separación verificada localmente

Backend completo 1724/1724 y 12910 aserciones (334.17s, uvh_test, exit0); filtro final105/596; Pint469/PHPStan0. Diez controles nuevos, dos TX completas y cuatro lecturas/contexto separados, preservando contratos. AuthController1469líneas; baseline162/151, seis supresiones resueltas retiradas.466 hashes y224 anchorsS01/52archivos más16S03/2 verificados después del full; detalle e incidencias en [informe](project-completion-audit-2026-09-30.md). No nuevo bug, frontend/gate visual, migración/uvh_local, proveedor/worker/scheduler real, commit/push/deploy ni ahorro de SQL/latencia atribuidos. S01–S13/CI/gates reales abiertos; siguiente [revocación de sesiones](superpowers/plans/2026-10-03-session-revocation-admission.md).


### S10/O25 — bugs de autoridad y admisión, verificados localmente

- [x] B140(P2): preferencias/sellado/exact audit atómicos, incluidos callers internos; red API2/bare2 y rollback/retry/historial comprobados.
- [x] B141(P2): seis rutas revalidan contexto vivo, con locks en commands;42regresiones de peticiones ya en curso.
- [x] B142(P3): kind duplicado422sin cambio, sin poder silenciar mandatory.
- [x] Reducir13→1SELECT delivery por vista GET/PATCH y conservar payload/catalogo/scopes; sin latencia medida.
- [x] O24: separar tres TX completas de revocación, conservar logout y15caracterizaciones previas/posteriores.
- [x] Full1793/13590 uvh_test69090 terminó0;467hashes y225S01/16S03/29S10anchors verificados después.
- [ ] Continuar S10 productores/eligibilidad/retención, UI async/QA visual y gates reales; no cierre global por134/1007/Pint471/PHPStan0.

Detalle en [informe](project-completion-audit-2026-09-30.md) y [ledgerS10](superpowers/plans/2026-10-03-s10-function-review-ledger.md). Sin release/DBlocal/proveedor productivo atribuídos.


Verificación final O24/O25:1793/1793backend y13590aserciones,369,85s exclusivamenteuvh_test,exit0;134/1007dedicado yPint471/PHPStan0.69controles nuevos;B140/B141/B142 corregidos localmente;13→1consultas delivery por vista verificadas. No frontend/nuevo browser/migración/uvh_local/proveedor real/release atribuídos. Siguiente [continuidad de identidad de UI](superpowers/plans/2026-10-03-notification-ui-identity.md), candidato sin reproducción todavía. S01–S13/gates reales/CI billing histórico abiertos.


## S10 O26 — preferencias e inbox por identidad (03/10)

O26 verificado (03/10): B143(P2) preferencias/errores/snackbar de sesión anterior o vista destruida, B144(P3) GET antiguo sobrescribía lectura/guardado más nuevo y liberaba loading ajeno, B145(P2) inbox visible y busy heredados entre identidades. LatestRequest propia de preferencias, identity/revisión en todos los efectos, reset de DTO/flags en identity/destroy; bandeja limpia/recarga contexto actual. GET cancelable, PATCH ya despachado sigue vivo.21 controles frontend nuevos:12fallos/47controles rojo componentes,3fallos/1control rojo HTTP real simulado;72/72 dedicados y916/916 full frontend,exit0. Lint final/tipos/build exit0. QA desktop con fixture aislada demuestra A→sin identidad→B y guardado operativo/mandatory fijo; no E2E con backend real ni login real. Mobile390 sólo overflow general de Settings=false, captura en perfil, no gate mobile de preferencias. Vídeo no generado por ffmpeg ausente; capturas inspeccionadas. Inventario467archivos/2216con nombre/1144callbacks/3firmas;467hashes y225S01/53files+16S03/2files+63S10/9files verificados. Backend fuente sin cambio:1793/13590 yPint471/PHPStan0 de O24/O25 siguen evidencia anterior, sin nueva ejecución atribuida. Baseline161/150/controlador1408 sin cambio. Sin migración/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. Objetivo/S01–S13/gates reales siguen abiertos; O27 examinará despacho de mutaciones tras CSRF y generación durante logout, aún candidatos sin ID. CI billing histórico sin nueva consulta.


## O27 — contexto de envío y recuperación de logout (03/10)

O27 verificado (03/10): B146(P1) intención de otra cuenta despachada después de espera/bootstrap/retry CSRF, B147(P1) tenant header distinto tras cambiar workspace (incluido A→B→A), B148(P2) loading bloqueado tras logout fallido con user signal igual. SessionContextService comparte misma proyección user y reloj reactivo, Auth mantiene fachada/policy; ApiService captura ID/epoch y tenantID/revisión antes deawait, comprueba antes de cada envío/refresco/reintento, incluyendo postBlob. WorkspaceService avanza revisión sólo al cambiar selección normalizada; catálogo/path de tenant extraído sin cambio semántico. Rojo25casos18fallos/7controles; adicional34casos3fallos/31 (1productoUIDme+2fixtureBlob I/O), fixture corregida a esperar request real.34controles nuevos:82/82 dedicado y950/950 full frontend (4,592s Karma/4,323s ejecución),exit0. Lint/tipos/build10,017s exit0; Node--check/diff correctos. Bootstrap coalesced, retry único, idempotency key/body, rechazo noCSRF, public login/MFA/register/bearer, same tenant reselection ywrite ya despachado conservados. QA fixture aislada con GET realmente retenido al click logout503: antesloadingtrue/user1; despuésgeneration1/loadingbusyfalse/user1/inbox1 ytoast de reintento, misma ruta. Capturas yJSON inspeccionados; no gate de login/backend real/mobile nuevo ni vídeo. Fuente467→469files/2221named/1146callbacks/3firmas, cero owners provisionales;469hashes y277S01/59files+16S03/2+63S10/9anchors verificados. PHP intacto:1793/13590/Pint471/PHPStan0 deO24/O25 anteriores, no nueva suite atribuida; baseline161/150/controlador1408igual. Sin DB/migración/proveedor/worker/scheduler productivo/commit/push/deploy. Objetivo/S01–S13/gates reales abiertos. Protección es de contexto local observado antes de dispatch, no bypass del servidor ni solución universal de cookie HttpOnly; respuestas Auth ya enviadas, /me fuera de orden y cookies compartidas requieren O28. CI billing histórico sin nueva consulta.


O28 verificación final (03/10): B149(P2) orden de probes/DTO confirmado/publicación nested await; B150(P2) epoch/workspace/rol al observar otra cuenta; B151(P1) intención frontend distinta del actor cookie, precondición server y limpieza sólo de proyección; B152(P2) regresión de settlement de startup detectada durante el nuevo hardening, con probe más nuevo401/503 que cancelaba init. Signout definitivo también normaliza probe, sin atribuir a ese caso un bloqueo de AuthCard (loadedtrue ya la muestra).73controles nuevos (46frontend/27backend): rojo Auth11/13, interceptor8/19, backend18/27, publicación2/20 yprobe3/23.111/111 dedicado definitivo0,111s Karma/0,103s y996/996 full frontend5,411s Karma/5,038s, exit0 (`s01-observed-identity-full-frontend-probe-final.log`); lint/tipos/build11,563s definitivos exit0.126/1058 backend específico33,24s yPint472/PHPStan0 exit0. Full backend directo1820/1820,13770aserciones,360,394s/127MB exclusivamenteuvh_test,exit0 (`s01-expected-account-full-backend-raw-final.log`), JUnit1820/13770/errors0/failures0/skipped0;27casos/180aserciones corresponden al nuevo ExpectedAccountBoundaryTest.

La primera suite Artisan salió2 al imprimir WorkspaceAuditAtomicity, sin resumen; no se acredita ni se atribuye causa. Diagnóstico aislado133/935/22,77s pasa. Primer raw+JUnit falló255antes de tests por intentar escribir en mount/ro, corregido a /app/storage/logs. Fuente PHP/tests estable durante cada suite ysin cambios para saltar contratos. El full directo tiene evidencia completa; investigar la primera salida anómala queda como límite S13. Los fallos de fixtures (factory-vs-fresh, token422, unionPromise TS2345 yworkspace read nueva) están registrados sin bug de producto atribuido.

Reutilizar LatestRequest evita otra implementación de cancelación/revisión; init/me y confirmed DTO tienen propiedad explícita, double guard sin await antes de publicar y generation compartida. No se atribuye ahorro de latencia/SQL ni nueva extracción backend: baseline161/150, controlador1408, tres TX previas comparadas intactas. Inventario469archivos/2229named/1148callbacks/3firmas y0ownersprovisionales;469hashes y293S01/60files+16S03/2+63S10/9anchors verificados. QA sólo fixture1440×1000 de409: sinUser/inbox anterior, /auth, loaded/probe true, marker null, capturas inspeccionadas. No nuevaQAvisual específica deB152, autofoco/teclado completo/móvil/vídeo/login real/backendE2E/cookie race/proveedor/CORS producción acreditados. Owned browser/servers/tool handles cerrados; sesión ajena intacta.

Header esperado es opcional yno autoridad ni sustituto de CSRF/roles/verified/locks; legacy ypublicbearer conservados. No retira write/Set-Cookie ya enviado. Sin migración/uvh_local/proveedor/worker/scheduler productivo/commit/push/deploy. Objetivo/S01–S13 ygates reales/CI billing histórico siguen abiertos; Next Step [writers simultáneos de DTO del mismo User](superpowers/plans/2026-10-03-auth-dto-writers.md), candidato de código aún sin ID, más restantes funciones/roles/UX/operación. No marcar cierre global por estas suites.
