import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { MatSnackBar } from "@angular/material/snack-bar";
import { ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { AnalyticsOverview, AuthUser, LinkDto, LinksResponse, Workspace, WorkspaceGettingStarted } from "../../core/models";
import { LinkDialogService } from "../links/link-dialog.service";
import { GettingStartedComponent } from "../getting-started/getting-started.component";
import { DashboardComponent } from "./dashboard.component";

const user: AuthUser = { id: 10, name: "Ana", email: "ana@example.test", isAdmin: false, emailVerified: true, mfaEnabled: false };
const workspace: Workspace = { id: 1, name: "Primero", slug: "first", role: "owner", createdAt: "2026-09-05T12:00:00Z" };
const facts: WorkspaceGettingStarted = {
  workspaceId: 1, role: "owner", dismissedAt: null,
  facts: { linkPresent: false, redirectObserved: false, domainPresent: false, teammatePresent: false, invitationPending: false, mfaEnabled: false },
  capabilities: { createLink: true, addDomain: true, inviteTeam: true },
};
const overview: AnalyticsOverview = {
  totals: { clicks: 1000, visitors: 9 }, visitorMetric: "daily_pseudonyms", series: [], topLinks: [],
  countries: [{ key: "ES", value: 50 }, { key: "FR", value: 50 }], devices: [], browsers: [], os: [], referrers: [], campaigns: [],
  dimensionTotals: { countries: 12, devices: 0, browsers: 0, os: 0, referrers: 0, campaigns: 0 },
};
const link: LinkDto = {
  id: 7, alias: "ejemplo", destination: "https://example.test/destino", fallbackDestination: null,
  state: "active", clickCount: 90, maxClicks: null, singleUse: false, usedAt: null, scheduledAt: null, expiresAt: null,
  notes: null, passwordProtected: false, utm: { source: null, medium: null, campaign: null, term: null, content: null }, domainId: null, domain: null, collectionId: null, collection: null,
  tags: [], createdAt: workspace.createdAt, updatedAt: workspace.createdAt, version: 1, shortUrl: "https://uvh.test/ejemplo",
};
const links: LinksResponse = { links: [link], total: 1, page: 1, perPage: 5 };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
async function setup<T>(component: typeof DashboardComponent | typeof GettingStartedComponent) {
  const api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "patch"]);
  const selected = signal<number | null>(1);
  const identity = signal<AuthUser | null>({ ...user });
  const list = signal<Workspace[]>([workspace, { ...workspace, id: 2, name: "Segundo" }]);
  api.get.and.callFake(<R>(path: string) => Promise.resolve((path.includes("getting-started")
    ? { ...facts, workspaceId: selected() } : path.includes("analytics") ? overview : links) as R));
  api.patch.and.resolveTo({ ok: true, dismissedAt: null });
  await TestBed.configureTestingModule({ imports: [component], providers: [provideRouter([]),
    { provide: ApiService, useValue: api }, { provide: AuthService, useValue: { user: identity } },
    { provide: WorkspaceService, useValue: { currentId: selected, list } },
    { provide: LinkDialogService, useValue: { openCreate: jasmine.createSpy("openCreate") } },
    { provide: MatSnackBar, useValue: { open: jasmine.createSpy("open") } },
  ] }).compileComponents();
  const fixture = TestBed.createComponent(component as typeof DashboardComponent) as unknown as ComponentFixture<T>;
  fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  return { fixture, component: fixture.componentInstance, api, selected, identity, list };
}

describe("Dashboard UX recovery", () => {
  let state: Awaited<ReturnType<typeof setup<DashboardComponent>>>;
  beforeEach(async () => { state = await setup<DashboardComponent>(DashboardComponent); });
  afterEach(() => state.fixture.destroy());
  it("uses all recorded clicks, including omitted countries and unlocated clicks, for geographic bars", () => {
    expect(state.component.geoPct(50, overview)).toBe(5);
  });
  it("does not round small positive traffic down to zero", () => {
    expect(state.component.geoPct(1, { ...overview, totals: { clicks: 10000, visitors: 1 } })).toBe(0.01);
  });
  it("publishes recent links when analytics fails", async () => {
    state.component.recent.set([]);
    state.api.get.and.callFake(<T>(path: string) => path.includes("analytics")
      ? Promise.reject(new Error("analytics unavailable")) : Promise.resolve(links as T));
    await state.component.load(); state.fixture.detectChanges();
    expect(state.component.recent()).toEqual([link]);
    expect(state.fixture.nativeElement.textContent).toContain("uvh.test/ejemplo");
  });
  it("publishes analytics when recent links fail", async () => {
    state.component.overview.set(null);
    state.api.get.and.callFake(<T>(path: string) => path.includes("analytics")
      ? Promise.resolve(overview as T) : Promise.reject(new Error("links unavailable")));
    await state.component.load();
    expect(state.component.overview()).toEqual(overview);
  });
  it("does not reload recent links when only the analytics period changes", async () => {
    state.api.get.calls.reset(); state.component.setPeriod("7d"); await state.fixture.whenStable();
    expect(state.api.get.calls.allArgs().filter(args => args[0] === "/api/v1/links").length).toBe(0);
  });
  it("handles zero traffic and a fully located control without exceeding the bar", () => {
    expect(state.component.geoPct(0, { ...overview, totals: { clicks: 0, visitors: 0 } })).toBe(0);
    expect(state.component.geoPct(50, { ...overview, totals: { clicks: 100, visitors: 9 } })).toBe(50);
    expect(state.component.geoPct(1001, overview)).toBe(100);
  });
  it("publishes links before a slow analytics request settles", async () => {
    const response = deferred<AnalyticsOverview>();
    state.component.recent.set([]);
    state.api.get.and.callFake(<T>(path: string) => path.includes("analytics") ? response.promise as Promise<T> : Promise.resolve(links as T));
    const pending = state.component.load(); await Promise.resolve(); await Promise.resolve();
    expect(state.component.recent()).toEqual([link]);
    expect(state.component.recentLoading()).toBeFalse();
    expect(state.component.analyticsLoading()).toBeTrue();
    response.resolve(overview); await pending;
  });
  it("retries only the failed analytics read", async () => {
    state.api.get.calls.reset(); await state.component.loadAnalytics();
    expect(state.api.get).toHaveBeenCalledTimes(1);
    expect(state.api.get.calls.mostRecent().args[0]).toBe("/api/v1/analytics/overview");
    expect(state.component.recent()).toEqual([link]);
  });
  it("retains stale links with a persistent warning and retries only links", async () => {
    state.api.get.and.rejectWith(new Error("unavailable")); await state.component.loadRecent();
    expect(state.component.recent()).toEqual([link]);
    expect(state.component.recentError()).not.toBeNull();
    state.fixture.detectChanges();
    expect(state.fixture.nativeElement.textContent).toContain("La lista corresponde a la última carga correcta");
    state.api.get.calls.reset(); state.api.get.and.resolveTo(links); await state.component.loadRecent();
    expect(state.api.get).toHaveBeenCalledTimes(1);
    expect(state.api.get.calls.mostRecent().args[0]).toBe("/api/v1/links");
    expect(state.component.recentError()).toBeNull();
  });
  it("does not present a failed first links read as an empty workspace", async () => {
    state.selected.set(2); state.api.get.and.rejectWith(new Error("unavailable"));
    state.fixture.detectChanges(); await state.fixture.whenStable(); state.fixture.detectChanges();
    expect(state.component.recentLoaded()).toBeFalse();
    expect(state.fixture.nativeElement.textContent).not.toContain("Haz sitio al primer enlace");
  });
  it("discards an old period without cancelling a pending recent links read", async () => {
    const analytics = deferred<AnalyticsOverview>(); const recent = deferred<LinksResponse>();
    state.api.get.and.callFake(<T>(path: string) => (path.includes("analytics") ? analytics.promise : recent.promise) as Promise<T>);
    const old = state.component.load();
    const recentSignal = state.api.get.calls.mostRecent().args[3]?.signal;
    state.api.get.and.resolveTo({ ...overview, totals: { clicks: 7, visitors: 1 } });
    state.component.setPeriod("7d"); await Promise.resolve(); await Promise.resolve();
    expect(recentSignal?.aborted).toBeFalse();
    recent.resolve(links); analytics.resolve(overview); await old;
    expect(state.component.overview()?.totals.clicks).toBe(7);
    expect(state.component.recent()).toEqual([link]);
  });
  it("ignores both old reads after leaving and returning to the same workspace", async () => {
    const analytics = deferred<AnalyticsOverview>(); const recent = deferred<LinksResponse>();
    state.api.get.and.callFake(<T>(path: string) => (path.includes("analytics") ? analytics.promise : recent.promise) as Promise<T>);
    const old = state.component.load();
    state.api.get.and.callFake(<T>(path: string) => Promise.resolve((path.includes("getting-started") ? facts : path.includes("analytics")
      ? { ...overview, totals: { clicks: 4, visitors: 1 } } : { ...links, links: [] }) as T));
    state.selected.set(2); state.fixture.detectChanges(); await state.fixture.whenStable();
    state.selected.set(1); state.fixture.detectChanges(); await state.fixture.whenStable();
    analytics.resolve(overview); recent.resolve(links); await old;
    expect(state.component.overview()?.totals.clicks).toBe(4);
    expect(state.component.recent()).toEqual([]);
  });
  it("performs no reads without a workspace and clears prior rows and errors", async () => {
    state.selected.set(null); state.fixture.detectChanges(); await state.fixture.whenStable();
    state.api.get.calls.reset(); await state.component.load();
    expect(state.api.get).not.toHaveBeenCalled();
    expect(state.component.overview()).toBeNull(); expect(state.component.recent()).toEqual([]);
    expect(state.component.analyticsError()).toBeNull(); expect(state.component.recentLoaded()).toBeFalse();
  });

  for (const [theme, ink, paper] of [["light", "#262821", "#fffcf5"], ["dark", "#fffcf5", "#262821"]]) {
    it(`keeps the primary click count visible against its ${theme} background`, () => {
      const host = state.fixture.nativeElement as HTMLElement;
      host.style.setProperty("--ink", ink);
      host.style.setProperty("--uvh-ink", ink);
      host.style.setProperty("--paper", paper);
      const metric = host.querySelector(".primary-metric") as HTMLElement;
      const value = metric.querySelector("dd:not(.metric-note)") as HTMLElement;
      expect(value.textContent).toBe("1000");
      expect(getComputedStyle(value).color).not.toBe(getComputedStyle(metric).backgroundColor);
    });
  }

});

describe("Getting started preference ownership", () => {
  let state: Awaited<ReturnType<typeof setup<GettingStartedComponent>>>;
  beforeEach(async () => { state = await setup<GettingStartedComponent>(GettingStartedComponent); });
  afterEach(() => state.fixture.destroy());
  it("does not publish an old preference error in a different workspace", async () => {
    const response = deferred<{ ok: true; dismissedAt: string | null }>();
    state.api.patch.and.returnValue(response.promise);
    const pending = state.component.dismiss();
    state.selected.set(2); state.fixture.detectChanges(); await state.fixture.whenStable();
    response.reject(new Error("old workspace unavailable")); await pending;
    expect(state.component.preferenceError()).toBeFalse();
    expect(state.component.data()?.workspaceId).toBe(2);
  });
  it("does not review or reload the new workspace after an old resume settles", async () => {
    const response = deferred<{ ok: true; dismissedAt: string | null }>();
    state.api.patch.and.returnValue(response.promise);
    const pending = state.component.resume();
    state.selected.set(2); state.fixture.detectChanges(); await state.fixture.whenStable();
    state.api.get.calls.reset(); response.resolve({ ok: true, dismissedAt: null }); await pending;
    expect(state.component.reviewing()).toBeFalse();
    expect(state.api.get).not.toHaveBeenCalled();
  });
  it("does not issue opposite preference writes concurrently", async () => {
    const response = deferred<{ ok: true; dismissedAt: string | null }>();
    state.api.patch.and.returnValue(response.promise);
    const pending = state.component.dismiss(); const opposite = state.component.resume();
    response.resolve({ ok: true, dismissedAt: "2026-10-07T10:00:00Z" }); await Promise.all([pending, opposite]);
    expect(state.api.patch).toHaveBeenCalledTimes(1);
  });
  it("does not release a newer mutation after leaving and returning to the same workspace", async () => {
    const oldResponse = deferred<{ ok: true; dismissedAt: string | null }>();
    const newResponse = deferred<{ ok: true; dismissedAt: string | null }>();
    state.api.patch.and.returnValue(oldResponse.promise); const old = state.component.dismiss();
    state.selected.set(2); state.fixture.detectChanges(); await state.fixture.whenStable();
    state.selected.set(1); state.fixture.detectChanges(); await state.fixture.whenStable();
    state.api.patch.and.returnValue(newResponse.promise); const current = state.component.resume();
    oldResponse.reject(new Error("old failure")); await old;
    expect(state.component.preferenceBusy()).toBeTrue(); expect(state.component.preferenceError()).toBeFalse();
    newResponse.resolve({ ok: true, dismissedAt: null }); await current;
    expect(state.component.preferenceBusy()).toBeFalse(); expect(state.component.hidden()).toBeFalse();
  });
  it("does not publish a preference after destroying the view", async () => {
    const response = deferred<{ ok: true; dismissedAt: string | null }>();
    state.api.patch.and.returnValue(response.promise); const pending = state.component.resume();
    state.fixture.destroy(); state.api.get.calls.reset(); response.reject(new Error("late")); await pending;
    expect(state.component.preferenceError()).toBeFalse(); expect(state.component.reviewing()).toBeFalse();
    expect(state.api.get).not.toHaveBeenCalled(); expect(state.component.preferenceBusy()).toBeFalse();
  });
  for (const change of ["account", "role"] as const) {
    it(`ignores a late preference after an ${change} change`, async () => {
      const response = deferred<{ ok: true; dismissedAt: string | null }>();
      state.api.patch.and.returnValue(response.promise); const pending = state.component.dismiss();
      if (change === "account") state.identity.set({ ...user, id: 11 });
      else state.list.set([{ ...workspace, role: "viewer" }]);
      state.fixture.detectChanges(); await state.fixture.whenStable();
      response.reject(new Error("old identity")); await pending;
      expect(state.component.preferenceError()).toBeFalse(); expect(state.component.hidden()).toBeFalse();
    });
  }
  it("disables opposite actions while saving and restores server truth after a current rejection", async () => {
    const response = deferred<{ ok: true; dismissedAt: string | null }>();
    state.api.patch.and.returnValue(response.promise); const pending = state.component.dismiss(); state.fixture.detectChanges();
    const resume = state.fixture.nativeElement.querySelector("button") as HTMLButtonElement;
    expect(resume.disabled).toBeTrue();
    response.reject(new Error("current rejection")); await pending; state.fixture.detectChanges();
    expect(state.component.preferenceBusy()).toBeFalse(); expect(state.component.preferenceError()).toBeTrue();
    expect(state.component.hidden()).toBeFalse();
  });

});
