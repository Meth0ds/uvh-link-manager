import { Location } from "@angular/common";
import { SpyLocation } from "@angular/common/testing";
import { type ComponentFixture, fakeAsync, flushMicrotasks, TestBed, tick } from "@angular/core/testing";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting, type TestRequest } from "@angular/common/http/testing";
import { ActivatedRoute, Router } from "@angular/router";
import { MatSnackBar } from "@angular/material/snack-bar";
import { apiInterceptor } from "../../core/interceptors/api.interceptor";
import { AuthService } from "../../core/services/auth.service";
import { ActionDialogService } from "../action-dialog.service";
import { SettingsComponent } from "./settings.component";

const STATUS = "/api/v1/auth/data-export";
const HISTORY = `${STATUS}/history`;
const SESSIONS = "/api/v1/auth/sessions";
const PRIVACY = "/api/v1/auth/privacy-requests";
const DELETION = "/api/v1/auth/account-deletion";
const PREFERENCES = "/api/v1/notifications/preferences";
const owner = (id = 1) => ({ id, name: `Cuenta ${id}`, email: `qa${id}@example.invalid`, emailVerified: true, mfaEnabled: false, isAdmin: false });

describe("Settings section data activation", () => {
  let fixture: ComponentFixture<SettingsComponent>;
  let http: HttpTestingController;
  let auth: AuthService;
  let route: { snapshot: { data: Record<string, string> } };

  beforeEach(() => {
    route = { snapshot: { data: {} } };
    const snack = jasmine.createSpyObj("MatSnackBar", ["open"]);
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: route },
      { provide: Router, useValue: { navigate: jasmine.createSpy("navigate").and.resolveTo(true) } },
      { provide: Location, useClass: SpyLocation },
      { provide: MatSnackBar, useValue: snack },
      { provide: ActionDialogService, useValue: { confirm: jasmine.createSpy("confirm").and.resolveTo(true) } },
    ] });
    TestBed.overrideComponent(SettingsComponent, { add: { providers: [{ provide: MatSnackBar, useValue: snack }] } });
    http = TestBed.inject(HttpTestingController);
    auth = TestBed.inject(AuthService);
    auth.user.set(owner());
    auth.loaded.set(true);
  });
  afterEach(() => { fixture?.destroy(); http.verify(); });

  function mount(section?: string): SettingsComponent {
    route.snapshot.data = section ? { section } : {};
    fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    return fixture.componentInstance;
  }
  function open(section: string, init: MouseEventInit = {}): void {
    fixture.componentInstance.goToSection(new MouseEvent("click", { cancelable: true, ...init }), fixture.nativeElement.querySelector(`#${section}`));
    fixture.detectChanges();
  }
  function flushRead(request: TestRequest): void {
    switch (request.request.url) {
      case STATUS: request.flush({ export: null }); break;
      case HISTORY: request.flush({ exports: [] }); break;
      case SESSIONS: request.flush({ sessions: [], truncated: false }); break;
      case DELETION: request.flush({ canDelete: true, isPlatformAdmin: false, ownedWorkspaces: [], blockingPrivacyRequests: [], request: null }); break;
      case PREFERENCES: request.flush({ preferences: [] }); break;
      case PRIVACY: request.flush({ requests: [], total: 0, page: Number(request.request.params.get("page")), perPage: Number(request.request.params.get("perPage")) }); break;
      default: throw new Error(`Unexpected fixture read: ${request.request.url}`);
    }
  }
  function reads(expected: string[]): void {
    const requests = http.match(r => r.method === "GET");
    expect(requests.map(r => r.request.url).sort()).toEqual([...expected].sort());
    requests.forEach(flushRead);
    flushMicrotasks();
  }

  for (const [section, expected] of [
    [undefined, [STATUS]], ["account", [STATUS]], ["security", [STATUS, SESSIONS]],
    ["notifications", [STATUS, PREFERENCES]], ["privacy", [STATUS, HISTORY, PRIVACY]],
    ["danger", [STATUS, DELETION]],
  ] as const) {
    it(`loads only export observation and the initial ${section ?? "default profile"} data`, fakeAsync(() => {
      const component = mount(section);
      reads([...expected]);
      fixture.detectChanges();
      expect(component.activeSection()).toBe(section ?? "account");
      expect(fixture.nativeElement.querySelectorAll(".settings-section")).toHaveSize(5);
      expect([...fixture.nativeElement.querySelectorAll(".settings-section")].filter((el: Element) => !(el as HTMLElement).hidden)).toHaveSize(1);
    }));
  }

  it("starts a section once even while pending and preserves mounted drafts across return visits", fakeAsync(() => {
    const c = mount(); reads([STATUS]);
    const profileForm = c.profileForm;
    c.profileForm.controls.name.setValue("Nombre pendiente");
    c.privacyForm.controls.details.setValue("Borrador sin enviar");
    c.mfaSecret.set("FICTIONAL-SECRET");
    c.recoveryCodes.set(["FICTIONAL-RECOVERY"]);
    open("security");
    const sessions = http.expectOne(SESSIONS);
    open("account"); open("security");
    http.expectNone(r => r.method === "GET");
    expect(sessions.cancelled).toBeFalse();
    flushRead(sessions); flushMicrotasks();
    open("notifications"); reads([PREFERENCES]);
    open("privacy"); reads([HISTORY, PRIVACY]);
    open("danger"); reads([DELETION]);
    open("account"); open("privacy");
    reads([]);
    expect(c.profileForm).toBe(profileForm);
    expect(c.profileForm.controls.name.value).toBe("Nombre pendiente");
    expect(c.privacyForm.controls.details.value).toBe("Borrador sin enviar");
    expect(c.mfaSecret()).toBe("FICTIONAL-SECRET");
    expect(c.recoveryCodes()).toEqual(["FICTIONAL-RECOVERY"]);
  }));

  it("does not fetch a destination for a modified link click", fakeAsync(() => {
    mount(); reads([STATUS]);
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) open("security", init);
    reads([]);
    expect(fixture.componentInstance.activeSection()).toBe("account");
  }));

  it("retires all started reads and only activates the replacement owner's visible task", fakeAsync(() => {
    const c = mount(); reads([STATUS]);
    open("security"); open("privacy"); open("notifications"); open("danger");
    const old = http.match(r => r.method === "GET");
    expect(old).toHaveSize(5);
    auth.sessionExpired(); fixture.detectChanges(); flushMicrotasks();
    expect(old.every(r => r.cancelled)).toBeTrue();
    reads([]);
    void auth.me();
    http.expectOne("/api/v1/auth/me").flush({ user: owner(2) });
    flushMicrotasks();
    http.expectOne("/api/v1/workspaces").flush({ workspaces: [] });
    flushMicrotasks(); fixture.detectChanges();
    reads([STATUS, DELETION]);
    expect(c.sessions()).toEqual([]);
    expect(c.privacyRequests()).toEqual([]);
    expect(c.privacyForm.controls.details.value).toBe("");
    open("security"); reads([SESSIONS]);
    open("privacy"); reads([HISTORY, PRIVACY]);
  }));

  it("keeps explicit read retries after a deferred section fails", fakeAsync(() => {
    mount(); reads([STATUS]); open("notifications");
    http.expectOne(PREFERENCES).flush({ error: "Fixture unavailable" }, { status: 503, statusText: "Unavailable" });
    flushMicrotasks(); fixture.detectChanges();
    expect(fixture.componentInstance.notificationPrefsError()).not.toBeNull();
    const retry = fixture.nativeElement.querySelector(".notifications-settings-section [role='alert'] button") as HTMLButtonElement;
    expect(retry).not.toBeNull();
    retry.click();
    reads([PREFERENCES]); fixture.detectChanges();
    expect(fixture.componentInstance.notificationPrefsError()).toBeNull();
  }));

  it("keeps export polling and history refresh when an export completes outside Privacy", fakeAsync(() => {
    mount();
    const initial = http.match(r => r.method === "GET");
    expect(initial.map(r => r.request.url)).toEqual([STATUS]);
    const exported = { id: 1, status: "processing", failureReason: null, stage: "collecting", createdAt: new Date().toISOString(), readyAt: null, downloadedAt: null, downloadExpiresAt: null };
    for (const r of initial) {
      if (r.request.url === STATUS) r.flush({ export: exported }); else flushRead(r);
    }
    flushMicrotasks(); tick(3000);
    http.expectOne(STATUS).flush({ export: { ...exported, status: "ready", stage: null, readyAt: new Date().toISOString(), downloadExpiresAt: new Date(Date.now() + 10000).toISOString() } });
    flushMicrotasks();
    reads([HISTORY]);
    expect(fixture.componentInstance.activeSection()).toBe("account");
    expect(fixture.componentInstance.exportStatus()?.status).toBe("ready");
    fixture.destroy(); tick(15000); reads([]);
  }));

  it("does not start section requests once anonymous or destroyed", fakeAsync(() => {
    mount(); reads([STATUS]);
    auth.sessionExpired(); fixture.detectChanges(); flushMicrotasks();
    open("privacy"); reads([]);
    fixture.destroy();
    auth.user.set(owner(2));
    open("security"); reads([]);
  }));
});
