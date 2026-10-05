# Account deletion transport Implementation Plan

> **For agentic workers:** Execute sequentially with executing-plans in the existing shared tree. No subagents/worktree/commit/push/deploy; user preferences take precedence.

**Goal:** Extract two account-deletion HTTP calls from AuthService while preserving identity guards and caller behavior.

**Architecture:** AccountDeletionService owns only transport and existing decoders. AuthService keeps generation capture, assertCurrent and return values. Public bearer confirmation/cancellation remain separate.

**Tech Stack:** Angular/TypeScript, TestBed HTTP/API/interceptor/Auth; no new dependencies or backend mutations.

**Spec:** Gradual auth separation requested by user; O41 boundaries in docs/project-completion-audit-2026-09-30.md and SECURITY_MUTATION_CONTRACT.md.

## Global Constraints

No real accounts/mail/DB/provider/browser cookies. Tests may initialize A but replace identity only via invalidation→/me B→workspaces B. Do not change payload/options/deadlines/CSRF retries or treat invalid ACK as rollback. No PHP edits/backend suite necessary for a TS-only extraction. Source inventory is not review coverage.

### Task 1: Characterize facade and caller before extraction

**Files:** Create frontend/src/app/core/services/auth-account-deletion-transport.spec.ts. Read auth.service.ts, api.service.ts, interceptors/api.interceptor.ts, auth-response-decoders.ts and panel/settings/account-deletion-dialog.component.{ts,html}.

- [x] Record two complete facade bodies and exact expression adaptations in .uvh-runtime; compare literal bodies after extraction.
- [x] Real HTTP fixture asserts GET/POST account header1, no workspace header, credentials, POST password/confirmation/optional factor and CSRF. Assert positive decoded results, malformed502, 400/403/409/503/network0 no replay; read cancellation/custom1000ms/default20s and POST45s.
- [x] Test late success and401 after legitimate B; CSRF bootstrap and renewal retired intent; one explicit csrf_rejected retry, second refusal no third POST.
- [x] Instantiate real deletion dialog with stub MatDialogRef, actual Auth/API/interceptor; characterize GET failure/manual read recovery, blockers, no POST before acknowledgement/valid credentials/factor, one in-flight POST, destroy read cancellation/secret cleanup, success and malformed outcome with no replay.
- [x] Run included spec against original source and inspect exit0. No invented red bug for a behavior-preserving extraction.

### Task 2: Extract transport and verify

**Files:** Create frontend/src/app/core/services/account-deletion.service.ts; modify auth.service.ts.

Interfaces:
```ts
impact(options?: ApiReadOptions): Promise<AccountDeletionImpact>
request(password: string, confirmation: string, factorCode?: string): Promise<{ status: "requested"; confirmationExpiresAt: string }>
```
Implementation copies existing API expressions with decoders; facade adaptations are exactly:
```ts
const impact = await this.accountDeletion.impact(options);
const result = await this.accountDeletion.request(password, confirmation, factorCode);
```

- [x] Inject new service/remove two unused decoder imports; no state or policy in transport.
- [x] Compare two facade bodies with original after replacing only calls; retain previous6export/4sessions/3TX comparisons.
- [x] Run dedicated tests with caller/identity suites, full frontend, lint/typecheck/build. Refresh inventory/anchors, update S02 ledger/matrix and report/planning. Existing2066/15998 backend O41 is historical evidence, no new backend gate.
- [x] Close only local O42; S01–S13/global/CI/operation/retention/capacity remain open. No browser QA credited for unchanged DOM/CSS.


## Cierre local


## O42 — transporte Auth de eliminación separado (04/10)

AccountDeletionService contiene sólo los dos transportes impact/request. Los dos cuerpos de Auth conservan literalmente generación/assertCurrent/return tras adaptar la llamada; también6export+4sesiones+3TXbackend intactos. Auth652→648líneas, AuthController1408/baseline152/141 sin cambios.24contratos HTTP/API/interceptor/Auth y12caller nuevos =36 antes/después;199dedicados/1371fullfrontend9,386sKarma8,742sexec/lint/tipos/build10,679s exit0. Inventario475/2268/1165/3/0provisional y475hashes/353S01/16S03/63S10/151S02anchors en20archivos; inventario no equivale a cierre. Detalle/logs `.uvh-runtime/s02-auth-deletion-*`, comparación literal `.uvh-runtime/verify-auth-deletion-transport.py`.

Fixtures corregidos antes de acreditar36positivos: expected mfaEnabled del escenarioMFA, blocker status válido submitted y ACKliteral requested para TypeScript. No BugID por estos ajustes ni red de producto por extracción. Caller retryGET, blockers/acknowledgement/credenciales/factor/inflight/destroy/secretcleanup yerror malformed ejercitados con componente real/MatDialogRefstub. No cambio DOM/CSS/decoder/seguridad del servidor, no nueva QA/DB/provider/cookie nativa; backend2066/15998O41 es evidencia previa. Sin commits/push/deploy/datosreales/workers. Todas ejecuciones propias cerradas.

**Objetivo/S01–S13 siguen abiertos.** Próximo candidato: checkImpact dice «No se ha enviado ninguna solicitud» incluso después de POST con outcome incierto y retryGET fallido; reproducir antes de ID/fix. Restantes funciones/roles/retención/capacidad/CI/operación siguen pendientes.
