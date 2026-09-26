import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import type { AnalyticsOverview } from "../../core/models";
import { ApiService } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { AnalyticsComponent } from "./analytics.component";

function overview(clicks: number): AnalyticsOverview {
  return {
    totals: { clicks, visitors: clicks }, series: [], topLinks: [], countries: [],
    devices: [], browsers: [], os: [], referrers: [], campaigns: [],
    visitorMetric: "daily_pseudonyms",
    dimensionTotals: { countries: 0, devices: 0, browsers: 0, os: 0, referrers: 0, campaigns: 0 },
  };
}

describe("AnalyticsComponent request isolation", () => {
  let fixture: ComponentFixture<AnalyticsComponent>;
  let api: jasmine.SpyObj<ApiService>;
  const workspaceId = signal<number | null>(1);

  beforeEach(async () => {
    workspaceId.set(1);
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get"]);
    await TestBed.configureTestingModule({
      imports: [AnalyticsComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: WorkspaceService, useValue: { currentId: workspaceId } },
      ],
    }).overrideComponent(AnalyticsComponent, { set: { template: "", imports: [] } }).compileComponents();
  });

  afterEach(() => fixture?.destroy());

  it("does not let a late workspace response replace the current metrics", async () => {
    let resolveFirst!: (value: AnalyticsOverview) => void;
    api.get.and.returnValues(
      new Promise<AnalyticsOverview>((resolve) => { resolveFirst = resolve; }),
      Promise.resolve(overview(2)),
    );
    fixture = TestBed.createComponent(AnalyticsComponent);
    fixture.detectChanges();

    workspaceId.set(2);
    fixture.detectChanges();
    await fixture.whenStable();
    resolveFirst(overview(1));
    await Promise.resolve();

    expect(fixture.componentInstance.overview()?.totals.clicks).toBe(2);
  });

  it("clears prior metrics immediately when no workspace remains", async () => {
    api.get.and.resolveTo(overview(1));
    fixture = TestBed.createComponent(AnalyticsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(fixture.componentInstance.overview()).not.toBeNull();

    workspaceId.set(null);
    fixture.detectChanges();

    expect(fixture.componentInstance.overview()).toBeNull();
    expect(fixture.componentInstance.loading()).toBeFalse();
  });

  it("asks for a custom window only once both dates are set", async () => {
    api.get.and.resolveTo(overview(5));
    fixture = TestBed.createComponent(AnalyticsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    api.get.calls.reset();

    const component = fixture.componentInstance;
    await component.onPeriod("custom");
    // Picking the mode alone is not a query: no meaningless window is fetched.
    expect(api.get).not.toHaveBeenCalled();
    expect(component.awaitingCustomRange()).toBeTrue();

    await component.onCustomDate("from", "2026-08-01");
    expect(api.get).not.toHaveBeenCalled();
    await component.onCustomDate("to", "2026-08-30");
    expect(api.get).toHaveBeenCalledOnceWith(
      "/api/v1/analytics/overview",
      { period: "custom", from: "2026-08-01", to: "2026-08-30" },
      jasmine.any(Function),
      jasmine.objectContaining({ signal: jasmine.any(AbortSignal) }),
    );
    expect(component.periodLabel()).toMatch(/^Del .+ al .+$/);
  });

  it("refuses an inverted custom range instead of querying it", async () => {
    api.get.and.resolveTo(overview(5));
    fixture = TestBed.createComponent(AnalyticsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    api.get.calls.reset();

    const component = fixture.componentInstance;
    await component.onPeriod("custom");
    await component.onCustomDate("from", "2026-08-30");
    await component.onCustomDate("to", "2026-08-01");

    expect(api.get).not.toHaveBeenCalled();
    expect(component.customRangeError()).toBe("La fecha inicial debe ser anterior o igual a la final.");
    expect(component.overview()).toBeNull();
  });
});
