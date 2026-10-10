# O102 — Link decision ownership Implementation Plan

> **For agentic workers:** Execute inline using executing-plans and terminal checkpoints; no delegation or commits in the shared checkout.

**Goal:** A delayed confirmation must never delete or appeal a different link after route reuse, and old mutation/dialog results must not affect a newer view.

**Architecture:** LinkDetail currently captures only targetWorkspace before await, then interpolates the current this.linkId(). Keep generic targetWorkspace unchanged (its ABA policy is intentional for other consumers). Introduce a private link-decision target carrying immutable linkId and a strict local identity: account ID, sessionGeneration, workspace ID/selectionGeneration, role, route revision, current link ID and shown short URL. Guard both dispatch and completion, including destruction. Do not abort writes already admitted by the server. The separate read-context gap in Dashboard/LinkDetail remains pending.

**Tech Stack:** Existing Angular22 signals/DestroyRef, RouterTestingHarness/Jasmine/Karma, owned port9994. No dependency or backend change.

**Spec:** Global optimization findings opportunity25; all431lines of LinkDetail and WorkspaceTarget/OwnedMutations reviewed. API keeps server authorization authoritative.

## Global Constraints

Preserve dialogs/copy/state/appeal/delete/edit, busy ownership and backend contracts. Keep exact action target immutable across await. Invalidated decisions send no mutation; submitted writes may complete server-side, but cannot publish notifications/navigation/reloads into a new view. Source/specs cannot change during owned QA. No shared DB/service/outbound, commits/deployment or generic workspace helper semantics changes. Global nine-phase goal stays active.

### Task1: Reproduce decisions that outlive their resource

**Files:** create frontend/src/app/panel/links/link-decision-ownership.spec.ts; modify LinkDetailComponent and extend existing link-copy-lifecycle.spec.ts AuthService mock only after terminal red.

**Interfaces:** real reused links/:id route via RouterTestingHarness; fake confirm/prompt promises and API spy; complete synthetic LinkDto/current authenticated actor. Existing dialog lifetime and actions unchanged.

- [x] Freeze415frontendfiles and prior detail source, owned QA port9994.
- [x] Add20cases: delete/appeal ×route change, route ABA, workspace ABA, session generation, account change, role reduction and destruction(14); unchanged decision controls(2); late submitted write after route change/destruction(2); editor late result(1); stale visible row immediately after route ID change before effect(1).

```ts
const pending = component.remove(); // dialog names /links/1
await harness.navigateByUrl('/links/2', LinkDetailComponent);
confirmation.resolve(true); await pending;
expect(api.delete).not.toHaveBeenCalled();
```

- [x] Run only new and clipboard specs; preserve red failure reasons. Account/role/destroy decisions must also send no request. Do not alter tests to accept dispatch to the originally captured link after invalidation.

### Task2: Capture once and guard the decision through completion

- [x] Add private target with immutable linkId and isCurrent. Capture account/session and copyScope plus role; reject null/mismatched route/loaded row, destroyed owner and missing write capability. Use captured linkId in setState/remove/requestReview API paths. Recheck target after dialogs and before notifications/navigation/reload; edit callback uses the same target.

```ts
const linkId = link.id;
const context = this.decisionContext();
return { linkId, isCurrent: () => !this.dialogOwner.destroyed
  && context === this.decisionContext() && this.linkId() === linkId
  && this.link()?.id === linkId && this.canWrite() };
```

- [x] Reset mutation ownership on destruction; keep already-dispatched POST/DELETE completion semantics intact. Extend clipboard test fixture with AuthService user/sessionGeneration.
- [x] Run green/clipboard contracts, typecheck, lint, full frontend and production build serially. Preserve hashes and actual terminal exits. Regenerate global inventory from unchanged PHP capture after verifying backend freeze542.
- [x] Verify own runners ended/port9994free, save summary and update global ledger. This fixes link decisions only, not all request ownership gaps or optimization phases.

## Verified result

20 new contracts; targeted red21/17fail/4pass after resolving snack-bar injector fixture, green21/21. Full frontend2003/2003; typecheck, lint and production build exit0. Frozen416frontendfiles and542backendfiles unchanged; regenerated inventory522files/2528named/1384anonymous/3signatures/0provisional with every hash checked. Own runner terminal and port9994free. Captured link ID, account/session/workspace/role/route ownership prevent invalidated decisions from sending a request and prevent late results from changing a newer or destroyed view. Submitted writes retain server completion semantics. Read ownership remains a separate pending item.
