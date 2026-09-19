# Task Plan: UVH refinement after user commits (2026-09-13)

## Goal
Continue the full UI redesign, preserving user progress and verifying each page, component, subpage and modal. Tokens and 403/404 are completed batches, not the end of this goal.

## Next Step
Continue the route-level UX audit with Activity and Usage, prioritizing scanability, honest empty/error states and narrow-screen controls. Automated suites remain paused.

## Current Phase
Phase 8

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
- [x] Review and refine webhook list/form; inspect shared delete confirmation.
- [x] Add isolated preview coverage and validate the batch at the end.
- **Status:** complete

### Phase 6: Remaining workspace and security modals
- [ ] Review workspace, MFA and invitation surfaces from current commits.
- [ ] Refine and verify without issuing credentials or changing accounts.
- **Status:** in_progress

### Phase 7: Settings sensitive-action flows
- [x] Move account deletion, email access, password change and data export into guided dialogs.
- [x] Separate password and 2FA into distinct steps and clear secrets on every exit/error path.
- [x] Polish workspace-menu hierarchy, focus management, motion and 320px layouts.
- **Status:** complete

### Phase 8: Remaining page UX audit and redesign
- [x] Inventory current panel routes and identify the least-refined high-impact page.
- [x] Rebuild its information architecture, responsive states and interactions.
- [x] Validate statically and in the isolated preview without real mutations.
- **Status:** complete

### Phase 9: Activity and usage refinement
- [ ] Audit the real data contracts and existing interaction states.
- [ ] Refine the highest-value shared or route-level UX gaps.
- [ ] Validate statically and in the isolated preview without real mutations.
- **Status:** pending

## Decisions Made
- Settings: account identity masthead, dedicated profile/email rows, visual theme choices and readable ruled security/privacy sections. Preserve all forms and security contracts; no real account changes.
- Preserve user commits, 3px geometry, current colors, Manrope and security logic.
- Work on codex/redesign-polish-2026-09-13; no pull/push/commit/merge.
- No DB, backend startup, migrations, real credentials or token issuance.
- Use inline implementation; subagent/worktree/finishing helper skills referenced by generic planning guidance are unavailable. No new agents are needed for this bounded batch.

## Errors Encountered
- Resumed session lost preview/browser and previous build handle. Read-only port check confirmed no listener; started preview again. Rebuilt production after latest template edit, passed.
- New inspector test double initially violated ApiService.get's generic signature. Corrected it to invoke the supplied real decoder, without a type assertion.
- Two apply_patch batches failed context matching; neither partially applied. Corrected exact contexts and reapplied.
- Preview first navigation timed out during Vite initialization; fresh DOM verified the target page loaded.
- Initial combined skill read truncated; reread selected content before implementation.
- agent-browser is not on PATH; use existing supported browser integration, without installing packages.
- One settings focus patch could not acquire the file on its first write attempt; it made no partial change and the immediate scoped retry succeeded.
- Typecheck found pre-existing nullable currentId in preview getting-started fixture. Narrow explicitly and fail closed when null; corrected.
- A search used frontend-prefixed paths while cwd was frontend; reran with relative paths.
- Browser locator evaluation timeout after a successful checkbox action; fresh AX confirmed state, no repeated action.
- Karma warned about slow Chrome shutdown after 13 successful tests, but eventually returned exit 0.
- The first PowerShell route/style inventory used a double-quoted regex containing pipes and was parsed as an empty pipeline. No files changed; reran with single-quoted patterns successfully.
- A model-location search included a nonexistent `core/models/*.ts` path after already finding `core/models.ts`; the valid file returned the needed contract, so the bad glob was dropped.
- The first isolated-preview typecheck referenced `design-preview/tsconfig.app.json`, which does not exist. The Angular target points to `design-preview/tsconfig.json`; rerun uses that file. No source files were affected.
- A findings update used an earlier sentence wording and failed context matching; `apply_patch` made no partial change. Reapplied against the current text.
- A combined browser-findings update used earlier progress-log wording and failed context matching; it made no partial change. Reapplied with the current checkpoint text.
- The first preview scenario locator searched for a labelled form control, but the toolbar exposes semantic buttons. It timed out without acting; a DOM snapshot identified the correct button role and the single retry succeeded.
- The first post-edit empty-state wait ran while the unusually slow preview HMR rebuild was still active, so the new node was not present. Waited for the rebuild completion and then verified the state once; no source change was needed.
- Two broad source searches included nonexistent optional paths (`frontend/src/app/shared` and root-level `frontend/styles.scss`). Each still returned the valid panel or `frontend/src/styles.scss` match needed; no file changed and the bad paths were dropped.
- The final line-number lookup used a PowerShell double-quoted regex and escaped quotes were parsed incorrectly. Repeated only that read-only lookup with a single-quoted pattern; no files were affected.
