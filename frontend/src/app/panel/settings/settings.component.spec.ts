import { signal, type WritableSignal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { Router } from "@angular/router";
import { FormBuilder } from "@angular/forms";
import { MatSnackBar } from "@angular/material/snack-bar";
import type { AccountDeletionImpact, AuthUser, DataExportStatus, Session } from "../../core/models";
import { ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { ThemeService } from "../../core/services/theme.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { ActionDialogService } from "../action-dialog.service";
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
    auth.listSessions.and.resolveTo([]);
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
    selected = signal<number | null>(7);

    TestBed.configureTestingModule({
      providers: [
        FormBuilder,
        { provide: AuthService, useValue: auth },
        { provide: ApiService, useValue: api },
        { provide: MatSnackBar, useValue: snackbar },
        { provide: Router, useValue: router },
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
    const older = deferred<Session[]>();
    const newer = deferred<Session[]>();
    auth.listSessions.and.returnValues(older.promise, newer.promise);

    const firstLoad = component.loadSessions();
    const secondLoad = component.loadSessions();
    newer.resolve([session("new")]);
    await secondLoad;
    older.resolve([session("old")]);
    await firstLoad;

    expect(component.sessions().map((item) => item.id)).toEqual(["new"]);
    expect(component.sessionsLoading()).toBeFalse();
  });

  it("keeps the newest data-export status and loading state", async () => {
    const older = deferred<DataExportStatus | null>();
    const newer = deferred<DataExportStatus | null>();
    auth.dataExportStatus.and.returnValues(older.promise, newer.promise);
    const oldStatus = { id: 1, status: "processing", confirmationExpiresAt: null, downloadExpiresAt: null, createdAt: null, confirmedAt: null, readyAt: null, downloadedAt: null } satisfies DataExportStatus;
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

  it("keeps a confirmed password change distinct from a failed refresh", async () => {
    auth.refreshUser.and.rejectWith(new Error("offline"));
    component.passwordForm.setValue({ current: "old-password", next: "new-password", confirm: "new-password", factorCode: "" });

    await component.changePassword();

    const messages = snackbar.open.calls.allArgs().map((args) => args[0]);
    expect(messages).toContain("Contraseña actualizada");
    expect(messages).toContain("El cambio se aplicó, pero no se pudo actualizar toda la vista. Recárgala antes de repetir la operación.");
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
});
