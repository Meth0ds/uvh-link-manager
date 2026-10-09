import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { Location } from "@angular/common";
import { ActivatedRoute, Router } from "@angular/router";
import { MatSnackBar } from "@angular/material/snack-bar";
import { MatDialog } from "@angular/material/dialog";
import type { AuthUser, Session, SessionList } from "../../core/models";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { NotificationService } from "../../core/services/notification.service";
import { ThemeService } from "../../core/services/theme.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { ActionDialogService } from "../action-dialog.service";
import { SettingsComponent } from "./settings.component";

const device = (expiresAt: string): Session => ({
  id: "fictional-device", current: false, user_agent: "Firefox fixture", created_at: "2026-10-01T00:00:00Z",
  last_used_at: "2026-10-01T00:00:00Z", expires_at: expiresAt, revoked_at: null, mfa_verified_at: null,
});

describe("Settings UX recovery", () => {
  let fixture: ComponentFixture<SettingsComponent>;
  let auth: jasmine.SpyObj<Pick<AuthService, "listSessions" | "sessionGeneration" | "dataExportStatus" | "dataExportHistory" | "accountDeletionImpact" | "updateProfile">>;
  let location: jasmine.SpyObj<Location>;
  let route: { snapshot: { data: Record<string, string> } };
  let clock: number;

  beforeEach(async () => {
    clock = Date.parse("2026-10-06T10:00:00Z");
    spyOn(Date, "now").and.callFake(() => clock);
    auth = jasmine.createSpyObj("AuthService", ["listSessions", "sessionGeneration", "dataExportStatus", "dataExportHistory", "accountDeletionImpact", "updateProfile"]);
    auth.sessionGeneration.and.returnValue(1);
    auth.listSessions.and.resolveTo({ sessions: [], truncated: false });
    auth.dataExportStatus.and.resolveTo(null);
    auth.dataExportHistory.and.resolveTo([]);
    auth.accountDeletionImpact.and.resolveTo({ canDelete: true, isPlatformAdmin: false, ownedWorkspaces: [], blockingPrivacyRequests: [], request: null });
    auth.updateProfile.and.resolveTo({ id: 1, name: "QA", email: "qa@example.invalid", emailVerified: true, mfaEnabled: false, isAdmin: false });
    location = jasmine.createSpyObj("Location", ["replaceState"]);
    route = { snapshot: { data: {} } };
    const notifications = jasmine.createSpyObj("NotificationService", ["preferences"]);
    notifications.preferences.and.resolveTo([]);
    const api = jasmine.createSpyObj("ApiService", ["get", "post"]);
    api.get.and.resolveTo({ requests: [], total: 0 });
    const snack = jasmine.createSpyObj("MatSnackBar", ["open"]);
    TestBed.configureTestingModule({ providers: [
      { provide: AuthService, useValue: Object.assign(auth, { user: signal<AuthUser | null>({ id: 1, name: "QA", email: "qa@example.invalid", emailVerified: true, mfaEnabled: false, isAdmin: false }), userRefreshRequired: signal(false), userMutationUnconfirmed: signal(false), mfaRecoveryIssueUnconfirmed: signal(false) }) },
      { provide: ApiService, useValue: api },
      { provide: Location, useValue: location },
      { provide: ActivatedRoute, useValue: route },
      { provide: Router, useValue: { navigate: jasmine.createSpy("navigate") } },
      { provide: MatSnackBar, useValue: snack },
      { provide: MatDialog, useValue: jasmine.createSpyObj("MatDialog", ["open"]) },
      { provide: ThemeService, useValue: { preference: signal("system"), set: jasmine.createSpy("set") } },
      { provide: WorkspaceService, useValue: { currentId: signal(1), select: jasmine.createSpy("select") } },
      { provide: NotificationService, useValue: notifications },
      { provide: ActionDialogService, useValue: jasmine.createSpyObj("ActionDialogService", ["confirm"]) },
    ] });
    TestBed.overrideComponent(SettingsComponent, { add: { providers: [{ provide: MatSnackBar, useValue: snack }] } });
    fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());

  it("does not show a session that expires while its response is in flight", async () => {
    let resolve!: (value: SessionList) => void;
    auth.listSessions.and.returnValue(new Promise<SessionList>((done) => { resolve = done; }));
    const loading = fixture.componentInstance.loadSessions();
    clock += 2000;
    resolve({ sessions: [device("2026-10-06T10:00:01Z")], truncated: false });
    await loading;
    expect(fixture.componentInstance.sessions()).toEqual([]);
  });

  it("rejects the exact expiry boundary after waiting for the response", async () => {
    let resolve!: (value: SessionList) => void;
    auth.listSessions.and.returnValue(new Promise<SessionList>((done) => { resolve = done; }));
    const loading = fixture.componentInstance.loadSessions();
    clock += 1000;
    resolve({ sessions: [device("2026-10-06T10:00:01Z")], truncated: false });
    await loading;
    expect(fixture.componentInstance.sessions()).toEqual([]);
  });

  it("keeps live devices while excluding revoked and malformed expiries", async () => {
    const live = device("2026-10-06T11:00:00Z");
    auth.listSessions.and.resolveTo({ sessions: [live, { ...live, id: "revoked", revoked_at: "2026-10-06T09:00:00Z" }, { ...live, id: "invalid", expires_at: "not a date" }], truncated: true });
    await fixture.componentInstance.loadSessions();
    expect(fixture.componentInstance.sessions()).toEqual([live]);
    expect(fixture.componentInstance.sessionsTruncated()).toBeTrue();
  });

  it("keeps the account closure read error visible and offers a read-only retry", async () => {
    auth.accountDeletionImpact.and.rejectWith(new ApiRequestError("No se pudo comprobar el cierre", 503));
    await fixture.componentInstance.loadDeletionImpact(); fixture.detectChanges();
    const card = fixture.nativeElement.querySelector(".deletion-card") as HTMLElement;
    expect(card.querySelector('[role="alert"]')?.textContent).toContain("No se pudo comprobar el cierre");
    expect(card.querySelector('[role="alert"] button')?.textContent).toContain("Reintentar");
    expect(card.querySelector(".deletion-entry")).toBeNull();
  });

  const sections = (): HTMLElement[] => [...fixture.nativeElement.querySelectorAll('.settings-section')] as HTMLElement[];
  const open = (id: string): void => {
    fixture.componentInstance.goToSection(new MouseEvent("click", { cancelable: true }), fixture.nativeElement.querySelector(`#${id}`));
    fixture.detectChanges();
  };

  it("shows a single task and keeps hidden tasks out of layout", () => {
    expect(sections().filter((x) => !x.hidden).map((x) => x.id)).toEqual(["account"]);
    open("security");
    expect(sections().filter((x) => !x.hidden).map((x) => x.id)).toEqual(["security"]);
    for (const hidden of sections().filter((x) => x.hidden)) expect(getComputedStyle(hidden).display).toBe("none");
    expect(fixture.nativeElement.querySelectorAll('.settings-nav [aria-current="page"]')).toHaveSize(1);
    expect(fixture.nativeElement.querySelector('.settings-nav [aria-current="page"]').getAttribute("href")).toBe("/app/settings/security");
  });

  it("preserves form instances, drafts and one-time MFA data across all tasks", () => {
    const component = fixture.componentInstance;
    const original = sections();
    const profile = component.profileForm;
    component.profileForm.controls.name.setValue("Nombre sin guardar");
    component.privacyForm.controls.details.setValue("Expediente en preparación");
    component.mfaSecret.set("FICTIONAL-SECRET");
    component.recoveryCodes.set(["FICTIONAL-ONE-TIME-CODE"]);
    component.recoveryCodesAcknowledged.set(true);
    for (const id of ["security", "notifications", "privacy", "danger", "account", "security"]) open(id);
    expect(sections()).toEqual(original);
    expect(component.profileForm).toBe(profile);
    expect(component.profileForm.controls.name.value).toBe("Nombre sin guardar");
    expect(component.privacyForm.controls.details.value).toBe("Expediente en preparación");
    expect(component.mfaSecret()).toBe("FICTIONAL-SECRET");
    expect(component.recoveryCodes()).toEqual(["FICTIONAL-ONE-TIME-CODE"]);
    expect(component.recoveryCodesAcknowledged()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.recovery').textContent).toContain("FICTIONAL-ONE-TIME-CODE");
  });

  it("keeps canonical links and does not intercept modified or auxiliary clicks", () => {
    expect([...fixture.nativeElement.querySelectorAll('.settings-nav a')].map((x) => (x as HTMLAnchorElement).getAttribute("href"))).toEqual([
      "/app/settings/profile", "/app/settings/security", "/app/settings/notifications", "/app/settings/privacy", "/app/settings/danger",
    ]);
    const target = fixture.nativeElement.querySelector("#security") as HTMLElement;
    for (const init of [{ ctrlKey: true }, { metaKey: true }, { shiftKey: true }, { altKey: true }, { button: 1 }]) {
      const event = new MouseEvent("click", { ...init, cancelable: true });
      fixture.componentInstance.goToSection(event, target);
      expect(event.defaultPrevented).toBeFalse();
    }
    expect(target.hidden).toBeTrue();
    expect(location.replaceState).not.toHaveBeenCalled();
  });

  it("reveals the destination before moving focus and updates its canonical address", () => {
    const target = fixture.nativeElement.querySelector("#privacy") as HTMLElement;
    const focus = spyOn(target, "focus").and.callFake(() => { expect(target.hidden).toBeFalse(); });
    open("privacy");
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(location.replaceState).toHaveBeenCalledOnceWith("/app/settings/privacy");
  });

  it("opens a section route directly without briefly rendering another task", async () => {
    fixture.destroy(); route.snapshot.data = { section: "danger" };
    fixture = TestBed.createComponent(SettingsComponent);
    expect(fixture.componentInstance.activeSection()).toBe("danger");
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(sections().filter((x) => !x.hidden).map((x) => x.id)).toEqual(["danger"]);
  });

  it("falls back to profile for an unrecognized section value", async () => {
    fixture.destroy(); route.snapshot.data = { section: "__proto__" };
    fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect(sections().filter((x) => !x.hidden).map((x) => x.id)).toEqual(["account"]);
  });

  it("keeps an in-flight save and its draft when switching tasks", async () => {
    let resolve!: (value: AuthUser) => void;
    auth.updateProfile.and.returnValue(new Promise<AuthUser>((done) => { resolve = done; }));
    fixture.componentInstance.profileForm.controls.name.setValue("Nombre pendiente");
    const saving = fixture.componentInstance.saveProfile();
    open("security"); open("account");
    expect(fixture.componentInstance.profileBusy()).toBeTrue();
    expect(fixture.nativeElement.querySelector('.profile-form input').readOnly).toBeTrue();
    resolve({ id: 1, name: "Nombre pendiente", email: "qa@example.invalid", emailVerified: true, mfaEnabled: false, isAdmin: false });
    await saving;
    expect(fixture.componentInstance.profileBusy()).toBeFalse();
    expect(fixture.componentInstance.profileForm.controls.name.value).toBe("Nombre pendiente");
    expect(auth.updateProfile).toHaveBeenCalledOnceWith("Nombre pendiente");
  });

  it("recovers closure prerequisites through the retry control without opening a mutation", async () => {
    open("danger"); await fixture.whenStable();
    auth.accountDeletionImpact.and.rejectWith(new ApiRequestError("No se pudo comprobar el cierre", 503));
    await fixture.componentInstance.loadDeletionImpact(false);
    fixture.detectChanges();
    auth.accountDeletionImpact.and.resolveTo({ canDelete: true, isPlatformAdmin: false, ownedWorkspaces: [], blockingPrivacyRequests: [], request: null });
    fixture.nativeElement.querySelector('.deletion-read-error button').click();
    await fixture.whenStable(); fixture.detectChanges();
    expect(fixture.componentInstance.deletionError()).toBeNull();
    expect(fixture.nativeElement.querySelector('.deletion-entry button')).not.toBeNull();
    expect(TestBed.inject(MatDialog).open).not.toHaveBeenCalled();
  });

  it("names each notification frequency by its actual notice", async () => {
    open("notifications"); await fixture.whenStable();
    fixture.componentInstance.notificationPrefsLoading.set(false);
    fixture.componentInstance.notificationPreferences.set([
      { kind: "api_token_created", category: "operational", delivery: "immediate" },
      { kind: "webhook_exhausted", category: "operational", delivery: "daily_digest" },
    ]);
    fixture.detectChanges();
    const names = [...fixture.nativeElement.querySelectorAll('.pref-row [role="combobox"]')].map((x) => (x as HTMLElement).getAttribute("aria-label"));
    expect(names).toEqual(["Frecuencia de Se creó un token de API", "Frecuencia de Una entrega de webhook requiere revisión"]);
  });
});
