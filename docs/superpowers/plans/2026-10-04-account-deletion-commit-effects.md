# Account deletion commit effects Implementation Plan

> **For agentic workers:** Execute sequentially with executing-plans in the existing shared tree. No subagents/worktree/commit/push/deploy.

**Goal:** Determine whether public deletion confirmation reconciles external intent/cache effects and audit consistently with the enclosing transaction and confirmed response.

**Architecture:** Preserve user-first suspension TX, mailbox bearer/current ownership, cancellation grace and artifact cleanup. Inspect only LinkIntentRegistry revocation and account.deletion_link_intents_reconciled after the inner transaction. A fail-closed security effect may be intentional; require actual contract and reproduction before changing it.

**Tech Stack:** Laravel/PostgreSQL guarded uvh_test, array or isolated cache store, mail array/queue fake, actual HTTP endpoint; no productive cache/mail/worker/provider.

**Spec:** Source candidate from O41/O43: confirmDeletion invokes LinkIntentRegistry::revokeForUser and reconciliation Audit immediately after its inner TX. Registry deletes cache records/releases counters/forgets SQL inverse index. Code is read, but no defect or ID yet.

## Global Constraints

Only uvh_test, no uvh_local/migrations/accounts/mail/provider/worker/scheduler. One DB suite at a time; freeze PHP/tests during suites. No claim of native cookie ownership/future Set-Cookie ordering. Mandatory current boolean O41 preserved. Do not change cancellation protective deadline by analogy or silently restore pre-suspension capabilities. No new baseline ignores.

### Task 1: Establish authority and transaction contract

**Files:** Read backend-laravel/app/Http/Controllers/AccountController.php confirmDeletion/cancelDeletion; app/Support/LinkIntentRegistry.php; LinkIntent controller/consumer/lifecycle and callers of revokeForUser; app/Support/Audit.php, PrivateArtifactCleanup.php and existing AccountDeletionSecurityTest/BoundaryTest.

- [x] Read complete relevant call bodies, lock/cache/index/counter semantics, outer TX behavior and artifact callback precedent. Determine whether intent cancellation is security revocation or draft disposal and what compensation must preserve.
- [x] Establish initial fixture through actual claim API if viable; otherwise real cache/index fixture with explicit limitations. Cache record, per-user/global counters and owned claims are inspected, not inferred from response.
- [x] Reproduce normal confirmation, outercommit, outerrollback, savepoint rollback with claimed A/B records. Compare durable suspended user/deletion request/session version/mail/audit/index with external cache/counters. Assign BugID only for material contract violation.
- [x] Reproduce cache read/forget/lock/release outage, SQL index cleanup outage and reconciliation audit admission/materialization failures. Distinguish rollback before admission from uncertain response after committed suspension; preserve recoverable pointers/markers where required. No postcommit failure described as rollback.

### Task 2: Repair only demonstrated failures

**Files:** Modify only controller/registry/helpers required by proven cases; create backend-laravel/tests/Feature/AccountDeletionCommitEffectsTest.php if reproduction needs additional independent coverage.

- [x] If a nontransactional effect must obey outer commit, register callback capturing immutable user/request IDs and metadata. Keep callback error accounting/retry semantics explicit; do not move security-authority locks or attach business rollback claims to callback failures.
- [x] If reconciliation admission fails, establish expected response/recoverability from existing Audit contract before deciding fallback. Do not relax mandatory account.deletion_scheduled admission.
- [x] Run dedicated deletion/security/intent/audit suites and composer quality, then full backend/JUnit only after product changes. Preserve existing2deletion+6export+4sessions frontend facade comparisons and3backend TX comparisons; no new frontend gate unless TS changes.
- [x] Refresh PHP inventory/TS inventory/anchors and matrix/report/planning with red/green details and proof limits. Global S01–S13, CI/roles/retention/capacity/real operation remain open.


O44 progress: B180/P2 red4/12,17 finalnew/104dedicado953/Pint483/PHPStan0 verified. Full2083/JUnit live; remaining two checkboxes require terminal full and final source verification. Other4callers have own plan2026-10-04-security-intent-commit-effects.md and no new BugID.


## Cierre local O44


O44 final verificado (04/10): **2083/2083 backend,16347aserciones,343,130s/135MB,exit0**, exclusivamente uvh_test (`.uvh-runtime/s02-deletion-commit-effects-full-backend.log`). JUnit2083/16347/errors0/failures0/skipped0;17AccountDeletionCommitEffectsTest/349aserciones en `backend-laravel/storage/logs/s02-deletion-commit-effects-junit.xml`.104/953dedicado19,22s yPint483/PHPStan0 exit0. Nueve hashes de fuente/tests/baseline sin cambios durante full y475sourcehashes/353S01/16S03/63S10/175S02anchors/cuerpos2deletion+6export+4sessions+3TX comprobados después; Auth648/AuthController1408/baseline152/141 preservados. B180/P2 corregido con cachearray+SQLreal/HTTPissueclaim; no provider/Redis/capacidad/cookie nativa ni nuevas UI/TS/gatesfrontend atribuidos (1373O43 previo). Todos handles propios cerrados, sin suites DB paralelas/PHPedits durante full. Postgres/mailpit compartidos quedan operativos;sin uvh_local/mail/usuarios/providers/workers/scheduler/migraciones externas/commit/push/deploy.

PlanO44 cerrado sólo localmente; **objetivo global/S01–S13 abiertos**. NextStep vigente: ejecutar `docs/superpowers/plans/2026-10-04-security-intent-commit-effects.md`, revisar completos yreproducir otros4callers antes de ID/fix. Sourceadmissionincident+updateUser ydosAuthwrapper leídos; outputhousekeeping/recoveryhelpers parcialmente truncado no acredita revisión completa. Funciones/roles/retención/capacidad/CI/operación real/restantes sistemas pendientes; no repetir full actual sin nuevos cambios/fallos.
