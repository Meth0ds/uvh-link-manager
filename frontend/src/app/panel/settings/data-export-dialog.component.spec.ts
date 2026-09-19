import { signal, type WritableSignal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { MatDialogRef } from "@angular/material/dialog";
import type { AuthUser, DataExportStatus } from "../../core/models";
import { ApiRequestError } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { DataExportDialogComponent } from "./data-export-dialog.component";

function user(mfaEnabled: boolean): AuthUser {
  return {
    id: 1,
    email: "user@example.test",
    name: "User",
    isAdmin: false,
    emailVerified: true,
    mfaEnabled,
  };
}

const requested: DataExportStatus = {
  id: 7,
  status: "requested",
  confirmationExpiresAt: "2026-09-06T00:15:00Z",
  downloadExpiresAt: null,
  createdAt: "2026-09-06T00:00:00Z",
  confirmedAt: null,
  readyAt: null,
  downloadedAt: null,
};

describe("DataExportDialogComponent", () => {
  type AuthMethods = Pick<AuthService, "sessionGeneration" | "requestDataExport" | "user">;
  let auth: jasmine.SpyObj<AuthMethods> & { user: WritableSignal<AuthUser | null> };
  let ref: { disableClose: boolean; close: jasmine.Spy };
  let generation: number;

  beforeEach(() => {
    generation = 1;
    const authSpy = jasmine.createSpyObj<AuthMethods>("AuthService", ["sessionGeneration", "requestDataExport", "user"]);
    auth = Object.assign(authSpy, { user: signal<AuthUser | null>(user(false)) });
    auth.sessionGeneration.and.callFake(() => generation);
    auth.requestDataExport.and.resolveTo(requested);

    ref = { disableClose: true, close: jasmine.createSpy("close") };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: MatDialogRef, useValue: ref },
      ],
    });
  });

  function build(): DataExportDialogComponent {
    return TestBed.runInInjectionContext(() => new DataExportDialogComponent());
  }

  it("never sends the password when the session changed while the dialog was open", async () => {
    const component = build();
    component.passwordForm.setValue({ password: "correct-horse-battery" });
    generation = 9;

    await component.submit();

    expect(auth.requestDataExport).not.toHaveBeenCalled();
    expect(component.error()).toContain("Tu sesión ha cambiado");
    expect(component.passwordForm.controls.password.value).toBe("");
    expect(component.step()).toBe(1);
  });

  it("confirms the request once and hands back only a completion signal", async () => {
    const component = build();
    component.passwordForm.setValue({ password: "correct-horse-battery" });

    await component.submit();

    expect(auth.requestDataExport).toHaveBeenCalledWith("correct-horse-battery", undefined);
    expect(component.isDone()).toBeTrue();
    expect(component.passwordForm.controls.password.value).toBe("");
    expect(ref.disableClose).toBeFalse();
    // Nothing but the boolean crosses the dialog boundary: no credential, no
    // export payload.
    expect(ref.close).not.toHaveBeenCalled();
  });

  it("asks for the factor when MFA is on and never submits without it", async () => {
    auth.user.set(user(true));
    const component = build();
    component.passwordForm.setValue({ password: "correct-horse-battery" });

    // Step 1 is the password step only when there is no second factor.
    await component.submit();
    expect(auth.requestDataExport).not.toHaveBeenCalled();

    component.continueFromPassword();
    expect(component.step()).toBe(2);
    component.factorForm.setValue({ factorCode: "ABC-DEF" });
    await component.submit();
    expect(auth.requestDataExport).not.toHaveBeenCalled();

    component.factorForm.setValue({ factorCode: "123456" });
    await component.submit();
    expect(auth.requestDataExport).toHaveBeenCalledWith("correct-horse-battery", "123456");
    expect(component.step()).toBe(3);
  });

  it("surfaces what the API said and never implies the export was queued", async () => {
    const component = build();
    component.passwordForm.setValue({ password: "correct-horse-battery" });
    auth.requestDataExport.and.rejectWith(new ApiRequestError("Demasiadas solicitudes", 429, undefined, 60));

    await component.submit();

    expect(component.isDone()).toBeFalse();
    expect(component.error()).toBe("Demasiadas solicitudes");
    expect(component.passwordForm.controls.password.value).toBe("");
    expect(ref.disableClose).toBeFalse();
  });

  it("tells the operator the state has to be checked when the failure is not explained", async () => {
    const component = build();
    component.passwordForm.setValue({ password: "correct-horse-battery" });
    // A dropped connection: the request may have reached the server, so the
    // retry has to be armed with a check rather than with a second request.
    auth.requestDataExport.and.rejectWith(new TypeError("Failed to fetch"));

    await component.submit();

    expect(component.error()).toContain("Comprueba su estado antes de volver a intentarlo");
    expect(component.isDone()).toBeFalse();
    expect(component.passwordForm.controls.password.value).toBe("");
    expect(ref.disableClose).toBeFalse();
  });
});
