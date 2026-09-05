import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import type { AuthUser, Workspace, WorkspaceActivityEvent, WorkspaceActivityPage } from "../../core/models";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { ActivityComponent } from "./activity.component";
import { readActivityPage } from "./activity-page";

const user: AuthUser = { id: 10, name: "Ana", email: "ana@example.test", isAdmin: false, emailVerified: true, mfaEnabled: false };
const workspace: Workspace = { id: 1, name: "Primero", slug: "first", role: "owner", createdAt: "2026-09-05T12:00:00Z" };
const event = (id: string): WorkspaceActivityEvent => ({ id, action: "link.create", label: "Enlace creado", outcome: "completed",
  actor: { id: "10", label: "Tú" }, resource: { type: "link", id: "41" }, createdAt: "2026-09-05T12:00:00.123456+00:00" });
const page = (workspaceId = 1, ids = ["3", "2"], nextCursor: string | null = "cGFnZTI="): WorkspaceActivityPage =>
  ({ workspaceId, events: ids.map(event), nextCursor, coverage: "attributed_events_only" });

describe("ActivityComponent", () => {
  let fixture: ComponentFixture<ActivityComponent>;
  let component: ActivityComponent;
  let api: jasmine.SpyObj<ApiService>;
  let identity: ReturnType<typeof signal<AuthUser | null>>;
  let selected: ReturnType<typeof signal<number | null>>;
  let workspaceList: ReturnType<typeof signal<Workspace[]>>;

  beforeEach(async () => {
    identity = signal<AuthUser | null>({ ...user });
    selected = signal<number | null>(1);
    workspaceList = signal<Workspace[]>([workspace, { ...workspace, id: 2, name: "Segundo" }]);
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get"]);
    api.get.and.resolveTo(page());
    await TestBed.configureTestingModule({ imports: [ActivityComponent], providers: [
      { provide: ApiService, useValue: api },
      { provide: AuthService, useValue: { user: identity } },
      { provide: WorkspaceService, useValue: { currentId: selected, list: workspaceList } },
    ] }).compileComponents();
    fixture = TestBed.createComponent(ActivityComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());

  it("renders minimized text and coverage without displaying or storing the cursor", async () => {
    const saveLocal = spyOn(localStorage, "setItem");
    const saveSession = spyOn(sessionStorage, "setItem");
    await component.reload();
    fixture.detectChanges();
    expect(api.get).toHaveBeenCalledWith("/api/v1/workspaces/1/activity", { limit: 25, cursor: null });
    expect(fixture.nativeElement.querySelectorAll("[data-activity-event]").length).toBe(2);
    expect(fixture.nativeElement.textContent).toContain("El historial puede ser incompleto");
    expect(fixture.nativeElement.textContent).toContain("UTC");
    expect(fixture.nativeElement.textContent).not.toContain("cGFnZTI=");
    expect(saveLocal).not.toHaveBeenCalled();
    expect(saveSession).not.toHaveBeenCalled();
  });

  it("paginates only on explicit action, keeps IDs as strings and restarts without a cursor", async () => {
    expect(api.get).toHaveBeenCalledTimes(1);
    api.get.and.resolveTo(page(1, ["1"], null));
    await component.loadMore();
    expect(api.get).toHaveBeenCalledWith("/api/v1/workspaces/1/activity", { limit: 25, cursor: "cGFnZTI=" });
    expect(component.events().map((e) => e.id)).toEqual(["3", "2", "1"]);
    expect(component.hasMore()).toBeFalse();
    await component.loadMore();
    expect(api.get).toHaveBeenCalledTimes(2);
    await component.reload();
    expect(api.get.calls.mostRecent().args[1]).toEqual({ limit: 25, cursor: null });
    expect(component.events().map((e) => e.id)).toEqual(["1"]);
  });

  it("drops visible rows immediately on workspace switch and ignores the previous response", async () => {
    let finish!: (value: WorkspaceActivityPage) => void;
    api.get.and.returnValue(new Promise<WorkspaceActivityPage>((resolve) => { finish = resolve; }));
    const old = component.loadMore();
    selected.set(2);
    expect(component.events()).toEqual([]);
    api.get.and.resolveTo(page(2, ["90"], null));
    fixture.detectChanges();
    await fixture.whenStable();
    finish(page(1, ["1"], null));
    await old;
    expect(component.events().map((e) => e.id)).toEqual(["90"]);
    expect(api.get.calls.mostRecent().args).toEqual(["/api/v1/workspaces/2/activity", { limit: 25, cursor: null }]);
  });

  it("invalidates data on refreshed identity even when the account ID is unchanged", async () => {
    identity.set({ ...user, mfaEnabled: true });
    expect(component.events()).toEqual([]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(api.get).toHaveBeenCalledTimes(2);
    identity.set({ ...user, id: 11 });
    expect(component.events()).toEqual([]);
  });

  for (const role of ["editor", "viewer"] as const) {
    it(`does not fetch or retain data for ${role}, even for a platform admin`, async () => {
      identity.set({ ...user, isAdmin: true });
      workspaceList.set([{ ...workspace, role }]);
      expect(component.events()).toEqual([]);
      api.get.calls.reset();
      fixture.detectChanges();
      await fixture.whenStable();
      await component.reload();
      await component.loadMore();
      expect(api.get).not.toHaveBeenCalled();
      expect(fixture.nativeElement.textContent).toContain("Actividad no disponible");
    });
  }

  it("permits a workspace admin and refuses an unverified account, logout and absent selection", async () => {
    workspaceList.set([{ ...workspace, role: "admin" }]);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.events().length).toBe(2);
    identity.set({ ...user, emailVerified: false });
    expect(component.events()).toEqual([]);
    api.get.calls.reset();
    fixture.detectChanges();
    await fixture.whenStable();
    identity.set(null);
    selected.set(null);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(api.get).not.toHaveBeenCalled();
  });

  for (const status of [401, 403]) {
    it(`clears earlier pages after ${status} and does not expose the server error body`, async () => {
      api.get.and.rejectWith(new ApiRequestError("private fixture details", status));
      await component.loadMore();
      fixture.detectChanges();
      expect(component.events()).toEqual([]);
      expect(component.hasMore()).toBeFalse();
      expect(component.error()).toContain("Ya no tienes acceso");
      expect(fixture.nativeElement.textContent).not.toContain("private fixture details");
    });
  }

  it("requires manual reset after 422 without automatically replaying the cursor", async () => {
    api.get.and.rejectWith(new ApiRequestError("expired", 422));
    await component.loadMore();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(component.error()).toContain("Actualiza para empezar");
    expect(component.events()).toEqual([]);
    await component.loadMore();
    expect(api.get).toHaveBeenCalledTimes(2);
    api.get.and.resolveTo(page());
    await component.reload();
    expect(api.get.calls.mostRecent().args[1]).toEqual({ limit: 25, cursor: null });
  });

  it("honors Retry-After across workspaces without timers or automatic retries", async () => {
    let timestamp = 1_000_000;
    spyOn(Date, "now").and.callFake(() => timestamp);
    api.get.and.rejectWith(new ApiRequestError("limited", 429, undefined, 10));
    await component.loadMore();
    await component.reload();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(component.error()).toContain("10 segundos");
    selected.set(2);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(api.get).toHaveBeenCalledTimes(2);
    timestamp += 10_000;
    expect(api.get).toHaveBeenCalledTimes(2);
    api.get.and.resolveTo(page(2));
    await component.reload();
    expect(component.events().length).toBe(2);
  });

  it("clears data after 503 with no invented wait or automatic retry", async () => {
    api.get.and.rejectWith(new ApiRequestError("unavailable", 503));
    await component.loadMore();
    expect(component.events()).toEqual([]);
    expect(api.get).toHaveBeenCalledTimes(2);
    api.get.and.resolveTo(page());
    await component.reload();
    expect(api.get).toHaveBeenCalledTimes(3);
  });

  it("coalesces rapid actions while a page is pending and ignores completion after destruction", async () => {
    let finish!: (value: WorkspaceActivityPage) => void;
    api.get.and.returnValue(new Promise<WorkspaceActivityPage>((resolve) => { finish = resolve; }));
    const pending = component.loadMore();
    await component.loadMore();
    await component.reload();
    expect(api.get).toHaveBeenCalledTimes(2);
    fixture.destroy();
    finish(page(1, ["1"], null));
    await pending;
    expect(component.events()).toEqual([]);
  });

  it("rejects duplicate rows, a repeated cursor and responses for another workspace", async () => {
    for (const bad of [page(1, ["3"], null), page(1, ["1"]), page(2)]) {
      api.get.and.resolveTo(page());
      await component.reload();
      api.get.and.resolveTo(bad);
      await component.loadMore();
      expect(component.events()).toEqual([]);
      expect(component.hasMore()).toBeFalse();
      expect(component.error()).not.toBeNull();
    }
  });

  it("bounds the view to 500 events even when another cursor is returned", async () => {
    api.get.calls.reset();
    for (let index = 0; index < 20; index++) {
      api.get.and.resolveTo(page(1, Array.from({ length: 25 }, (_, n) => String(1000 - index * 25 - n)), btoa(`page-${index}`)));
      if (index === 0) await component.reload();
      else await component.loadMore();
    }
    expect(component.events().length).toBe(500);
    expect(component.capped()).toBeTrue();
    expect(component.hasMore()).toBeFalse();
    await component.loadMore();
    expect(api.get).toHaveBeenCalledTimes(20);
  });

  it("requests only remaining capacity after short non-final pages", async () => {
    api.get.and.resolveTo(page(1, Array.from({ length: 12 }, (_, n) => String(2000 - n)), btoa("first")));
    await component.reload();
    for (let index = 0; index < 19; index++) {
      api.get.and.resolveTo(page(1, Array.from({ length: 25 }, (_, n) => String(1000 - index * 25 - n)), btoa(`page-${index}`)));
      await component.loadMore();
    }
    expect(component.events().length).toBe(487);
    api.get.and.resolveTo(page(1, Array.from({ length: 13 }, (_, n) => String(100 - n)), null));
    await component.loadMore();
    expect(api.get.calls.mostRecent().args[1]?.["limit"]).toBe(13);
    expect(component.events().length).toBe(500);
  });

  it("shows absence as limited coverage rather than claiming no changes occurred", async () => {
    api.get.and.resolveTo(page(1, [], null));
    await component.reload();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Esto no implica que no hayan ocurrido cambios");
    expect(component.error()).toBeNull();
  });

  it("renders HTML-shaped labels as text with no links or injected elements", async () => {
    const data = page(1, ["1"], null);
    data.events[0].label = '<img src="https://example.test/private">';
    data.events[0].actor.label = "<script>fixture</script>";
    api.get.and.resolveTo(data);
    await component.reload();
    fixture.detectChanges();
    const row: HTMLElement = fixture.nativeElement.querySelector("[data-activity-event]");
    expect(row.textContent).toContain("<img");
    expect(row.querySelector("img, script, a")).toBeNull();
  });
});

describe("readActivityPage", () => {
  it("copies only public fields and preserves IDs beyond JS safe integer precision", () => {
    const item = { ...event("9007199254740993"), metadata: { token: "fixture-secret" }, ip_hash: "fixture-ip" };
    const result = readActivityPage({ ...page(), events: [item], privateField: "fixture-private" }, 1, 25);
    expect(result.events[0].id).toBe("9007199254740993");
    expect(JSON.stringify(result)).not.toContain("fixture-");
  });

  it("rejects malformed page envelopes, excessive pages and unbounded cursors", () => {
    for (const invalid of [null, {}, { ...page(), workspaceId: 2 }, { ...page(), coverage: "all" },
      { ...page(), events: Array.from({ length: 26 }, (_, i) => event(String(i + 1))) },
      page(1, [], "cursor"), page(1, ["1"], ""), page(1, ["1"], "a".repeat(2049)), page(1, ["1"], "cursor\n")]) {
      expect(() => readActivityPage(invalid, 1, 25)).toThrowError("Invalid workspace activity response");
    }
  });

  it("rejects invalid IDs, arbitrary resource targets, duplicate IDs and coerced enum values", () => {
    const invalid = [
      { ...event("1"), id: 1 }, event("1\n"),
      { ...event("1"), resource: { type: "link", id: "https://example.test" } },
      { ...event("1"), resource: { type: ["link"], id: "1" } },
      { ...event("1"), outcome: ["completed"] }, { ...event("1"), actor: null },
      { ...event("1"), label: "x".repeat(161) },
    ];
    for (const item of invalid) expect(() => readActivityPage({ ...page(), events: [item] }, 1, 25)).toThrow();
    expect(() => readActivityPage(page(1, ["1", "1"]), 1, 25)).toThrow();
  });

  it("rejects rolled dates and noncanonical timestamps before they reach the date pipe", () => {
    for (const date of ["2026-02-30T12:00:00.000000+00:00", "2026-09-05T12:00:00Z", "not a date"])
      expect(() => readActivityPage({ ...page(), events: [{ ...event("1"), createdAt: date }] }, 1, 25)).toThrow();
  });

  it("keeps pending and unknown distinct from completion", () => {
    const result = readActivityPage({ ...page(), events: [
      { ...event("2"), outcome: "pending" }, { ...event("1"), outcome: "unknown", actor: { id: null, label: "Actor no disponible" } },
    ] }, 1, 25);
    expect(result.events.map((row) => row.outcome)).toEqual(["pending", "unknown"]);
  });
});
