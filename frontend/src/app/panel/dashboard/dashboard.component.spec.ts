import { ComponentFixture, TestBed } from "@angular/core/testing";
import { signal } from "@angular/core";
import { provideRouter } from "@angular/router";
import { DashboardComponent } from "./dashboard.component";
import { ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { LinkDialogService } from "../links/link-dialog.service";
import { MatSnackBar } from "@angular/material/snack-bar";
import type { AnalyticsOverview } from "../../core/models";

const overview: AnalyticsOverview = {
  totals: { clicks: 12, visitors: 9 },
  series: [],
  topLinks: [],
  countries: [],
  devices: [],
  browsers: [],
  os: [],
  referrers: [],
  campaigns: [],
};

describe("DashboardComponent period selection", () => {
  let fixture: ComponentFixture<DashboardComponent>;
  let component: DashboardComponent;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get"]);
    api.get.and.callFake(<T>(path: string) => Promise.resolve((path.includes("analytics") ? overview : { links: [] }) as T));

    await TestBed.configureTestingModule({
      imports: [DashboardComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { user: signal({ name: "Ana", email: "ana@example.test" }) } },
        { provide: WorkspaceService, useValue: { currentId: signal(1), list: signal([{ id: 1, name: "Operaciones" }]) } },
        { provide: LinkDialogService, useValue: { openCreate: jasmine.createSpy("openCreate") } },
        { provide: MatSnackBar, useValue: { open: jasmine.createSpy("open") } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(DashboardComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it("requests the selected supported period instead of a fixed range", async () => {
    api.get.calls.reset();

    component.setPeriod("7d");
    await fixture.whenStable();

    expect(component.period()).toBe("7d");
    expect(component.periodLabel()).toBe("7 días");
    expect(api.get).toHaveBeenCalledWith("/api/v1/analytics/overview", { period: "7d" }, jasmine.any(Function));
  });

  it("does not request again when the same period is selected", () => {
    api.get.calls.reset();

    component.setPeriod("30d");

    expect(api.get).not.toHaveBeenCalled();
  });

  it("ignores queued results after the dashboard is destroyed", async () => {
    let resolveAnalytics!: (value: AnalyticsOverview) => void;
    let resolveLinks!: (value: { links: [] }) => void;
    api.get.and.callFake(<T>(path: string) => (path.includes("analytics")
      ? new Promise<AnalyticsOverview>((resolve) => { resolveAnalytics = resolve; })
      : new Promise<{ links: [] }>((resolve) => { resolveLinks = resolve; })) as Promise<T>);
    component.overview.set(null);
    component.recent.set([]);
    const pending = component.load();
    fixture.destroy();

    resolveAnalytics(overview);
    resolveLinks({ links: [] });
    await pending;

    expect(component.overview()).toBeNull();
  });
});
