import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { AuthUser, Workspace, WorkspaceGettingStarted } from "../../core/models";
import { GettingStartedComponent } from "./getting-started.component";
import { gettingStartedSteps } from "./getting-started.steps";

const facts: WorkspaceGettingStarted = {
  workspaceId: 1, role: "owner",
  facts: { linkPresent: false, redirectObserved: false, domainPresent: false, teammatePresent: false, invitationPending: false, mfaEnabled: false },
  capabilities: { createLink: true, addDomain: true, inviteTeam: true },
  dismissedAt: null,
};
const user: AuthUser = { id: 10, name: "Ana", email: "ana@example.test", isAdmin: false, emailVerified: true, mfaEnabled: false };
const workspace: Workspace = { id: 1, name: "Primero", slug: "first", role: "owner", createdAt: "2026-09-05T12:00:00Z" };

describe("GettingStartedComponent", () => {
  let fixture: ComponentFixture<GettingStartedComponent>;
  let component: GettingStartedComponent;
  let api: jasmine.SpyObj<ApiService>;
  let identity: ReturnType<typeof signal<AuthUser | null>>;
  let selected: ReturnType<typeof signal<number | null>>;
  let workspaceList: ReturnType<typeof signal<Workspace[]>>;

  beforeEach(async () => {
    identity = signal<AuthUser | null>({ ...user });
    selected = signal<number | null>(1);
    workspaceList = signal<Workspace[]>([workspace, { ...workspace, id: 2, name: "Segundo" }]);
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "patch"]);
    api.get.and.resolveTo(facts);
    api.patch.and.resolveTo({ ok: true, dismissedAt: "2026-09-26T10:00:00+00:00" });
    await TestBed.configureTestingModule({
      imports: [GettingStartedComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: { user: identity } },
        { provide: WorkspaceService, useValue: { currentId: selected, list: workspaceList } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(GettingStartedComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  afterEach(() => fixture.destroy());

  it("renders five observations and only fixed internal action routes", () => {
    expect(api.get).toHaveBeenCalledWith("/api/v1/workspaces/1/getting-started", undefined, jasmine.any(Function), jasmine.objectContaining({ signal: jasmine.any(AbortSignal) }));
    expect(fixture.nativeElement.querySelectorAll("[data-step]").length).toBe(5);
    expect(component.observed()).toBe(0);
    for (const link of fixture.nativeElement.querySelectorAll(".steps a") as NodeListOf<HTMLAnchorElement>) {
      expect(link.getAttribute("href")).toMatch(/^\/app\/(links|settings|domains|team)(#security)?$/);
      expect(link.target).toBe("");
    }
  });

  it("saves the omission server-side and re-fetches when resuming", async () => {
    await component.dismiss();
    fixture.detectChanges();
    expect(component.hidden()).toBeTrue();
    expect(api.patch).toHaveBeenCalledOnceWith(
      "/api/v1/workspaces/1/getting-started", { hidden: true }, jasmine.any(Function));
    expect(fixture.nativeElement.textContent).toContain("Reanudar guía");

    api.get.calls.reset();
    api.patch.and.resolveTo({ ok: true, dismissedAt: null });
    await component.resume();
    await fixture.whenStable();
    expect(api.patch).toHaveBeenCalledWith(
      "/api/v1/workspaces/1/getting-started", { hidden: false }, jasmine.any(Function));
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(component.hidden()).toBeFalse();
    expect(component.observed()).toBe(0);
  });

  it("reads the dismissal the server already knows, whatever browser it was set from", async () => {
    api.get.and.resolveTo({ ...facts, dismissedAt: "2026-09-26T10:00:00+00:00" });
    await component.reload();
    fixture.detectChanges();
    expect(component.hidden()).toBeTrue();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("hides the compact prompt when initial facts exist, without requiring a domain or teammates", async () => {
    fixture.componentRef.setInput("compact", true);
    api.get.and.resolveTo({ ...facts, facts: { ...facts.facts, linkPresent: true, redirectObserved: true, mfaEnabled: true } });
    await component.reload();
    fixture.detectChanges();
    expect(component.complete()).toBeTrue();
    expect(fixture.nativeElement.querySelector(".guide")).toBeNull();
    expect(api.patch).not.toHaveBeenCalled();
  });

  it("discards an older workspace response even if it arrives after the new one", async () => {
    let finishOld!: (value: WorkspaceGettingStarted) => void;
    api.get.and.returnValue(new Promise<WorkspaceGettingStarted>((resolve) => { finishOld = resolve; }));
    const oldRequest = component.reload();
    selected.set(2);
    expect(component.data()).toBeNull();
    api.get.and.resolveTo({ ...facts, workspaceId: 2 });
    fixture.detectChanges();
    await fixture.whenStable();
    finishOld({ ...facts, facts: { ...facts.facts, mfaEnabled: true } });
    await oldRequest;
    expect(component.data()?.workspaceId).toBe(2);
    expect(component.data()?.facts.mfaEnabled).toBeFalse();
  });

  it("invalidates visible facts immediately on account and role changes", async () => {
    identity.set({ ...user, id: 11 });
    expect(component.data()).toBeNull();
    fixture.detectChanges();
    await fixture.whenStable();
    workspaceList.set([{ ...workspace, role: "viewer" }]);
    expect(component.data()).toBeNull();
  });

  it("does not fabricate progress on a failed or mismatched response", async () => {
    api.get.and.rejectWith(new ApiRequestError("Sin acceso", 403));
    await component.reload();
    expect(component.data()).toBeNull();
    expect(component.error()).toBe("Sin acceso");
    api.get.and.resolveTo({ ...facts, workspaceId: 2 });
    await component.reload();
    expect(component.error()).toBe("No se pudo comprobar el estado de la guía.");
    expect(component.complete()).toBeFalse();
  });

  it("shows the empty state without another request when selection disappears", async () => {
    api.get.calls.reset();
    selected.set(null);
    expect(component.data()).toBeNull();
    fixture.detectChanges();
    await fixture.whenStable();
    expect(api.get).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain("Sin workspace seleccionado");
  });

  it("remains usable when the server refuses the preference", async () => {
    api.patch.and.rejectWith(new ApiRequestError("Sin servicio", 503));
    await component.dismiss();
    fixture.detectChanges();
    // No dismissal is claimed that did not happen; the server truth stays.
    expect(component.hidden()).toBeFalse();
    expect(component.preferenceError()).toBeTrue();
    expect(component.observed()).toBe(0);
  });

  it("ignores a pending response after destruction", async () => {
    let finish!: (value: WorkspaceGettingStarted) => void;
    api.get.and.returnValue(new Promise<WorkspaceGettingStarted>((resolve) => { finish = resolve; }));
    const request = component.reload();
    fixture.destroy();
    finish(facts);
    await request;
    expect(component.data()).toBeNull();
  });

  it("allows omission while the API is still pending", async () => {
    let finish!: (value: WorkspaceGettingStarted) => void;
    api.get.and.returnValue(new Promise<WorkspaceGettingStarted>((resolve) => { finish = resolve; }));
    const request = component.reload();
    const omission = component.dismiss();
    fixture.detectChanges();
    expect(fixture.nativeElement.textContent).toContain("Has omitido esta guía");
    finish(facts);
    await request;
    await omission;
    // The mutation wins over the GET that was already in flight: its snapshot
    // still says the guide is open, but the dismissal has already been saved.
    expect(component.hidden()).toBeTrue();
  });
});

describe("gettingStartedSteps", () => {
  it("does not offer a viewer mutation actions or claim that hidden invites are empty", () => {
    const steps = gettingStartedSteps({ ...facts, role: "viewer", facts: { ...facts.facts, invitationPending: null },
      capabilities: { createLink: false, addDomain: false, inviteTeam: false } });
    expect(steps.find((s) => s.id === "link")?.action).toBe("Ver enlaces");
    expect(steps.find((s) => s.id === "team")?.action).toBe("Ver equipo");
    expect(steps.find((s) => s.id === "domain")?.action).toBe("Ver dominios");
  });

  it("distinguishes an existing domain and pending invitation from successful delivery or TLS", () => {
    const steps = gettingStartedSteps({ ...facts, facts: { ...facts.facts, domainPresent: true, invitationPending: true } });
    expect(steps.find((s) => s.id === "team")?.description).toContain("no significa que el correo haya llegado");
    expect(steps.find((s) => s.id === "domain")?.description).toContain("por separado");
    expect(steps.filter((s) => s.optional).map((s) => s.id)).toEqual(["domain", "team"]);
  });

  it("derives regressions after resource removal without a saved completion bit", () => {
    const observed = gettingStartedSteps({ ...facts, facts: { ...facts.facts, linkPresent: true } });
    expect(observed[0].observed).toBeTrue();
    expect(gettingStartedSteps(facts)[0].observed).toBeFalse();
  });
});
