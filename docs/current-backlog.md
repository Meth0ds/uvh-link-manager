# UVH — Backlog vigente

Última revisión: 25 de septiembre de 2026.

Este archivo es el backlog **vigente** del producto. Sustituye a
[`todos.md`](archive/todos.md), archivado como registro histórico (su contenido
ya no se actualiza; se conserva por trazabilidad de decisiones y mediciones).

Una casilla marcada sólo acredita implementación revisada. No acredita E2E,
despliegue, conformidad jurídica ni preparación para producción. Los bloqueos
externos (CI con cuenta de GitHub bloqueada por facturación, DNS/TLS reales,
revisión jurídica) se listan aparte porque no dependen del código.

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
  `notification_preferences`, allowlist de kinds (12 obligatorios de seguridad
  o solicitud propia y 4 operativos, espejada en el frontend), campana 🔔 en
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

- [ ] **F7 — Gestión a escala**: acciones masivas con idempotency key,
  import/export CSV (dry-run, errores por fila, CSV injection), gestor de tags
  (renombrar/fusionar), colecciones de un nivel, plantillas de enlace, export
  de analítica CSV/JSON sin visitor hashes.
- [ ] **F8 — Analítica medida antes de tocar**: eliminar la hot row
  `link/day` (o `lockForUpdate()` documentado) y caché 30–60 s por
  workspace/rango/filtro. Requiere medición previa con
  `docker-compose.analytics-drill.yml` (ver
  [`analytics-rollup-capacity.md`](analytics-rollup-capacity.md)).
- [ ] **F9 — Entitlements y límites**: Plan → entitlements → límites,
  incluido `members` (hoy `not_configured` en `WorkspaceUsageController`),
  sin proveedor de pagos; purga verificada configurable (`purgeVerified`).
- [ ] **F10 — Observabilidad**: correlation ID edge→jobs→outbox/logs, SLOs
  escritos, alertas Prometheus→Grafana→canal con ensayo «mato queue-mail ⇒
  alerta», monitor externo sobre `/status`.

## Bloqueos externos (no código)

- [ ] **F11 — Operación real** (requiere infraestructura/cuentas):
  - [ ] CI remoto de GitHub Actions (§42): la cuenta está bloqueada por
    facturación; los PRs se mergean con `--admin` como medida temporal.
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
