# Legal reading and trusted report feedback implementation plan

> **For agentic workers:** Use executing-plans inline. No delegation, commits, control launcher, remote deploy or real DB/mail/provider writes. Preserve existing work and stop owned verification processes before source edits.

**Goal:** Make long legal documents easier to navigate with deliberate microinteractions, and prevent a public report from showing success before its response confirms admission.

**Architecture:** The shared legal index measures only the current document's sections, batches geometry reads in one animation frame, and cleans up observers/queued work on teardown. The report decodes the existing public acknowledgement before clearing fields or presenting its receipt. No scroll information is stored or connected to legal acceptance.

**Tech Stack:** Angular, signals, native DOM geometry, ResizeObserver, shared response decoder, CSS, Jasmine, owned static build and fake loopback API.

**Spec:** Original active legal/frontend goal and the user's explicit preference for substantial, carefully designed microinteractions. DSA intake, acknowledgement and decision communication remain separate full-scope requirements; this lot does not claim to complete them.

## Global constraints

- Current accepted document version remains 2026-10-09; clauses stay byte-for-byte unchanged.
- Respect reduced motion; no live announcement on every scroll; native fragment links and keyboard focus remain usable.
- Track current document only, avoid fetch/URL/destination requests for reading and receipt feedback.
- Fake HTTP responses for QA; no actual public reports, account changes or emails.

### Task 1: Receipt integrity

**Files:** report.component.ts/html/scss, report.component.spec.ts, docs/design-system.md.

- [x] Add behavioral regression cases: `{ok:false}`, `{}`, `null`, string and numeric/string truthy `ok` must never mark done or discard fields.
- [x] Run them against the current implementation and inspect behavioral failures.
- [x] Apply `decodePublicActionAcknowledgement(response)` after the awaited report call and before any success state. Preserve error/fields and reset the one-use captcha after every attempted send.
- [x] Show the normalized submitted short reference as plain text in the confirmed receipt. A check stroke animates only on admission; repeat action clears the receipt snapshot.
- [x] Verify valid, malformed, pending, rejection, teardown and focus behavior, plus both themes/mobile/motion in an owned browser fixture.

### Task 2: Reading position and action transitions

**Files:** legal-document-navigation.component.ts/scss/spec.ts; no clause edits.

- [x] Record user microinteraction preference in the project design system.
- [x] Add document-scoped current chapter and reading position. Clamp to0–100, keep the initial chapter at the top, complete only when the final clause's bottom is in view. Label as visual document position.
- [x] Update one `aria-current="location"` from geometry rather than retaining a stale hash marker after the reader scrolls. Searching filters only the index.
- [x] Batch scroll/resize work in one queued frame. Observe content/header height for font/layout shifts. Cancel pending frame and disconnect observer on destroy; a delivered stale callback must do nothing.
- [x] Animate progress using scaleX; morph the mobile toggle plus/minus and animate the opening index without dropping focused controls on resize. Reduced motion disables these transitions.
- [x] Test scrolling, scope, bounds, filtering, focus preservation and teardown with controlled DOM geometry. Keep existing index tests green.

### Task 3: Integration verification and continuity

Latest user steering extends this lot across the panel. Add a shared, view-scoped clipboard feedback service and icon to dashboard, links and link detail: pending, acknowledged success and recoverable failure. Preserve native clipboard activation, coalesce concurrent writes, expire hung permission prompts, discard callbacks after session/workspace/route changes or destruction, and clear timers. Test deferred resolution, rejection, synchronous failure, timeout and stale ownership. Add fine-pointer hover, keyboard focus and press feedback to shared panel controls without moving disabled/busy controls or creating idle animation. Verify real copied-build interactions with a fake API and controlled clipboard; no production data writes.

- [x] Run full frontend suite, production build, lint, types and diff check after source edits finish.
- [x] Freeze and copy the built assets, inspect native browser actions and run matrices across both documents/themes/widths/motion and report response states. Inspect screenshots and axe for the changed surfaces.
- [x] Stop owned fixture/browser/test processes; verify source freeze and unchanged clauses/copied version hashes.
- [x] Update planning and evidence matrix: report response integrity improved, reading UX improved; formal notice intake/acknowledgement/decision resources and unverified operational facts remain pending. Keep the full goal active.


## Verified outcome — O81

- Six acknowledgement regressions failed against the original report implementation; fields were cleared despite `{ok:false}` or malformed envelopes. All are green after decoding the acknowledgement.
- Final frontend: 1,807 tests (22 new behavior cases), production build, lint and types exit0. Pure document contract:2tests/97assertions exit0; no application/DB boot.
- Browser:72 cases /763 checks: legal24/269, desktop panel12/146, touch panel12/183, public report24/165. Both themes, narrow widths including320px, reduced motion, pending/error/success and stale workspace results. Selected axe audits have no serious/critical findings; no page errors. Source freeze659files unchanged; clauses unchanged. Screenshots inspected.
- Clipboard success waits for the browser acknowledgement, uses stable-width detail actions, and temporarily disables the other copy controls in that view to avoid silent ignored clicks. Reused detail route round trips invalidate prior acknowledgements.
- Browser QA is a copied immutable build and fake loopback API. hCaptcha is a controlled frame fixture, not a real vendor challenge. Automated pointer clicks on its small mock button sometimes returned without emitting click/verified (observed in its counter/message trace); the report response matrix uses native focus + Space to activate it. No conclusion about the real vendor is drawn from that fixture limitation.
- All owned runners, native agent-browser session and fixture server closed; intentional fixture interrupts exit130. No production data, email or provider writes and no remote deployment. Evidence: `.uvh-runtime/o81-reading-feedback/verification-summary.json` and stage logs/results.
- This frontend lot is complete. The original legal/frontend goal remains active: real address/mail/provider/contracts/bases/retention and formal notice/decision communication remain separate gaps.
