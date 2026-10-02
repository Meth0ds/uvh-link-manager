# UVH — Backlog vigente

Última revisión: 1 de octubre de 2026.

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
