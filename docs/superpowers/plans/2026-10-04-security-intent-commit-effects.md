# Security intent commit effects Implementation Plan

> **For agentic workers:** Execute sequentially with executing-plans in shared tree after O44 full/JUnit terminates. No subagents/worktree/commit/push/deploy.

**Goal:** Complete the review of remaining four callers that revoke private link handoffs following account-security transactions.

**Architecture:** Preserve every existing authority/lock/primary audit/receipt/cookie/role/last-admin/grace invariant. Reuse a single after-commit entry point only if all callers' contracts support it. Keep secondary cleanup failure distinct from durable protective changes and required primary audit admission.

**Tech Stack:** Laravel/PostgreSQL uvh_test, real HTTP API and isolated array cache, fake storage/mail array/queue fake; no productive worker/scheduler/provider or native cookie proof.

**Spec:** O44 B180 proof establishes nontransactional cache loss after outerrollback in confirmDeletion. Source CompromisedAccessRevocation::admit explicitly requires artifact/cache minimization after business commit; other callers have same direct revokeForUser shape but no new red/ID yet.

## Global Constraints

No PHP/tests edits during O44 or any active DB suite. One DB suite at a time; guard *_test/testing first. Preserve unrelated user changes and baseline; no policy changes to protective cancellation, last-admin, recovery dual approval or MFA. Do not claim rollback after committed operation or capacity guarantees for counter cleanup. Inventory is not reviewed-function coverage.

### Task 1: Establish complete caller contracts and reproduce

**Files:** Read AdminController::updateUser/eligibleLockedAdminSession, AuthController::revokeCompromisedAccess/completeAccountRecovery, CompromisedAccessRevocation::admit, AccountRecoveryAdmission::complete, SecurityIncidentAudit, UvhHousekeeping::executeAccountDeletions, PrivateArtifactCleanup, existing AdminConsole/SecurityIncidentAuditRecovery/AccountRecoveryAdmission/Housekeeping tests.

- [x] Verify full bodies/dependencies; O44 read updateUser, both Auth wrappers and incident admission completely. Housekeeping/admission recovery output was partly truncated: reread required, no coverage credited from truncated text.
- [x] Create backend-laravel/tests/Feature/SecurityIntentCommitEffectsTest.php with HTTP-issued/claimed A/B handoffs and real SQL snapshots. Initial public incident EmailToken uses security_revoke/43char plaintext/hash and future deadline; incident action never authenticates or disables MFA.
- [x] Exercise incident, admin block and approved recovery under normal commit/outercommit/outerrollback/savepoint rollback. Real admin session must have current role/verified/MFA freshness; recovery must retain two eligible distinct approving admins and current generation. B's handoff and counters remain untouched.
- [x] Exercise housekeeping privately through actual command test fixture only, with scheduled deadline and exact sent cancellation-mail receipt. Verify user anonymization/compensation/artifact/counters and whether nested TX is a supported path before changing behavior. Production CLI worker/scheduler is not run.
- [x] Compare user/security version/session/token/mail/audit/index/cache/counters for each outcome; capture actual red before ID/fix. Tests of wrong context/primaryAudit failure remain authoritative; do not replace with service/role stubs.

### Task 2: Resolve proven commit inconsistencies and reduce duplication

**Files:** Only necessary callers and LinkIntentRegistry; no API/DTO/schema/queue policy change unless independently required.

Possible narrow interface, if contract supports all consumers:
```php
/** @param null|callable(array{revoked: int, busy: int}): void $reconciled */
public static function afterCommit(int $userId, ?callable $reconciled = null): void
```
The helper registers a callback capturing integer user ID and optional secondary observer; catches registry failure as revoked0/busy-1. Caller-specific audit metadata captures immutable actor/resource IDs/IP/date. Primary events/receipt admission stay inside their original TX; unchanged current response/cookie logic stays in wrappers. Do not expose tokens/destinations/counter keys in telemetry.

- [x] Adapt only external cleanup expressions and compare complete caller/admission bodies with originals after explicit adaptations. Preserve O44 behavior in confirmDeletion rather than duplicate a second policy. Re-evaluate callback failure handling from actual Audit and metric contracts.
- [x] Read release path semantics and preserve recoverable SQL inverse rows/TTL bounded residuals; don't invent a hard counter-consistency guarantee on separate cache writes. Keep Lock/IP/global order and capacity protections.
- [x] Run dedicated deletion/intent/admin/incident/recovery/housekeeping/security tests, composer quality, then full backend/JUnit; freeze tested sources throughout. Snapshot source hashes, update inventory/anchors and literal comparators if source line counts change legitimately; no baseline ignores.
- [x] Update route matrix, source ledgers/report/plans with exact before/after evidence, scope/remaining external gates. Frontend1373O43 stays prior evidence unless TS changes. No full app/global closure from this phase.


## O45 evidence and refinement

B181/P2 red12/16 (278 assertions/3.73s), then cache-only fix exposed B182/P2 red3/16 (479 assertions/4.13s). Native retention red6/8 (28 assertions/2.38s) by removing only final artifact adaptations and restoring them before final gates. An initial missing receipt-table name and SQL SUM string assertion were corrected fixtures, not product findings. Final30new cases,181dedicated/1944assertions/34.59s, Pint484/PHPStan0 exit0. Full2113/JUnit is live; no PHP/tests mutation while running.

Native housekeeping also calls retryTerminal later in the same pass. It now schedules exact pointers when inside outerTX and returns zero not-yet-cleaned work; three housekeeping cleanup calls use afterCommit, worker attempt is untouched. Duplicate callbacks revalidate pointer/status and count only one physical cleanup. B180 AccountController shares the helper with unchanged telemetry metadata and required primary admission. Six complete files compared after explicit adaptations; AuthController1408→1399 only removes duplicate catches, not auth separation. Inventory475/2269/1168/3/0;475hashes/353S01/16S03/63S10/194S02anchors, baseline152/141 unchanged.

After full/JUnit and final hashes, next step is the user-requested coherent recovery/incident controller extraction under `2026-10-04-auth-recovery-controller-separation.md`. Keep primary housekeeping lifecycle-audit admission and registry/config TTL candidates open without BugID until red; no global S01–S13 completion.


O45 final verificado (04/10): **2113/2113 backend,17018aserciones,350,697s/133MB,exit0**, exclusivamente uvh_test (`.uvh-runtime/s02-security-commit-effects-full-backend.log`). JUnit2113/17018/errors0/failures0/skipped0 y30SecurityIntentCommitEffectsTest/671aserciones en `backend-laravel/storage/logs/s02-security-commit-effects-junit.xml`; summary `.uvh-runtime/s02-security-commit-effects-junit-summary.json` (JUnit348,399297s).181/1944dedicado34,59s;Pint484/PHPStan0 exit0.13hashes de fuente/tests/baseline congelados y comprobados después;475sourcehashes y353S01/16S03/63S10/194S02anchors en29archivos actuales. Seis archivos completos comparados tras adaptaciones explícitas y2deletion+6export+4sessions+3TX anteriores conservados. AuthController1399/AuthService648,baseline152/141 sin nuevoignore; no cierre de separación Auth por línea reducida.

B181/P2 yB182/P2 corregidos con evidencia roja/verde, incluidos native-command housekeeping/retención y cuatro security callers; countercleanup sigue best effort/TTLbounded. Sin cambios TS/DOM/QA ni nuevo gatefrontend (1373O43 previo), provider/SMTP/Redis/nativecookie/capacity/fileproductivo no acreditados. No usuarios/mail/DBuvh_local/providers/workers/scheduler/migraciones externas/commit/push/deploy. Todos handles propios terminales; shared postgres/mailpit siguen healthy, sin app/worker/scheduler. La respuesta anterior sobre estado Auth fue informativa; este turno sí es progreso por dosfixes/30regresiones/verificación real.

**Objetivo global/S01–S13 continúa activo.** NextStep vigente: ejecutar `docs/superpowers/plans/2026-10-04-auth-recovery-controller-separation.md`, extracción coherente de recuperación e incidente con completos cuerpos/middleware/routecomparators y contratos antes/después. PrimaryhousekeepingAuditdespuésTX yregistryTTL24/configurable permanecen candidatos no reproducidos/sinID, junto con resto de funciones/roles/retención/capacidad/CI/operación real. O45 cerrado únicamente como bloque local, no como proyecto finalizado.
