import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import type { AuthUser, Workspace, WorkspaceRole, WorkspaceUsage, WorkspaceUsageQuota } from "../../core/models";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { UsageComponent } from "./usage.component";
import { decodeWorkspaceUsage } from "./usage-response";

const user: AuthUser = { id: 10, name: "Ana", email: "ana@example.test", isAdmin: false, emailVerified: true, mfaEnabled: false };
const workspace: Workspace = { id: 1, name: "Principal", slug: "principal", role: "owner", createdAt: "2026-09-05T12:00:00Z" };
const quota = (used: number, limit: number, canManage = true): WorkspaceUsageQuota => ({
  used, limit, remaining: Math.max(0, limit - used), policy: "enforced", reached: used >= limit, canManage,
});
const snapshot = (workspaceId = 1, role: WorkspaceRole = "owner"): WorkspaceUsage => {
  const editor = role !== "viewer";
  const admin = role === "owner" || role === "admin";
  return {
    workspaceId, role, measuredAt: "2026-09-06T02:00:00+00:00",
    resources: {
      links: quota(4, 10, editor), domains: quota(2, 5, editor),
      members: { used: 3, limit: null, remaining: null, policy: "not_configured", reached: null, canManage: admin },
      tokens: editor ? quota(1, 20) : null,
      webhooks: quota(2, 10, editor), invitations: admin ? quota(1, 20) : null,
    },
    analytics: { retentionDays: 90, maximumQueryRangeDays: 366, basis: "configured_policy", purgeVerified: false },
    basis: "snapshot_not_reservation",
  };
};

describe("UsageComponent", () => {
  let fixture: ComponentFixture<UsageComponent>;
  let component: UsageComponent;
  let api: jasmine.SpyObj<ApiService>;
  let identity: ReturnType<typeof signal<AuthUser | null>>;
  let selected: ReturnType<typeof signal<number | null>>;
  let workspaces: ReturnType<typeof signal<Workspace[]>>;

  beforeEach(async () => {
    identity = signal<AuthUser | null>({ ...user });
    selected = signal<number | null>(1);
    workspaces = signal<Workspace[]>([{ ...workspace }, { ...workspace, id: 2, name: "Segundo" }]);
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get"]);
    api.get.and.resolveTo(snapshot());
    await TestBed.configureTestingModule({ imports: [UsageComponent], providers: [
      provideRouter([]),
      { provide: ApiService, useValue: api },
      { provide: AuthService, useValue: { user: identity } },
      { provide: WorkspaceService, useValue: { currentId: selected, list: workspaces } },
    ] }).compileComponents();
    fixture = TestBed.createComponent(UsageComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it("renders the real categories, capacity advice and policy caveats without commercial claims", () => {
    expect(api.get).toHaveBeenCalledWith("/api/v1/workspaces/1/usage", undefined, jasmine.any(Function));
    expect(fixture.nativeElement.querySelectorAll("[data-resource]").length).toBe(6);
    expect(fixture.nativeElement.querySelector('[data-resource="links"]')?.textContent).toMatch(/4\s*de 10/);
    expect(fixture.nativeElement.textContent).toContain("Mueve a la papelera");
    expect(fixture.nativeElement.textContent).toContain("no una reserva de capacidad");
    expect(fixture.nativeElement.textContent).toContain("no acredita que la última purga");
    expect(fixture.nativeElement.textContent.toLowerCase()).not.toContain("upgrade");
    expect(fixture.nativeElement.textContent.toLowerCase()).not.toContain("precio");
  });

  it("uses the server role projection and does not invent hidden viewer categories", async () => {
    workspaces.set([{ ...workspace, role: "viewer" }]);
    api.get.and.resolveTo(snapshot(1, "viewer"));
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    expect(component.cards().map((card) => card.key)).toEqual(["links", "domains", "members", "webhooks"]);
    expect(fixture.nativeElement.textContent).not.toContain("Tokens API");
    expect(fixture.nativeElement.textContent).not.toContain("Invitaciones pendientes");
    expect(fixture.nativeElement.textContent).toContain("requiere un rol con más permisos");
  });

  it("marks reached and unavailable limits without fabricating remaining capacity", async () => {
    const data = snapshot();
    data.resources.domains = quota(5, 5);
    data.resources.links = { used: 4, limit: null, remaining: null, policy: "unavailable", reached: null, canManage: true };
    api.get.and.resolveTo(data);
    await component.reload();
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('[data-resource="domains"]')?.textContent).toContain("Límite alcanzado");
    expect(fixture.nativeElement.querySelector('[data-resource="links"]')?.textContent).toContain("No se asume capacidad libre");
  });

  it("clears the old snapshot on workspace change and ignores its late response", async () => {
    let finish!: (value: WorkspaceUsage) => void;
    api.get.and.returnValue(new Promise<WorkspaceUsage>((resolve) => { finish = resolve; }));
    const old = component.reload();
    selected.set(2);
    expect(component.data()).toBeNull();
    api.get.and.resolveTo(snapshot(2));
    fixture.detectChanges();
    await fixture.whenStable();
    finish(snapshot(1));
    await old;
    expect(component.data()?.workspaceId).toBe(2);
  });

  it("clears data after revoked access and never renders the server body", async () => {
    api.get.and.rejectWith(new ApiRequestError("private fixture detail", 403));
    await component.reload();
    fixture.detectChanges();
    expect(component.data()).toBeNull();
    expect(component.error()).toContain("Ya no tienes acceso");
    expect(fixture.nativeElement.textContent).not.toContain("private fixture detail");
  });

  it("honors Retry-After without timers, polling or cross-workspace bypass", async () => {
    let now = 1_000_000;
    spyOn(Date, "now").and.callFake(() => now);
    api.get.and.rejectWith(new ApiRequestError("limited", 429, undefined, 8));
    await component.reload();
    await component.reload();
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(component.error()).toContain("8 segundos");
    selected.set(2);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(api.get).toHaveBeenCalledTimes(2);
    now += 8_000;
    api.get.and.resolveTo(snapshot(2));
    await component.reload();
    expect(component.data()?.workspaceId).toBe(2);
  });

  it("does not fetch or retain a snapshot without verified workspace context", async () => {
    api.get.calls.reset();
    identity.set({ ...user, emailVerified: false });
    selected.set(null);
    expect(component.data()).toBeNull();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(api.get).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain("Uso no disponible");
  });
});

describe("decodeWorkspaceUsage", () => {
  it("copies only aggregate fields and rejects a snapshot bound to another context", () => {
    const raw = { ...snapshot(), secret: "fixture-secret", resources: { ...snapshot().resources, internal: "private" } };
    const decoded = decodeWorkspaceUsage(raw, 1, "owner");
    expect(JSON.stringify(decoded)).not.toContain("fixture-secret");
    expect(JSON.stringify(decoded)).not.toContain("private");
    expect(() => decodeWorkspaceUsage(raw, 2, "owner")).toThrowError("Invalid workspace usage response");
    expect(() => decodeWorkspaceUsage(raw, 1, "admin")).toThrowError("Invalid workspace usage response");
  });

  it("rejects inconsistent totals, role leaks and invalid policy timestamps", () => {
    const inconsistent = snapshot();
    inconsistent.resources.links.remaining = 9;
    const viewerLeak = snapshot(1, "viewer");
    viewerLeak.resources.tokens = quota(1, 20);
    const badDate = { ...snapshot(), measuredAt: "2026-02-30T02:00:00+00:00" };
    for (const value of [inconsistent, viewerLeak, badDate]) {
      expect(() => decodeWorkspaceUsage(value, 1, value.role)).toThrowError("Invalid workspace usage response");
    }
  });

  it("requires null limit fields for informational or unavailable policies", () => {
    const badMembers = snapshot();
    badMembers.resources.members.limit = 999;
    const badUnavailable = snapshot();
    badUnavailable.resources.links = { used: 1, limit: null, remaining: 0, policy: "unavailable", reached: null, canManage: true };
    expect(() => decodeWorkspaceUsage(badMembers, 1, "owner")).toThrow();
    expect(() => decodeWorkspaceUsage(badUnavailable, 1, "owner")).toThrow();
  });
});
