# Privacy rights feedback and case reading implementation plan

> **For agentic workers:** Use executing-plans inline. No subagents, commits, worktrees, control launchers, production data/mail/provider writes or deployment. Stop owned tests/build/QA fixtures before product edits.

**Goal:** Make privacy-rights submission, response, cancellation and operator decisions trustworthy and understandable, with acknowledgement validation, preserved drafts and clear case guidance.

**Architecture:** Extend the existing privacy response decoder with correlated creation and action acknowledgements. Account mutations own their forms and feedback until the awaited response is validated. Operator prompts retain unconfirmed drafts in memory per case/action and clear them with session context. The existing backend workflow, calendar-month deadlines, encrypted messages and outbox are preserved; publicly available complaint/contact guidance accompanies cases.

**Tech Stack:** Angular signals/reactive forms, Material dialogs, pure TypeScript decoders, CSS, Jasmine, copied production build with fake loopback API. Pure PHP rendering helper/tests only if mail copy changes; no application or DB boot.

**Spec:** Full active frontend/legal objective; RGPD art12 (BOE DOUE-L-2016-80807), actual PrivacyRightsController responses and current 2026-10-09 clauses. This work supports rights exercise but does not prove external mailbox operation, real provider contracts, DSA classification or formal notice/decision procedures.

## Constraints

- Current Terms/Privacy clauses, copies, versions and accepted history remain unchanged.
- No false success on malformed/wrong-context acknowledgement; no draft cleared before confirmed admission. An ambiguous failure must recommend checking case state before repeating.
- Actor changes/destroy invalidate pending work, receipt, forms and private operator drafts. Controls must recover on failure/context replacement.
- Match creation's returned type/status and admin action's expected resulting status; generic account response/cancellation requires `{ok:true}`.
- Preserve server-enforced month deadlines and extension decisions. Waiting for information must not be presented as automatically pausing the deadline.
- Existing design tokens, keyboard focus, 320px mobile, both themes and reduced motion; feedback follows actual actions.

### Task 1: Admission regressions and response contracts

- [x] Add/run failing account regression tests for malformed creation, response and cancellation acknowledgement; preserve fields/composer and avoid success snackbar.
- [x] Add creation/type/status and operator action/status decoder tests.
- [x] Apply acknowledgement guards after current-owner checks. Lock forms during mutation and recover them on failure/new owner. Separate action labels and inline unconfirmed feedback.
- [x] Retain operator drafts on unconfirmed updates, reload authoritative case state and prefill a retried prompt; erase private drafts on actor reset.

### Task 2: Case reading and UX

- [x] Add creation receipt with real case ID/deadline and accessible focus, type-specific guidance, clear response/cancel controls, empty/loading/error states, and policy/contact/complaint links.
- [x] Keep actual status visible when overdue; show an additional deadline warning rather than replacing the case status. Explain waiting, extensions and terminal states without claiming automatic fulfilment of the right.
- [x] Label system messages as system messages on account/admin views, preserve multiline content and use plain unavailable-message guidance.
- [x] Refine layout and deliberate receipt/composer transitions with reduced-motion alternatives; scoped styles and stable button dimensions.
- [ ] Conditional rejection-email copy deferred to the broader outbox/communication review. No mail helper changed in this lot; never expose request content in email.
- [x] Correct stale evidence matrix rows on published versions/cookies; retain genuine operational gaps.

### Task 3: Verification and full-goal continuity

- [x] Full frontend tests/build/lint/types; meaningful dedicated behavioral cases and pure backend tests if changed.
- [x] Freeze/copy build and run owned fake API cases across both themes, widths, receipt/error/pending/reply/cancel and operator draft retry. Inspect screenshots, keyboard and selected axe audits. No real accounts or messages.
- [x] Close owned processes; verify freeze and unchanged clauses/copied hashes. Record results and full remaining legal scope; goal stays active until all requirements are proved.

## Execution checkpoint — 9 October 2026

The account/operator UX tasks and verification are complete for this lot. Nineteen new meaningful frontend regressions cover malformed acknowledgements, correlated creation/status, owner replacement, draft lifetime, multiline messages and dialog abort. The final shared tree also includes O83's two chart regressions: 1,828/1,828 frontend tests, build/lint/types/diff check exit0. Pure unchanged-document contract: 2 tests/97 assertions, read-only PHP with no DB/application boot.

Owned fake-API browser QA: 48 account cases/514 checks plus 6 operator cases/78 checks; both themes, 1440/390/320px, pending/error/receipt/reply/cancel, draft retry and selected axe audits. Real issues repaired: receipt focus outside the scroll viewport, missing email underline, and keyboard access to scrolling case threads. Native receipt/admin screenshots inspected. All owned processes and browsers closed; final 383 frontend source hashes unchanged. Published clauses/versions/archive hashes remain unchanged. Evidence: `.uvh-runtime/o82-privacy-rights-ux/verification-summary.json`.

The conditional email task remains pending, together with the prior objective's external legal/operational facts. Completing this lot does not complete or certify that broader objective.
