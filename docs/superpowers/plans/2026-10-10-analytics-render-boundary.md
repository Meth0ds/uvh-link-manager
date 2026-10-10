# O101 — Analytics render boundary Implementation Plan

> **For agentic workers:** Execute inline with executing-plans, using terminal checkpoints. Do not delegate or commit in this shared dirty checkout.

**Goal:** Avoid repeated rendering work in an unchanged analytics chart when its parent updates unrelated UI, preserving all displayed metrics and interactions.

**Architecture:** ChartsComponent already caches derivations with computed signals, but Eager still calls template formatters for each daily row and bar on each parent check. Review confirms Dashboard, Analytics and LinkDetail replace immutable decoded overview snapshots. Use OnPush only for this component after measuring real Angular parent/child behavior; do not apply a global strategy migration or duplicate computed caches.

**Tech Stack:** Existing Angular22 signals, Jasmine/Karma and ChromeHeadless; no dependencies.

**Spec:** Global optimization plan2026-10-09 and direct source review of charts.component.ts/html plus its three callers.

## Global Constraints

Preserve functions, UI, SVG paths, number formatting, accessibility, native details/table, all six dimensions and showBreakdowns. Public contracts stay unchanged. No product/spec edits while any owned QA/build runner is active. Source hashes must match; use private Karma port9992 and owned runtime logs/build output. No shared services, migrations, real mail/webhooks, commit or deployment. Full nine-phase goal remains active.

### Task1: Measure and establish the unchanged-input render contract

**Files:** create frontend/src/app/panel/analytics/charts-render-boundary.spec.ts; runtime .uvh-runtime/o101-chart-render; modify only charts.component.ts after the failing baseline run.

**Interfaces:** consumes overview=input.required<AnalyticsOverview>() and showBreakdowns=input(true). Parent probe is Eager and holds overview/show/unrelated signals, passing the first two to the real ChartsComponent. Use actual DOM and formatCount/dayLabel/pct spy call counts; no replica of chart algorithms or forced child detectChanges.

- [x] After O99 QA reaches terminal, freeze current frontend sources/configs and save charts.component.ts baseline in owned runtime. Keep existing baseline build from O100 as evidence only; source changes require fresh build.
- [x] Add parent probe and seven contracts: unchanged inputs for0/1/180daily rows; new snapshot updates totals/path/table/bars; toggling breakdowns; two charts with independent overview updates; native details remains open and table track identity survives a replacement with same day. Use eight categories per dimension, matching AnalyticsController LIMIT8. No timing claim.

```ts
@Component({ standalone: true, imports: [ChartsComponent],
  changeDetection: ChangeDetectionStrategy.Eager,
  template: '<span>{{ unrelated() }}</span><app-charts [overview]="data()" [showBreakdowns]="show()" />' })
class ParentProbe {
  readonly unrelated = signal(0);
  readonly data = signal<AnalyticsOverview>(fixtureOverview(180));
  readonly show = signal(true);
}
// After initial parent rendering, reset spies, take the chart DOM snapshot,
// update only unrelated40times and fixture.detectChanges(). Capture counters
// and DOM; assert formatCount/dayLabel/pct have no extra calls, DOM unchanged.
```

- [x] Run ChromeHeadless only the new spec plus existing charts specs under private port9992. Preserve red log and every failure reason. Baseline counters must be nonzero on Eager for stable input; capture actual DOM for before/after comparison.

### Task2: Adopt the measured component boundary and verify compatibility

- [x] Change exactly the component strategy:

```ts
changeDetection: ChangeDetectionStrategy.OnPush,
```

- [x] Repeat contracts and compare captures: same initial/rendered DOM for each fixture, zero additional formatter/percentage calls for40unrelated parent updates. Fresh overview/show signals must still update promptly. Existing computed-derivation tests remain.
- [x] Run typecheck, lint, whole frontend suite and production build serially; preserve terminal exits, review warnings/skips and freeze hashes. Update global function inventory using current PHP capture only if all PHP source hashes still match. Record projected savings as call counts, not latency/CPU/LCP or a new bundle-size improvement.
- [x] Verify all owned runners have ended and port9992 has no listener; save summary and update global plan/findings. O97, CSV backend and request-context gaps remain pending, not implicitly closed.

## Verified results

New7/targeted9/full1983frontend tests pass. Baseline9:4failures (three unchanged-input cases and independent chart), all expected repeated formatting;7new contracts preserved UI and actual native disclosure. Across40unrelated Eager parent checks:180days33040format/160date/3840percentage calls→0;1day4400/160/3840→0;empty80/0/0→0. Before/after canonical renderedDOM identical for3fixtures, retaining geometry, styles, text and accessible attributes. New snapshots and showBreakdowns continue to render, two charts stay independent, tracked table rows/details state preserved. Only product change is Eager→OnPush on ChartsComponent. Types/lint/build/diff pass,415frontendhashes/542backendhashes/522inventoryvalid(0provisional), QA70476terminal0/port9992empty. No CPU/timing/LCP/bundle saving claimed. All other global phases remain pending.
