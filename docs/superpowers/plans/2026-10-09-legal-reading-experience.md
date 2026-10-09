# Legal Reading Experience Implementation Plan

> Execute inline with executing-plans in the authorized checkout. No delegation, branch/worktree changes, commits or deployment. These session constraints override skill defaults. This is phase2 of the full objective; its success does not close legal rewriting/compliance or broader frontend work.

**Goal:** Redesign the legal reading experience with a searchable chapter index, compact mobile outline, complete-document printing and an explicit retry for unavailable public identity.

**Architecture:** Share LegalDocumentNavigationComponent across Terms/Privacy; chapter content remains in each document. Filter only navigation, never contract clauses. Existing LegalShell owns routing offset/menu/theme. Reuse ApiService timeout and decoder for identity; service continues deduplicating reads and exposes an error plus retry(). No new dependencies or timers.

**Tech Stack:** Angular22/TypeScript/SCSS/Material icons, existing Manrope and public identity tokens.

**Spec:** .planning/2026-10-09-uvh-legal-ux-spain-eu/task_plan.md retains full human objective: considerable frontend/UX improvements plus extensive accurate Spanish/EU documents. Facts/code and official sources in findings.md. Future payment confirmed; remaining operator facts being obtained. No policy-version bump or substantive clause replacement in this first UX lot. The following redaction/versioning lot must correct the stale localStorage statement and current unconfirmed operational claims, archive old docs, and synchronize backend/frontend acceptance.

## Design

Existing UVH paper#f5f2e9/raised#fffcf5/ink#262821/muted#626357/accent#b53c20/guide#e5e8dc and dark tokens. Manrope16px reading/13–14px metadata, headings36–56px. A reading column max75ch, an outline with an explicit search, and an understated printer control. Mobile defaults to a collapsed outline rather than14 links before the text. Do not redesign into generic equal cards. Tables use semantic HTML in the redaction lot. Single entrance, icon transforms180ms responding to action, no padding animations; focus44px and reduced motion. Print black on white, hide navigation/menus/toolbar, preserve every clause and metadata, no theme-dependent illegibility.

```
Title / document date / concise purpose | summary
Identity state / retry
Outline [search chapters] [print] | complete clauses, readable width
Mobile: outline toggle -> complete clauses
Print: title + identity + all clauses -> contact, no app navigation
```

Self-review: prioritize useful legal lookup and saving a complete document. Preserve all anchor IDs/clauses/version markers in this presentation lot; no falsely current rewritten policy. The outline search does not claim full-text search and doesn't hide the document.

## Task1 — Searchable legal outline and printing

Create frontend/src/app/legal/legal-document-navigation.component.ts/.scss and .spec.ts. API:
```ts
export interface LegalSection { readonly id: string; readonly title: string; }
readonly sections = input.required<readonly LegalSection[]>();
readonly query = signal('');
readonly expanded = signal(false);
readonly filtered = computed(() => this.sections().filter(s => fold(s.title).includes(fold(this.query()))));
function fold(s: string): string { return s.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase('es').trim(); }
print(): void { this.document.defaultView?.print(); }
```
- [ ] Write meaningful failing tests: accent-insensitive lookup, no-match reset/focus, expand/collapse ARIA, no mutation of section input, print invokes native complete-document action, resize doesn't hide focused search.
- [ ] Run targeted Karma red; stub provides interface but no behavior.
- [ ] Implement semantic nav/search/native buttons/RouterLink and shared styles. Search filters index only, mobile collapsed by CSS; desktop shows it always. On mobile resize while focus is inside, expanded becomes true. No observers/RAF/timers.
- [ ] Replace only old nav blocks in Terms/Privacy; explicit arrays preserve each14 IDs. Terms/Privacy imports standalone child; related contact sidebar retained. Header reading/spacing and print stylesheet rebuilt deliberately.

## Task2 — Honest identity state and retry

Modify legal-identity.service.ts; create legal-identity.service.spec.ts with real ApiService+HttpTestingController. API:
```ts
readonly error = signal<string | null>(null);
retry(): Promise<void> {
  if (this.loading) return this.loading;
  this.loaded = false;
  return this.load();
}
```
- [ ] Red tests: pending loads coalesce/cache on successful complete projection; successful null distinguishes unconfigured from GET error; retry reloads null and deduplicates; malformed projection never becomes identity; existing20s ApiService timeout cancels held HTTP and exposes retryable error.
- [ ] Implement error reset/catch and retry; retain decoder, do not invent controller identity or providers. Cache good successful identity.
- [ ] Terms/Privacy show separate technical failure versus no identity published. Retry is disabled while new read is pending; existing role status/alert remains coherent. Provider identity itself stays dynamic.

## Task3 — Verification

- [ ] Targeted tests, then frontend suite; build/lint/typecheck and diff whitespace. No tests that merely assert CSS.
- [ ] Copy immutable production build and freeze owned source hashes; own loopback synthetic server, never shared control or real backend/provider.
- [ ] Both docs at1440/1024/768/390/320, light/dark, populated/null/error/held config, chapter search/reset, keyboard/mobile toggle/focus, all preserved anchor targets, print media including every clause/reduced motion.
- [ ] Compare actual legal clause text and version markers byte-for-byte to baseline (only nav/shell may differ in this first lot), existing specs intact, all own processes terminal.
- [ ] Update full goal progress and proceed to redaction/versioning and additional frontend improvements. Keep goal active while legal facts/requirements are incomplete.
