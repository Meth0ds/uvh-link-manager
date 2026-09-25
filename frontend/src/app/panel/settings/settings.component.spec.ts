import { signal, type WritableSignal } from "@angular/core";
import { fakeAsync, flushMicrotasks, TestBed, tick } from "@angular/core/testing";
import { Router } from "@angular/router";
import { FormBuilder } from "@angular/forms";
import { MatDialog } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import { Subject } from "rxjs";
import type { AccountDeletionImpact, AuthUser, DataExportStatus, Session, SessionList } from "../../core/models";
import { ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { ThemeService } from "../../core/services/theme.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { ActionDialogService } from "../action-dialog.service";
import { DataExportDialogComponent, type DataExportDialogResult } from "./data-export-dialog.component";
import { SettingsComponent } from "./settings.component";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}

const processing: DataExportStatus = {
  id: 1,
  status: "processing",
  failureReason: null,
  downloadExpiresAt: null,
  createdAt: "2026-09-06T00:00:00Z",
  readyAt: null,
  downloadedAt: null,
};

function session(id: string, current = false): Session {
  return {
    id,
    user_agent: null,
    created_at: "2026-09-05T00:00:00Z",
    last_used_at: "2026-09-05T00:00:00Z",
    expires_at: "2099-09-05T00:00:00Z",
    revoked_at: null,
    mfa_verified_at: null,
    current,
  };
}

describe("SettingsComponent async safety", () => {
  type AuthMethods = Pick<AuthService,
    "sessionGeneration" | "listSessions" | "dataExportStatus" | "accountDeletionImpact"
    | "updateProfile" | "changePassword" | "refreshUser" | "revokeSession">;
  let auth: jasmine.SpyObj<AuthMethods> & { user: WritableSignal<AuthUser | null> };
  let api: jasmine.SpyObj<ApiService>;
  let snackbar: jasmine.SpyObj<MatSnackBar>;
  let router: jasmine.SpyObj<Router>;
  let dialog: jasmine.SpyObj<MatDialog>;
  let selected: ReturnType<typeof signal<number | null>>;
  let component: SettingsComponent;

  beforeEach(async () => {
    const authSpy = jasmine.createSpyObj<AuthMethods>("AuthService", [
      "sessionGeneration", "listSessions", "dataExportStatus", "accountDeletionImpact",
      "updateProfile", "changePassword", "refreshUser", "revokeSession",
    ]);
    auth = Object.assign(authSpy, { user: signal<AuthUser | null>({
      id: 1, email: "user@example.test", name: "User", isAdmin: false,
      emailVerified: true, mfaEnabled: false,
    }) });
    auth.sessionGeneration.and.returnValue(1);
    auth.listSessions.and.resolveTo({ sessions: [], truncated: false });
    auth.dataExportStatus.and.resolveTo(null);
    auth.accountDeletionImpact.and.resolveTo({
      canDelete: true, isPlatformAdmin: false, ownedWorkspaces: [], blockingPrivacyRequests: [], request: null,
    } satisfies AccountDeletionImpact);
    auth.updateProfile.and.resolveTo(auth.user()!);
    auth.changePassword.and.resolveTo();
    auth.refreshUser.and.resolveTo();
    auth.revokeSession.and.resolveTo(false);

    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post"]);
    api.get.and.resolveTo({ requests: [], total: 0 } as never);
    snackbar = jasmine.createSpyObj<MatSnackBar>("MatSnackBar", ["open"]);
    router = jasmine.createSpyObj<Router>("Router", ["navigate"]);
    router.navigate.and.resolveTo(true);
    dialog = jasmine.createSpyObj<MatDialog>("MatDialog", ["open"]);
    selected = signal<number | null>(7);

    TestBed.configureTestingModule({
      providers: [
        FormBuilder,
        { provide: AuthService, useValue: auth },
        { provide: ApiService, useValue: api },
        { provide: MatSnackBar, useValue: snackbar },
        { provide: Router, useValue: router },
        { provide: MatDialog, useValue: dialog },
        { provide: WorkspaceService, useValue: {
          list: signal([]), currentId: selected, select: (id: number | null) => selected.set(id),
        } },
        { provide: ThemeService, useValue: { preference: signal("system"), set: jasmine.createSpy("set") } },
        { provide: ActionDialogService, useValue: jasmine.createSpyObj("ActionDialogService", ["confirm", "prompt"]) },
      ],
    });
    component = TestBed.runInInjectionContext(() => new SettingsComponent());
    await Promise.resolve();
    await Promise.resolve();
    snackbar.open.calls.reset();
  });

  it("keeps the newest sessions response when an older request finishes last", async () => {
    const older = deferred<SessionList>();
    const newer = deferred<SessionList>();
    auth.listSessions.and.returnValues(older.promise, newer.promise);

    const firstLoad = component.loadSessions();
    const secondLoad = component.loadSessions();
    newer.resolve({ sessions: [session("new")], truncated: false });
    await secondLoad;
    older.resolve({ sessions: [session("old")], truncated: true });
    await firstLoad;

    expect(component.sessions().map((item) => item.id)).toEqual(["new"]);
    expect(component.sessionsTruncated()).toBeFalse();
    expect(component.sessionsLoading()).toBeFalse();
  });

  it("states that a bounded session registry is not every device", () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.componentInstance.sessionsLoading.set(false);
    fixture.componentInstance.sessions.set([session("a")]);
    fixture.componentInstance.sessionsTruncated.set(true);
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector(".sessions-card") as HTMLElement;

    expect(card.querySelector(".count-badge")?.textContent?.trim()).toBe("1+");
    expect(card.textContent).toContain("Hay más registros");
  });

  it("keeps section jumps local and moves keyboard focus without clearing MFA setup", () => {
    const event = new MouseEvent("click", { cancelable: true });
    const section = document.createElement("section");
    const focus = spyOn(section, "focus");
    const scroll = spyOn(section, "scrollIntoView");
    component.recoveryCodes.set(["fictional-code"]);
    component.goToSection(event, section);
    expect(event.defaultPrevented).toBeTrue();
    expect(focus).toHaveBeenCalledWith({ preventScroll: true });
    expect(scroll).toHaveBeenCalledWith({ block: "start", behavior: "instant" });
    expect(component.recoveryCodes()).toEqual(["fictional-code"]);
    expect(router.navigate).not.toHaveBeenCalled();
  });

  it("renders identity, explicit save feedback and accessible theme choices", async () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector(".profile-identity")?.textContent).toContain("User");
    expect(element.querySelectorAll('.theme-switch button[aria-pressed]')).toHaveSize(3);
    fixture.componentInstance.profileBusy.set(true);
    fixture.detectChanges();
    const save = element.querySelector<HTMLButtonElement>('.profile-form button[type="submit"]');
    expect(save?.textContent).toContain("Guardando…");
    expect(save?.disabled).toBeTrue();
    expect(save?.getAttribute("aria-busy")).toBe("true");
    expect(auth.updateProfile).not.toHaveBeenCalled();
  });

  it("keeps sensitive sections mounted while credentials stay outside the settings page", () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.componentInstance.deletionLoading.set(false);
    fixture.componentInstance.deletionImpact.set({ canDelete: true, isPlatformAdmin: false, ownedWorkspaces: [], blockingPrivacyRequests: [], request: null });
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelectorAll('.settings-section[tabindex="-1"]')).toHaveSize(4);
    expect(element.querySelector<HTMLButtonElement>(".deletion-entry button")).not.toBeNull();
    expect(element.querySelector(".deletion-entry input")).toBeNull();
    expect(element.querySelector(".password-card input")).toBeNull();
    expect(element.querySelector(".data-card input")).toBeNull();
  });

  it("does not report zero sessions as a successful result when the read fails", () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.componentInstance.sessionsLoading.set(false);
    fixture.componentInstance.sessionsError.set("No se pudieron cargar las sesiones");
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;
    expect(element.querySelector(".sessions-card .count-badge")).toBeNull();
    expect(element.querySelector(".sessions-card [role=alert]")?.textContent).toContain("Reintentar");
  });

  it("keeps the newest data-export status and loading state", async () => {
    const older = deferred<DataExportStatus | null>();
    const newer = deferred<DataExportStatus | null>();
    auth.dataExportStatus.and.returnValues(older.promise, newer.promise);
    const oldStatus = { id: 1, status: "processing", failureReason: null, downloadExpiresAt: null, createdAt: null, readyAt: null, downloadedAt: null } satisfies DataExportStatus;
    const newStatus = { ...oldStatus, status: "ready" as const };

    const first = component.loadExportStatus(false);
    const second = component.loadExportStatus(false);
    older.resolve(oldStatus);
    await first;
    expect(component.exportLoading()).toBeTrue();
    expect(component.exportStatus()).not.toEqual(oldStatus);
    newer.resolve(newStatus);
    await second;

    expect(component.exportStatus()).toEqual(newStatus);
    expect(component.exportLoading()).toBeFalse();
  });

  it("keeps the newest account-deletion impact", async () => {
    const older = deferred<AccountDeletionImpact>();
    const newer = deferred<AccountDeletionImpact>();
    auth.accountDeletionImpact.and.returnValues(older.promise, newer.promise);
    const oldImpact = { canDelete: false, isPlatformAdmin: false, ownedWorkspaces: [{ id: 4, name: "Old", slug: "old" }], blockingPrivacyRequests: [], request: null } satisfies AccountDeletionImpact;
    const newImpact = { canDelete: true, isPlatformAdmin: false, ownedWorkspaces: [], blockingPrivacyRequests: [], request: null } satisfies AccountDeletionImpact;

    const first = component.loadDeletionImpact(false);
    const second = component.loadDeletionImpact(false);
    older.resolve(oldImpact);
    await first;
    expect(component.deletionLoading()).toBeTrue();
    expect(component.deletionImpact()).not.toEqual(oldImpact);
    newer.resolve(newImpact);
    await second;

    expect(component.deletionImpact()).toEqual(newImpact);
    expect(component.deletionLoading()).toBeFalse();
  });

  it("keeps privacy data and loading correlated with the current page", async () => {
    const older = deferred<unknown>();
    const newer = deferred<unknown>();
    api.get.and.returnValues(older.promise as never, newer.promise as never);
    component.privacyPage.set(0);
    const first = component.loadPrivacyRequests();
    component.privacyPage.set(1);
    const second = component.loadPrivacyRequests();

    older.resolve({ requests: [{ id: 11 }], total: 1 });
    await first;
    expect(component.privacyLoading()).toBeTrue();
    expect(component.privacyRequests()[0]?.id).not.toBe(11);
    newer.resolve({ requests: [{ id: 12 }], total: 2 });
    await second;

    expect(component.privacyRequests()[0]?.id).toBe(12);
    expect(component.privacyTotal()).toBe(2);
    expect(component.privacyLoading()).toBeFalse();
  });

  it("shows a useful fallback for an unexpected error", async () => {
    auth.updateProfile.and.rejectWith(new Error("unexpected"));
    component.profileForm.controls.name.setValue("Changed name");

    await component.saveProfile();

    expect(snackbar.open).toHaveBeenCalledWith(
      "No se pudo completar la operación", "Cerrar", jasmine.objectContaining({ duration: 4000 }),
    );
  });

  it("does not ask for a password or factor before opening the protected flow", () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    const element: HTMLElement = fixture.nativeElement;

    expect(element.querySelector<HTMLButtonElement>(".password-card button")?.textContent).toContain("Cambiar contraseña");
    expect(element.querySelector(".password-card input")).toBeNull();
    expect(auth.changePassword).not.toHaveBeenCalled();
  });

  it("restores the previous workspace when navigation is cancelled", async () => {
    router.navigate.and.resolveTo(false);

    await component.openOwnedWorkspace(9);

    expect(selected()).toBe(7);
  });

  it("does not report a confirmed current-session revocation as failed when navigation is cancelled", async () => {
    auth.revokeSession.and.resolveTo(true);
    router.navigate.and.resolveTo(false);

    await component.revokeSession(session("current", true));

    const messages = snackbar.open.calls.allArgs().map((args) => args[0]);
    expect(messages).toContain("La sesión quedó revocada. Abre la pantalla de acceso para continuar.");
    expect(messages).not.toContain("No se pudo revocar la sesión");
  });

  it("polls the export status with bounded backoff and stops at a final state", fakeAsync(() => {
    spyOnProperty(document, "hidden", "get").and.returnValue(false);
    auth.dataExportStatus.calls.reset();
    auth.dataExportStatus.and.returnValue(Promise.resolve(processing));

    void component.loadExportStatus(false, true);
    flushMicrotasks();
    expect(auth.dataExportStatus).toHaveBeenCalledTimes(1);

    tick(3_000);
    flushMicrotasks();
    expect(auth.dataExportStatus).toHaveBeenCalledTimes(2);
    tick(5_000);
    flushMicrotasks();
    tick(8_000);
    flushMicrotasks();
    expect(auth.dataExportStatus).toHaveBeenCalledTimes(4);

    // The backoff saturates instead of growing without bound.
    tick(13_000);
    tick(21_000);
    tick(30_000);
    flushMicrotasks();
    expect(auth.dataExportStatus).toHaveBeenCalledTimes(7);
    tick(30_000);
    flushMicrotasks();
    expect(auth.dataExportStatus).toHaveBeenCalledTimes(8);

    // A final state ends the loop: no probe and no timer remain.
    auth.dataExportStatus.and.returnValue(Promise.resolve({ ...processing, status: "downloaded" }));
    tick(30_000);
    flushMicrotasks();
    expect(component.exportStatus()?.status).toBe("downloaded");
    tick(120_000);
    flushMicrotasks();
    expect(auth.dataExportStatus).toHaveBeenCalledTimes(9);
  }));

  it("pauses the probe while the tab is hidden and resumes when it comes back", fakeAsync(() => {
    let hidden = true;
    spyOnProperty(document, "hidden", "get").and.callFake(() => hidden);
    auth.dataExportStatus.calls.reset();
    auth.dataExportStatus.and.resolveTo(processing);

    void component.loadExportStatus(false, true);
    flushMicrotasks();
    tick(120_000);
    flushMicrotasks();
    expect(auth.dataExportStatus).toHaveBeenCalledTimes(1);

    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    flushMicrotasks();
    expect(auth.dataExportStatus).toHaveBeenCalledTimes(2);

    // Hiding again cancels the pending probe instead of firing it unseen.
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    tick(120_000);
    flushMicrotasks();
    expect(auth.dataExportStatus).toHaveBeenCalledTimes(2);
  }));

  it("keeps the last known export state and stays quiet when a silent probe fails", async () => {
    spyOnProperty(document, "hidden", "get").and.returnValue(true);
    auth.dataExportStatus.and.resolveTo(processing);
    await component.loadExportStatus(false, true);
    expect(component.exportStatus()).toEqual(processing);

    auth.dataExportStatus.and.rejectWith(new TypeError("Failed to fetch"));
    await component.loadExportStatus(false, true);

    expect(component.exportStatus()).toEqual(processing);
    expect(component.exportLoading()).toBeFalse();
    expect(snackbar.open).not.toHaveBeenCalled();
  });

  it("downloads through the step-up dialog and reports the exact outcome", async () => {
    const closed = new Subject<DataExportDialogResult>();
    dialog.open.and.returnValue({ afterClosed: () => closed } as never);

    component.openDataExportDialog("download");
    expect(dialog.open).toHaveBeenCalledWith(DataExportDialogComponent, jasmine.objectContaining({
      data: { purpose: "download" },
      ariaLabel: "Descargar la exportación de datos",
    }));

    closed.next(true);
    closed.complete();
    await Promise.resolve();
    await Promise.resolve();
    expect(snackbar.open).toHaveBeenCalledWith("Archivo descargado", "Cerrar", jasmine.objectContaining({ duration: 3500 }));
    expect(auth.dataExportStatus).toHaveBeenCalled();
  });

  it("explains a receipt that could not be confirmed without redoing the download", async () => {
    const closed = new Subject<DataExportDialogResult>();
    dialog.open.and.returnValue({ afterClosed: () => closed } as never);

    component.openDataExportDialog("download");
    closed.next("unconfirmed");
    closed.complete();
    await Promise.resolve();
    await Promise.resolve();

    const message = String(snackbar.open.calls.mostRecent().args[0]);
    expect(message).toContain("No pudimos confirmar la recepción");
  });

  it("shows a waiting state that invites closing the page while the file is generated", () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.componentInstance.exportLoading.set(false);
    fixture.componentInstance.exportStatus.set(processing);
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector(".data-card") as HTMLElement;

    expect(card.textContent).toContain("Estamos preparando tus datos");
    expect(card.textContent).toContain("Puedes cerrar esta página");
  });

  it("offers the download action with its dates when the export is ready", () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.componentInstance.exportLoading.set(false);
    fixture.componentInstance.exportStatus.set({
      id: 2, status: "ready", failureReason: null,
      downloadExpiresAt: "2026-09-08T00:00:00Z", createdAt: "2026-09-06T00:00:00Z",
      readyAt: "2026-09-06T00:05:00Z", downloadedAt: null,
    });
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector(".data-card") as HTMLElement;

    expect(card.textContent).toContain("Tu exportación está lista");
    expect(card.querySelector<HTMLButtonElement>(".export-primary")?.textContent).toContain("Descargar archivo");
    // The state advances alone: there is no manual refresh button anymore.
    expect(card.textContent).not.toContain("Actualizar estado");
  });

  it("routes an automated size limit to the portability flow instead of support", () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.componentInstance.exportLoading.set(false);
    fixture.componentInstance.exportStatus.set({
      id: 2, status: "failed", failureReason: "automated_size_limit",
      downloadExpiresAt: null, createdAt: "2026-09-06T00:00:00Z",
      readyAt: null, downloadedAt: null,
    });
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector(".data-card") as HTMLElement;

    expect(card.textContent).toContain("No pudimos preparar el archivo");
    expect(card.textContent).not.toContain("contacta con soporte");
    expect(card.querySelector<HTMLButtonElement>(".export-primary")?.textContent).toContain("Solicitar portabilidad");
  });

  it("offers a fresh export when the file has expired", () => {
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.componentInstance.exportLoading.set(false);
    fixture.componentInstance.exportStatus.set({
      id: 2, status: "expired", failureReason: null,
      downloadExpiresAt: "2026-09-08T00:00:00Z", createdAt: "2026-09-06T00:00:00Z",
      readyAt: "2026-09-06T00:05:00Z", downloadedAt: null,
    });
    fixture.detectChanges();
    const card = fixture.nativeElement.querySelector(".data-card") as HTMLElement;

    expect(card.textContent).toContain("El archivo ha caducado");
    expect(card.querySelector<HTMLButtonElement>(".export-primary")?.textContent).toContain("Generar una nueva exportación");
  });

  it("preselects the portability right when the size limit blocked the export", () => {
    component.openPortabilityFlow();

    expect(component.privacyForm.controls.type.value).toBe("portability");
    expect(component.privacyForm.controls.details.value).toBe("");
  });
});
