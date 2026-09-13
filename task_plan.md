# Task Plan: UVH refinement after user commits (2026-09-13)

## Goal
Continue the full UI redesign, preserving user progress and verifying each page, component, subpage and modal. Tokens and 403/404 are completed batches, not the end of this goal.

## Next Step
Review the webhook listing/form and integration modals, preserving security semantics and existing user changes.

## Current Phase
Phase 5

## Phases
### Phase 1: Current-state review
- [x] Inspect clean main at a9e69db and recent design commits.
- [x] Read design-system.md and repository design skill.
- **Status:** complete
### Phase 2: Token refinement
- [x] Apply responsive layout, semantic sections and meaningful feedback.
- [x] Extend isolated preview without production routes or API writes.
- [x] Rebuild 403/404 with distinct guidance, safe fixed internal destinations, shared theme control and responsive composition.
- **Status:** complete
### Phase 3: Validation and handoff
- [x] TypeScript, focused lint/tests, production build, browser light/dark and narrow layouts.
- [x] Update checkpoint and report remaining scope honestly.
- **Status:** complete

### Phase 4: Public status and webhook inspector
- [x] Rebuild /status with shared public identity and clear source/timestamp/unknown guidance.
- [x] Improve inspector endpoint, delivery records and safe payload disclosure.
- [x] Extend isolated fixtures, add focused tests, validate browsers/build and record remaining scope.
- **Status:** complete

### Phase 5: Remaining integration surfaces
- [ ] Review and refine webhook list/form and integration modals.
- [ ] Add isolated preview coverage and validate the batch at the end.
- **Status:** in_progress

## Decisions Made
- Preserve user commits, 3px geometry, current colors, Manrope and security logic.
- Work on codex/redesign-polish-2026-09-13; no pull/push/commit/merge.
- No DB, backend startup, migrations, real credentials or token issuance.
- Use inline implementation; subagent/worktree/finishing helper skills referenced by generic planning guidance are unavailable. No new agents are needed for this bounded batch.

## Errors Encountered
- New inspector test double initially violated ApiService.get's generic signature. Corrected it to invoke the supplied real decoder, without a type assertion.
- Two apply_patch batches failed context matching; neither partially applied. Corrected exact contexts and reapplied.
- Preview first navigation timed out during Vite initialization; fresh DOM verified the target page loaded.
- Initial combined skill read truncated; reread selected content before implementation.
- agent-browser is not on PATH; use existing supported browser integration, without installing packages.
- Typecheck found pre-existing nullable currentId in preview getting-started fixture. Narrow explicitly and fail closed when null; corrected.
- A search used frontend-prefixed paths while cwd was frontend; reran with relative paths.
- Browser locator evaluation timeout after a successful checkbox action; fresh AX confirmed state, no repeated action.
- Karma warned about slow Chrome shutdown after 13 successful tests, but eventually returned exit 0.
