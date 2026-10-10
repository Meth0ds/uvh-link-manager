# O103 — Dashboard and link-detail read ownership

Execute inline; no delegation, commit, deployment or shared service mutation. This completes the read portion of opportunity25; the global nine-phase plan remains active.

**Goal:** Cancel superseded GETs and reject queued success/error/finally results after actor, session, workspace revision, role or reused route changes. Preserve independent dashboard retries, period ownership, detail/activity/analytics, copy and all mutations.

**Source:** Dashboard's two reads use only workspace ID and loadedWorkspaceId. LinkDetail's three reads use workspace/link IDs; route revision already exists for clipboard and decisions. LatestRequest correctly aborts/revises and checks destruction, but cannot distinguish contexts omitted by its caller. Auth sessionGeneration and Workspace selectionGeneration/currentRole are reactive. No server authorization bypass established.

## Implementation

- [x] Freeze416frontendfiles and preserve both prior component sources under .uvh-runtime/o103-view-reads; owned Karma port9996.
- [x] Create frontend/src/app/panel/dashboard/view-read-ownership.spec.ts. Real component controllers/signals with deferred API promises; real reused detail route. Test success and failure for coalesced workspace A→B→A, renewed session, different account, role change and logout in dashboard, initial detail and auxiliary reads. Check old AbortSignals, replacement read counts, payload/errors/loading, no auxiliary fetch from old detail, null actor/no workspace/invalid route, destroy and unchanged-account controls. Existing O102 decision tests remain gates.
- [x] Run red on this spec; current contexts must demonstrably accept stale values or fail to replace/cancel reads. Repair only fixture failures before changing product.
- [x] Dashboard: replace loadedWorkspaceId with loadedContext. Use one private context everywhere, null without actor/workspace; otherwise JSON.stringify([actorId,sessionGeneration,workspaceId,selectionGeneration,currentRole]). Effect invalidates both request lanes and clears data/errors before loading replacement. Begin and all completion guards use the same context, including direct retry calls.
- [x] LinkDetail: extend currentContext with actor/session/workspace/revision/role/route revision/link ID and use it in effect plus every begin/completion check. loadedContext starts undefined so initial null/invalid contexts still clear loading. All three read methods reject null actor/workspace/link ID. Capture activity link ID before HTTP. Keep route-null error and independent retries. No POST/DELETE cancellation.

```ts
private currentContext(): string | null {
  const actorId = this.auth.user()?.id;
  const workspaceId = this.workspaces.currentId();
  if (actorId === undefined || workspaceId === null) return null;
  return JSON.stringify([actorId, this.auth.sessionGeneration(), workspaceId,
    this.workspaces.selectionGeneration(), this.workspaces.currentRole()]);
}
// Detail additionally includes copyRouteRevision() and linkId().
```

- [x] Reuse currentContext in detail decisionContext plus shortUrl, preserving stricter decision identity without duplicating actor/workspace fields. Do not change generic targetWorkspace semantics.
- [x] Extend the two existing dashboard fixtures with real reactive session/selection generations and role; no production fallbacks for incomplete mocks. Run new+dashboard+O102+clipboard green, then serial typecheck/lint/full frontend/production build with a new freeze. No product/spec edit during QA.
- [x] Verify backend542hashes unchanged, regenerate global inventory from O99 PHP capture and verify all inventory hashes. Confirm runner terminal and port9996free; save summary and update global ledgers. Report cancellation/context correctness, no invented CPU/latency measurements.

## Verified result

43newcontracts; red43/35fail/8controls after repairing a union-type test fixture, green90/90 including previous dashboard/reused-route/clipboard/decision contracts. Full frontend2046/2046 and serial typecheck/lint/production build exit0.417frontendhashes and542backendhashes verified; exactly two product files, two existing fixture files and one new spec differ from baseline. Inventory522files/2529named/1384anonymous/3signatures/0provisional, every hash current. Session2550terminal0, port9996free. Actor/profile controls preserve reads, session/selection/role/route changes cancel and reject old results, null actor/workspace and invalid routes make no requests. No write cancellation or generic workspace-helper change. Global plan remains active.
