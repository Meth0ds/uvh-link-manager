# UVH — Backlog vigente

Última revisión: 1 de octubre de 2026.

Este archivo es el backlog **vigente** del producto. Sustituye a
[`todos.md`](archive/todos.md), archivado como registro histórico (su contenido
ya no se actualiza; se conserva por trazabilidad de decisiones y mediciones).

Una casilla marcada sólo acredita implementación revisada. No acredita E2E,
despliegue, conformidad jurídica ni preparación para producción. Los bloqueos
externos (CI con cuenta de GitHub bloqueada por facturación, DNS/TLS reales,
revisión jurídica) se listan aparte porque no dependen del código.

## Continuación de revisión de código —01/10

- [x] Solicitud/confirmación de borrado con actor vigente y auditoría exacta transaccional.
- [x] Cancelación protectora con marcador durable y recuperación en housekeeping; migración requerida2026_10_01.
- [x] Reintento de confirmación/cancelación ante conexión fallida,429 y5xx; enlaces inválidos definitivos.
- [x] Cambio de contraseña y solicitud/cancelación de email revalidan autorización vigente; eventos exactos de contraseña/reset/email comparten transacción.
- [x] Confirmación de email permite reintento de errores temporales sin publicar un cierre de sesión fallido.
- [ ] Completar revisión de recuperación con soporte y auditoría de ejecución/compensación automática.
- Evidencia actual:951 backend/7220 aserciones,629 frontend, calidad y compilación correctas; [informe y límites](project-completion-audit-2026-09-30.md). Objetivo amplio aún abierto.

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
