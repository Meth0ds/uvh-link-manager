import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import type { AnalyticsOverview, AuditEvent, AuthUser, LinkDetailResponse, LinkDto, Workspace } from "../../core/models";
import { ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { DashboardComponent } from "./dashboard.component";
import { LinkDetailComponent } from "../links/link-detail.component";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const actor: AuthUser = { id: 10, name: "Ana", email: "ana@example.test", isAdmin: false, emailVerified: true, mfaEnabled: false };
function overview(clicks: number): AnalyticsOverview {
  return { totals: { clicks, visitors: 1 }, visitorMetric: "daily_pseudonyms", series: [], topLinks: [],
    countries: [], devices: [], browsers: [], os: [], referrers: [], campaigns: [],
    dimensionTotals: { countries: 0, devices: 0, browsers: 0, os: 0, referrers: 0, campaigns: 0 } };
}
function link(id = 1, version = 1): LinkDto {
  return { id, version, alias: `link-${id}`, shortUrl: `https://uvh.test/link-${id}`, destination: "https://example.test/target",
    fallbackDestination: null, state: "active", clickCount: 0, maxClicks: null, singleUse: false, usedAt: null,
    scheduledAt: null, expiresAt: null, notes: null, passwordProtected: false,
    utm: { source: null, medium: null, campaign: null, term: null, content: null }, domainId: null, domain: null,
    collectionId: null, collection: null, tags: [], createdAt: "2026-10-10T10:00:00Z", updatedAt: "2026-10-10T10:00:00Z" };
}
function detail(version: number): LinkDetailResponse {
  return { link: link(1, version), rules: [], appeal: null, blockReason: null };
}
function event(id: number): AuditEvent {
  return { id, user_id: 10, action: "link.update", resource_type: "link", resource_id: "1", metadata: null,
    ip_hash: null, created_at: "2026-10-10T10:00:00Z" };
}
type Transition = "workspace ABA" | "session" | "account" | "role" | "logout";
function context() {
  const selected = signal<number | null>(1);
  const selectionGeneration = signal(0);
  const sessionGeneration = signal(0);
  const user = signal<AuthUser | null>({ ...actor });
  const role = signal<Workspace["role"]>("owner");
  return {
    selected, selectionGeneration, sessionGeneration, user, role,
    change(change: Transition) {
      if (change === "workspace ABA") {
        selected.set(2); selectionGeneration.update(value => value + 1);
        selected.set(1); selectionGeneration.update(value => value + 1);
      } else if (change === "session") sessionGeneration.update(value => value + 1);
      else if (change === "account") user.set({ ...actor, id: 11 });
      else if (change === "role") role.set("viewer");
      else user.set(null);
    },
  };
}
function providers(api: jasmine.SpyObj<ApiService>, owner: ReturnType<typeof context>) {
  return [
    { provide: ApiService, useValue: api },
    { provide: AuthService, useValue: { user: owner.user, sessionGeneration: owner.sessionGeneration } },
    { provide: WorkspaceService, useValue: {
      currentId: owner.selected, selectionGeneration: owner.selectionGeneration, currentRole: owner.role,
      list: signal([{ id: 1, name: "Primero", role: "owner" }]),
    } },
  ];
}
const transitions: readonly Transition[] = ["workspace ABA", "session", "account", "role", "logout"];

describe("Dashboard read security context", () => {
  let owner: ReturnType<typeof context>;
  let api: jasmine.SpyObj<ApiService>;
  let fixture: ReturnType<typeof TestBed.createComponent<DashboardComponent>>;
  let component: DashboardComponent;
  function replacement<T>(path: string): Promise<T> {
    return Promise.resolve((path.includes("analytics") ? overview(2) : { links: [link(1, 2)] }) as T);
  }
  beforeEach(async () => {
    owner = context(); api = jasmine.createSpyObj<ApiService>("api", ["get"]);
    api.get.and.callFake(replacement);
    await TestBed.configureTestingModule({ imports: [DashboardComponent], providers: [provideRouter([]), ...providers(api, owner)] })
      .overrideComponent(DashboardComponent, { set: { template: "" } }).compileComponents();
    fixture = TestBed.createComponent(DashboardComponent); component = fixture.componentInstance;
    fixture.detectChanges(); await fixture.whenStable(); api.get.calls.reset();
  });
  afterEach(() => fixture.destroy());

  for (const change of transitions) for (const outcome of ["success", "error"] as const) {
    it(`rejects both queued ${outcome} responses after ${change} and refreshes the current context`, async () => {
      const analytics = deferred<AnalyticsOverview>(); const recent = deferred<{ links: LinkDto[] }>();
      api.get.and.callFake(<T>(path: string) => (path.includes("analytics") ? analytics.promise : recent.promise) as Promise<T>);
      const pending = component.load();
      const signals = api.get.calls.allArgs().map(args => args[3]!.signal!);
      api.get.calls.reset(); api.get.and.callFake(replacement);
      owner.change(change);
      // Settle before forcing the effect: the completion guard must stand alone.
      if (outcome === "success") { analytics.resolve(overview(99)); recent.resolve({ links: [link(1, 99)] }); }
      else { analytics.reject(new Error("old analytics")); recent.reject(new Error("old links")); }
      await pending; fixture.detectChanges(); await fixture.whenStable();
      expect(signals.every(value => value.aborted)).toBeTrue();
      expect(component.analyticsError()).toBeNull(); expect(component.recentError()).toBeNull();
      expect(component.analyticsLoading()).toBeFalse(); expect(component.recentLoading()).toBeFalse();
      expect(api.get.calls.count()).toBe(change === "logout" ? 0 : 2);
      expect(component.overview()?.totals.clicks ?? null).toBe(change === "logout" ? null : 2);
      expect(component.recent().map(value => value.version)).toEqual(change === "logout" ? [] : [2]);
      expect(component.recentLoaded()).toBe(change !== "logout");
    });
  }
  it("does not refetch unchanged account identity for a profile-name update", async () => {
    owner.user.set({ ...actor, name: "Otro nombre" }); fixture.detectChanges(); await fixture.whenStable();
    expect(api.get).not.toHaveBeenCalled(); expect(component.overview()?.totals.clicks).toBe(2);
  });
  it("clears both lanes and performs no retries without a workspace", async () => {
    owner.selected.set(null); owner.selectionGeneration.update(value => value + 1);
    fixture.detectChanges(); await fixture.whenStable(); api.get.calls.reset(); await component.load();
    expect(api.get).not.toHaveBeenCalled(); expect(component.overview()).toBeNull(); expect(component.recent()).toEqual([]);
    expect(component.analyticsLoading()).toBeFalse(); expect(component.recentLoading()).toBeFalse();
  });
});

describe("Link detail read security context", () => {
  let owner: ReturnType<typeof context>;
  let api: jasmine.SpyObj<ApiService>;
  let harness: RouterTestingHarness;
  let component: LinkDetailComponent;
  function replacement<T>(path: string): Promise<T> {
    const id = Number(path.split("/").pop());
    return Promise.resolve((/\/links\/\d+$/.test(path) ? { ...detail(2), link: link(id, 2) }
      : path.endsWith("activity") ? { events: [event(2)], truncated: false } : overview(2)) as T);
  }
  beforeEach(async () => {
    owner = context(); api = jasmine.createSpyObj<ApiService>("api", ["get"]); api.get.and.callFake(replacement);
    await TestBed.configureTestingModule({ providers: [
      provideRouter([{ path: "links/:id", component: LinkDetailComponent }]), ...providers(api, owner),
    ] }).overrideComponent(LinkDetailComponent, { set: { template: "" } }).compileComponents();
    harness = await RouterTestingHarness.create(); component = await harness.navigateByUrl("/links/1", LinkDetailComponent);
    await harness.fixture.whenStable(); api.get.calls.reset();
  });
  afterEach(() => harness.fixture.destroy());

  for (const lane of ["detail", "auxiliary"] as const) for (const change of transitions) for (const outcome of ["success", "error"] as const) {
    it(`rejects queued ${lane} ${outcome} after ${change}, aborts and reloads once`, async () => {
      const oldDetail = deferred<LinkDetailResponse>(); const oldAnalytics = deferred<AnalyticsOverview>();
      const oldActivity = deferred<{ events: AuditEvent[]; truncated: boolean }>();
      api.get.and.callFake(<T>(path: string) => (/\/links\/\d+$/.test(path) ? oldDetail.promise
        : path.endsWith("activity") ? oldActivity.promise : oldAnalytics.promise) as Promise<T>);
      const pending = lane === "detail" ? component.load() : Promise.all([component.loadAnalytics(), component.loadActivity()]);
      const signals = api.get.calls.allArgs().map(args => args[3]!.signal!);
      api.get.calls.reset(); api.get.and.callFake(replacement); owner.change(change);
      if (outcome === "success") {
        oldDetail.resolve(detail(99)); oldAnalytics.resolve(overview(99)); oldActivity.resolve({ events: [event(99)], truncated: true });
      } else if (lane === "detail") oldDetail.reject(new Error("old detail"));
      else { oldAnalytics.reject(new Error("old analytics")); oldActivity.reject(new Error("old activity")); }
      await pending; harness.detectChanges(); await harness.fixture.whenStable();
      expect(signals.every(value => value.aborted)).toBeTrue();
      expect(api.get.calls.count()).toBe(change === "logout" ? 0 : 3);
      expect(component.error()).toBeNull(); expect(component.analyticsError()).toBeNull(); expect(component.activityError()).toBeNull();
      expect(component.loading()).toBeFalse(); expect(component.link()?.version ?? null).toBe(change === "logout" ? null : 2);
      expect(component.analytics()?.totals.clicks ?? null).toBe(change === "logout" ? null : 2);
      expect(component.activity().map(value => value.id)).toEqual(change === "logout" ? [] : [2]);
      expect(component.activityTruncated()).toBeFalse();
    });
  }
  for (const lane of ["detail", "auxiliary"] as const) {
    it(`ignores ${lane} responses across the reused route returning to the same link`, async () => {
      const oldDetail = deferred<LinkDetailResponse>(); const oldAnalytics = deferred<AnalyticsOverview>();
      const oldActivity = deferred<{ events: AuditEvent[]; truncated: boolean }>();
      api.get.and.callFake(<T>(path: string) => (/\/links\/\d+$/.test(path) ? oldDetail.promise
        : path.endsWith("activity") ? oldActivity.promise : oldAnalytics.promise) as Promise<T>);
      const pending = lane === "detail" ? component.load() : Promise.all([component.loadAnalytics(), component.loadActivity()]);
      const signals = api.get.calls.allArgs().map(args => args[3]!.signal!);
      api.get.and.callFake(replacement);
      expect(await harness.navigateByUrl("/links/2", LinkDetailComponent)).toBe(component);
      await harness.navigateByUrl("/links/1", LinkDetailComponent);
      oldDetail.resolve(detail(99)); oldAnalytics.resolve(overview(99)); oldActivity.resolve({ events: [event(99)], truncated: true });
      await pending;
      expect(signals.every(value => value.aborted)).toBeTrue(); expect(component.link()?.version).toBe(2);
      expect(component.analytics()?.totals.clicks).toBe(2); expect(component.activity().map(value => value.id)).toEqual([2]);
    });
  }
  for (const lane of ["detail", "auxiliary"] as const) {
    it(`aborts ${lane} reads and ignores queued results after destruction`, async () => {
      const oldDetail = deferred<LinkDetailResponse>(); const oldAnalytics = deferred<AnalyticsOverview>();
      const oldActivity = deferred<{ events: AuditEvent[]; truncated: boolean }>();
      api.get.and.callFake(<T>(path: string) => (/\/links\/\d+$/.test(path) ? oldDetail.promise
        : path.endsWith("activity") ? oldActivity.promise : oldAnalytics.promise) as Promise<T>);
      const pending = lane === "detail" ? component.load() : Promise.all([component.loadAnalytics(), component.loadActivity()]);
      const signals = api.get.calls.allArgs().map(args => args[3]!.signal!);
      harness.fixture.destroy(); api.get.calls.reset();
      oldDetail.resolve(detail(99)); oldAnalytics.resolve(overview(99)); oldActivity.resolve({ events: [event(99)], truncated: true });
      await pending;
      expect(signals.every(value => value.aborted)).toBeTrue(); expect(api.get).not.toHaveBeenCalled();
      expect(component.link()?.version).toBe(2); expect(component.analytics()?.totals.clicks).toBe(2);
      expect(component.activity().map(value => value.id)).toEqual([2]);
    });
  }
  it("shows the invalid-route error and never queries global analytics or a null link during retries", async () => {
    await harness.navigateByUrl("/links/invalid", LinkDetailComponent); await harness.fixture.whenStable(); api.get.calls.reset();
    await component.loadAnalytics(); await component.loadActivity();
    expect(api.get).not.toHaveBeenCalled(); expect(component.error()).toBe("El identificador del enlace no es válido");
    expect(component.loading()).toBeFalse(); expect(component.link()).toBeNull();
  });
  it("does not retry any lane after logout even while the workspace ID is retained", async () => {
    owner.user.set(null); harness.detectChanges(); await harness.fixture.whenStable(); api.get.calls.reset();
    await component.load(); await component.loadAnalytics(); await component.loadActivity();
    expect(api.get).not.toHaveBeenCalled(); expect(component.link()).toBeNull(); expect(component.loading()).toBeFalse();
  });
  it("does not refetch when the same account updates its profile name", async () => {
    owner.user.set({ ...actor, name: "Otro nombre" }); harness.detectChanges(); await harness.fixture.whenStable();
    expect(api.get).not.toHaveBeenCalled(); expect(component.link()?.version).toBe(2);
  });
});

describe("Initial unresolved view context", () => {
  for (const view of [DashboardComponent, LinkDetailComponent]) for (const missing of ["actor", "workspace"] as const) {
    it(`does not fetch and clears loading for ${view.name} without ${missing}`, async () => {
      const owner = context();
      if (missing === "actor") owner.user.set(null); else owner.selected.set(null);
      const api = jasmine.createSpyObj<ApiService>("api", ["get"]);
      api.get.and.callFake(<T>(path: string) => Promise.resolve((/\/links\/\d+$/.test(path) ? detail(2)
        : path.endsWith("activity") ? { events: [], truncated: false } : path.includes("analytics") ? overview(2) : { links: [] }) as T));
      await TestBed.configureTestingModule({ providers: [provideRouter([{ path: "view/:id", component: view }]), ...providers(api, owner)] })
        .overrideComponent(view, { set: { template: "" } }).compileComponents();
      const harness = await RouterTestingHarness.create();
      try {
        const component = await harness.navigateByUrl("/view/1") as DashboardComponent | LinkDetailComponent;
        await harness.fixture.whenStable();
        expect(api.get).not.toHaveBeenCalled();
        if (component instanceof DashboardComponent) {
          expect(component.analyticsLoading()).toBeFalse(); expect(component.recentLoading()).toBeFalse();
        } else { expect(component.loading()).toBeFalse(); expect(component.link()).toBeNull(); }
      } finally { harness.fixture.destroy(); }
    });
  }
});
