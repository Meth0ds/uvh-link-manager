import { signal, type WritableSignal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { MAT_DIALOG_DATA, MatDialogRef } from "@angular/material/dialog";
import type { AuthUser } from "../../core/models";
import { ApiRequestError } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { EmailAccessDialogComponent, type EmailAccessDialogData } from "./email-access-dialog.component";

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

describe("EmailAccessDialogComponent", () => {
  type AuthMethods = Pick<AuthService, "sessionGeneration" | "requestEmailChange" | "cancelEmailChange" | "user">;
  let auth: jasmine.SpyObj<AuthMethods> & { user: WritableSignal<AuthUser | null> };
  let ref: { disableClose: boolean; close: jasmine.Spy };
  let generation: number;

  function configure(data: EmailAccessDialogData, mfaEnabled = false): void {
    generation = 1;
    const authSpy = jasmine.createSpyObj<AuthMethods>("AuthService", [
      "sessionGeneration", "requestEmailChange", "cancelEmailChange", "user",
    ]);
    auth = Object.assign(authSpy, { user: signal<AuthUser | null>(user(mfaEnabled)) });
    auth.sessionGeneration.and.callFake(() => generation);
    auth.requestEmailChange.and.resolveTo(user(mfaEnabled));
    auth.cancelEmailChange.and.resolveTo(user(mfaEnabled));

    ref = { disableClose: true, close: jasmine.createSpy("close") };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: MatDialogRef, useValue: ref },
        { provide: MAT_DIALOG_DATA, useValue: data },
      ],
    });
  }

  function build(): EmailAccessDialogComponent {
    return TestBed.runInInjectionContext(() => new EmailAccessDialogComponent());
  }

  beforeEach(() => configure({ mode: "change" }));

  it("never leaves the email step with an address the form rejects", () => {
    const component = build();

    component.nextFromEmail();
    expect(component.step()).toBe(1);

    component.emailForm.setValue({ newEmail: "not-an-address" });
    component.nextFromEmail();
    expect(component.step()).toBe(1);

    component.emailForm.setValue({ newEmail: "next@example.test" });
    component.nextFromEmail();
    expect(component.step()).toBe(2);
  });

  it("sends the address trimmed, takes the password step before any request and confirms once", async () => {
    const component = build();
    component.emailForm.setValue({ newEmail: "next@example.test" });
    component.nextFromEmail();
    component.passwordForm.setValue({ password: "correct-horse-battery" });

    // The password step is a gate: nothing has been sent yet.
    expect(auth.requestEmailChange).not.toHaveBeenCalled();

    await component.submit();

    expect(auth.requestEmailChange).toHaveBeenCalledWith("next@example.test", "correct-horse-battery", undefined);
    expect(component.isDone()).toBeTrue();
    // Only the credentials are cleared: the address is not a secret, and a
    // refusal that reopens step 1 must not make the operator retype it.
    expect(component.passwordForm.controls.password.value).toBe("");
    expect(component.emailForm.controls.newEmail.value).toBe("next@example.test");
  });

  it("pasted padding is reported as a bad address by the form, before any step", () => {
    const component = build();
    // Today's contract: the field is validated as typed and only the submitted
    // value is trimmed, so a pasted " next@example.test " is refused by the form
    // with "Introduce un email válido" instead of being silently normalised.
    component.emailForm.setValue({ newEmail: " next@example.test " });

    component.nextFromEmail();

    expect(component.emailForm.invalid).toBeTrue();
    expect(component.step()).toBe(1);
    expect(component.error()).toBeNull();
  });

  it("walks the factor step when MFA is on and refuses to submit without it", async () => {
    configure({ mode: "change" }, true);
    const component = build();
    component.emailForm.setValue({ newEmail: "next@example.test" });
    component.nextFromEmail();
    component.passwordForm.setValue({ password: "correct-horse-battery" });

    component.nextFromPassword();
    expect(component.step()).toBe(3);
    expect(auth.requestEmailChange).not.toHaveBeenCalled();

    await component.submit();
    expect(auth.requestEmailChange).not.toHaveBeenCalled();

    component.factorForm.setValue({ factorCode: "123456" });
    await component.submit();
    expect(auth.requestEmailChange).toHaveBeenCalledWith("next@example.test", "correct-horse-battery", "123456");
    expect(component.step()).toBe(4);
  });

  it("cancels a pending change without pretending the address was confirmed", async () => {
    configure({ mode: "cancel", pendingEmail: "next@example.test" });
    const component = build();

    expect(component.title()).toContain("Cancelar");
    // No address is collected in this mode: the step exists only to take the credential.
    component.nextFromEmail();
    expect(component.step()).toBe(2);
    component.passwordForm.setValue({ password: "correct-horse-battery" });

    await component.submit();

    expect(auth.cancelEmailChange).toHaveBeenCalledWith("correct-horse-battery", undefined);
    expect(auth.requestEmailChange).not.toHaveBeenCalled();
    expect(component.isDone()).toBeTrue();
  });

  it("drops the factor when stepping back to the password step", () => {
    configure({ mode: "change" }, true);
    const component = build();
    component.emailForm.setValue({ newEmail: "next@example.test" });
    component.nextFromEmail();
    component.passwordForm.setValue({ password: "correct-horse-battery" });
    component.nextFromPassword();
    component.factorForm.setValue({ factorCode: "123456" });

    component.back();

    expect(component.step()).toBe(2);
    expect(component.factorForm.controls.factorCode.value).toBe("");
  });

  it("keeps the secrets out of a session that changed while the dialog was open", async () => {
    configure({ mode: "change" }, true);
    const component = build();
    component.emailForm.setValue({ newEmail: "next@example.test" });
    component.nextFromEmail();
    component.passwordForm.setValue({ password: "correct-horse-battery" });
    component.nextFromPassword();
    component.factorForm.setValue({ factorCode: "123456" });
    generation = 4;

    await component.submit();

    expect(auth.requestEmailChange).not.toHaveBeenCalled();
    expect(component.error()).toContain("Tu sesión ha cambiado");
    expect(component.step()).toBe(1);
    expect(component.passwordForm.controls.password.value).toBe("");
    expect(component.factorForm.controls.factorCode.value).toBe("");
  });

  it("surfaces the API message and clears the credentials after a refusal", async () => {
    const component = build();
    component.emailForm.setValue({ newEmail: "taken@example.test" });
    component.nextFromEmail();
    component.passwordForm.setValue({ password: "correct-horse-battery" });
    auth.requestEmailChange.and.rejectWith(new ApiRequestError("Ese email ya está en uso", 422));

    await component.submit();

    expect(component.error()).toBe("Ese email ya está en uso");
    expect(component.isDone()).toBeFalse();
    expect(component.passwordForm.controls.password.value).toBe("");
    expect(component.emailForm.controls.newEmail.value).toBe("taken@example.test");
    expect(ref.disableClose).toBeFalse();
  });
});
