# Token refinement Implementation Plan

> **For agentic workers:** Execute inline with checkpoints. Generic subagent/worktree helper skills are unavailable; preserve the current checkout on its dedicated codex branch. No commits or external writes are authorized for this batch.

**Goal:** Make the existing token page readable and usable at narrow widths without changing credential behavior.

**Architecture:** Keep TokensComponent methods and API contracts intact; refine HTML/SCSS. Extend only the explicit design-preview entry point with decoded fictional token reads. Use its existing scenario controls for populated/empty/error/loading.

**Tech Stack:** Existing Angular, Angular Material, SCSS, Karma. No new dependencies.

**Spec:** docs/design-system.md and .agents/skills/uvh-editorial-design/SKILL.md.

## User scope addition
Estado de ejecución: tareas 1 y 2 completadas y verificadas en el primer lote.
Continuación completada: `/status` e inspector de webhooks; resultados exactos
en `docs/redesign-checkpoint-2026-09-08.md` y `progress.md`. `task_plan.md`
contiene el estado activo y el siguiente lote; no interpretar las casillas
originales de este documento como una orden para repetir trabajo.

The user explicitly requested complete 403/404 redesign during implementation.
Add status-page.component.html/.scss, keep kind selection from existing route data,
use fixed RouterLinks only and never echo query/fragment. Give 403 workspace/access
guidance and 404 address/recovery guidance, reuse PublicThemeToggleComponent.
Test single main/h1, safe destinations, skip focus and non-reflection of private data.
Route titles are descriptive; guards and authentication remain unchanged.

## Global Constraints
- Current 3px geometry and central color tokens; Manrope and monospaced annotations.
- No database, credential issuance, deletion, network receiver or production route changes.
- Existing password/MFA requirements and scope values remain unchanged.
- Automated validation at the end, no claim of production readiness.

### Task 1: Token surface
**Files:** frontend/src/app/panel/tokens/tokens.component.html and .scss.
**Interfaces:** Existing name/expiresAt/password/factorCode/selectedScopes/creating/plainToken/tokens/loading/error signals; existing create/revoke/copyPlain methods unchanged.
- [ ] Split issuance into named permission and confirmation sections. Add registry heading, busy label and single-use status semantics.
- [ ] Replace nested fixed-width form flex with `grid-template-columns: minmax(0, 1fr) minmax(0, 240px)`; at 640px use one column. Use `min-width:0; width:100%` on fields.
- [ ] Replace token row with `38px minmax(0,1fr) auto`; at 640px put action in column 2 with no percentage width or left margin. Wrap names, scopes and secrets.

### Task 2: Isolated fixture and validation
**Files:** frontend/design-preview/main.ts, workspace-preview.component.ts, workspace-fixture.ts, README.md; docs/redesign-checkpoint-2026-09-08.md.
**Interfaces:** fixtureRead consumes path/params/decoder/abort signal; `/api/v1/tokens` yields `{tokens: ApiTokenDto[]}` only in preview. All writes still reject.
- [ ] Import TokensComponent in the preview wrapper, add tokens route, provide safe fictional reads for long names and revoked state.
- [ ] Run `node node_modules/typescript/bin/tsc --noEmit -p design-preview/tsconfig.json`, application typecheck and targeted ESLint.
- [ ] Run focused token/credential tests in ChromeHeadless, plus production build.
- [ ] Inspect actual rendered light/dark at 320/768/1024/1440, safe keyboard scope selection and error/loading/empty. Do not enter authentication factors or generate/revoke credentials.
- [ ] Record outcomes and any unverified states. No automatic git commit.
