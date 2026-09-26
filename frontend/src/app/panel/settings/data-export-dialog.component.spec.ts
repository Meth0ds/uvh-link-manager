import { signal, type WritableSignal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import type { AuthUser, DataExportStatus } from "../../core/models";
import { ApiRequestError } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { DataExportDialogComponent, type DataExportDialogData } from "./data-export-dialog.component";

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

const processing: DataExportStatus = {
  id: 7,
  status: "processing",
  failureReason: null,
  stage: "collecting",
  downloadExpiresAt: null,
  createdAt: "2026-09-06T00:00:00Z",
  readyAt: null,
  downloadedAt: null,
};

describe("DataExportDialogComponent", () => {
  type AuthMethods = Pick<AuthService,
    "sessionGeneration" | "requestDataExport" | "downloadDataExport" | "acknowledgeDataExportDownload" | "user">;
  let auth: jasmine.SpyObj<AuthMethods> & { user: WritableSignal<AuthUser | null> };
  let ref: { disableClose: boolean; close: jasmine.Spy };
  let data: DataExportDialogData;
  let generation: number;

  beforeEach(() => {
    generation = 1;
    const authSpy = jasmine.createSpyObj<AuthMethods>("AuthService", [
      "sessionGeneration", "requestDataExport", "downloadDataExport", "acknowledgeDataExportDownload", "user",
    ]);
    auth = Object.assign(authSpy, { user: signal<AuthUser | null>(user(false)) });
    auth.sessionGeneration.and.callFake(() => generation);
    auth.requestDataExport.and.resolveTo(processing);
    auth.downloadDataExport.and.resolveTo(new Blob(['{"account":{}}'], { type: "application/json" }));
    auth.acknowledgeDataExportDownload.and.resolveTo();

    ref = { disableClose: true, close: jasmine.createSpy("close") };
    data = { purpose: "request" };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: MatDialogRef, useValue: ref },
        { provide: MAT_DIALOG_DATA, useValue: data },
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
    // Nothing but a small completion signal crosses the dialog boundary: no
    // credential, no export payload.
    expect(ref.close).toHaveBeenCalledOnceWith(true);
    expect(component.passwordForm.controls.password.value).toBe("");
    expect(ref.disableClose).toBeFalse();
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
    expect(ref.close).toHaveBeenCalledOnceWith(true);
  });

  it("downloads the artifact, saves it and acknowledges the receipt", async () => {
    data.purpose = "download";
    spyOn(URL, "createObjectURL").and.returnValue("blob:uvh-export");
    spyOn(URL, "revokeObjectURL");
    const component = build();
    component.passwordForm.setValue({ password: "correct-horse-battery" });

    await component.submit();

    expect(auth.downloadDataExport).toHaveBeenCalledWith("correct-horse-battery", undefined);
    expect(auth.acknowledgeDataExportDownload).toHaveBeenCalledTimes(1);
    expect(ref.close).toHaveBeenCalledOnceWith(true);
  });

  it("keeps the export unacknowledged when the browser refuses to save the file", async () => {
    data.purpose = "download";
    spyOn(URL, "createObjectURL").and.throwError("quota");
    const component = build();
    component.passwordForm.setValue({ password: "correct-horse-battery" });

    await component.submit();

    // The receipt is what consumes the export: a failed save must not spend it.
    expect(auth.acknowledgeDataExportDownload).not.toHaveBeenCalled();
    expect(ref.close).not.toHaveBeenCalled();
    expect(component.error()).toContain("La exportación sigue disponible");
  });

  it("reports an unconfirmed receipt without demanding the credentials again", async () => {
    data.purpose = "download";
    spyOn(URL, "createObjectURL").and.returnValue("blob:uvh-export");
    spyOn(URL, "revokeObjectURL");
    auth.acknowledgeDataExportDownload.and.rejectWith(new TypeError("Failed to fetch"));
    const component = build();
    component.passwordForm.setValue({ password: "correct-horse-battery" });

    await component.submit();

    // The file is already on the device: the dialog signals the nuance instead
    // of forcing another step-up and a second download.
    expect(auth.downloadDataExport).toHaveBeenCalledTimes(1);
    expect(ref.close).toHaveBeenCalledOnceWith("unconfirmed");
  });

  it("surfaces what the API said and never implies the export was queued", async () => {
    const component = build();
    component.passwordForm.setValue({ password: "correct-horse-battery" });
    auth.requestDataExport.and.rejectWith(new ApiRequestError("Demasiadas solicitudes", 429, undefined, 60));

    await component.submit();

    expect(ref.close).not.toHaveBeenCalled();
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
    expect(ref.close).not.toHaveBeenCalled();
    expect(component.passwordForm.controls.password.value).toBe("");
    expect(ref.disableClose).toBeFalse();
  });

  it("keeps the download retryable when the transfer fails without an explanation", async () => {
    data.purpose = "download";
    auth.downloadDataExport.and.rejectWith(new TypeError("Failed to fetch"));
    const component = build();
    component.passwordForm.setValue({ password: "correct-horse-battery" });

    await component.submit();

    expect(auth.acknowledgeDataExportDownload).not.toHaveBeenCalled();
    expect(ref.close).not.toHaveBeenCalled();
    expect(component.error()).toContain("Sigue disponible: vuelve a intentarlo");
  });
});
