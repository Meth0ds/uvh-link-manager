import { signal, type WritableSignal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { MatDialogRef } from "@angular/material/dialog";
import type { AuthUser } from "../../core/models";
import { ApiRequestError } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { PasswordChangeDialogComponent } from "./password-change-dialog.component";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

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

describe("PasswordChangeDialogComponent", () => {
  type AuthMethods = Pick<AuthService, "sessionGeneration" | "changePassword" | "user">;
  let auth: jasmine.SpyObj<AuthMethods> & { user: WritableSignal<AuthUser | null> };
  let ref: { disableClose: boolean; close: jasmine.Spy };
  let generation: number;

  beforeEach(() => {
    generation = 1;
    const authSpy = jasmine.createSpyObj<AuthMethods>("AuthService", ["sessionGeneration", "changePassword", "user"]);
    auth = Object.assign(authSpy, { user: signal<AuthUser | null>(user(false)) });
    auth.sessionGeneration.and.callFake(() => generation);
    auth.changePassword.and.resolveTo();

    ref = { disableClose: true, close: jasmine.createSpy("close") };

    TestBed.configureTestingModule({
      providers: [
        { provide: AuthService, useValue: auth },
        { provide: MatDialogRef, useValue: ref },
      ],
    });
  });

  function build(): PasswordChangeDialogComponent {
    return TestBed.runInInjectionContext(() => new PasswordChangeDialogComponent());
  }

  function fill(component: PasswordChangeDialogComponent, current = "old-password", next = "a-long-new-password"): void {
    component.passwordForm.setValue({ current, next, confirm: next });
  }

  it("refuses to submit when the session generation changed while the dialog was open", async () => {
    const component = build();
    fill(component);
    // The account context changed under the overlay: the frozen generation no
    // longer describes the session the password would be changed in.
    generation = 2;

    await component.submit();

    expect(auth.changePassword).not.toHaveBeenCalled();
    expect(component.error()).toContain("Tu sesión ha cambiado");
    expect(component.step()).toBe(1);
    expect(component.passwordForm.controls.current.value).toBe("");
    expect(component.busy()).toBeFalse();
  });

  it("keeps the dialog unclosable while the mutation is in flight and reopens it after", async () => {
    const component = build();
    fill(component);
    const pending = deferred<void>();
    auth.changePassword.and.returnValue(pending.promise);

    const submission = component.submit();
    // Closing here would make a mutation the backend may already be running look
    // cancelled, and the operator would retry on an unchanged password.
    expect(ref.disableClose).toBeTrue();
    expect(component.busy()).toBeTrue();

    pending.resolve();
    await submission;

    expect(ref.disableClose).toBeFalse();
    expect(component.busy()).toBeFalse();
    expect(component.isDone()).toBeTrue();
  });

  it("clears the secrets after a failed attempt and never claims the password changed", async () => {
    const component = build();
    fill(component, "old-password", "correct-horse-battery");
    auth.changePassword.and.rejectWith(new ApiRequestError("La contraseña actual no es correcta", 422));

    await component.submit();

    expect(component.passwordForm.controls.current.value).toBe("");
    expect(component.passwordForm.controls.next.value).toBe("");
    expect(component.passwordForm.controls.confirm.value).toBe("");
    expect(component.error()).toBe("La contraseña actual no es correcta");
    expect(component.isDone()).toBeFalse();
    expect(component.step()).toBe(1);
    expect(ref.disableClose).toBeFalse();
  });

  it("requires a second step with a valid factor before submitting when MFA is on", async () => {
    auth.user.set(user(true));
    const component = build();
    fill(component);

    component.continueFromPassword();
    expect(component.step()).toBe(2);
    expect(auth.changePassword).not.toHaveBeenCalled();

    // A malformed factor never reaches the network.
    component.factorForm.setValue({ factorCode: "12345" });
    await component.submit();
    expect(auth.changePassword).not.toHaveBeenCalled();
    expect(component.busy()).toBeFalse();

    component.factorForm.setValue({ factorCode: "123456" });
    await component.submit();
    expect(auth.changePassword).toHaveBeenCalledWith("old-password", "a-long-new-password", "123456");
    expect(component.step()).toBe(3);
  });

  it("discards the secrets when the overlay is destroyed", () => {
    const fixture = TestBed.createComponent(PasswordChangeDialogComponent);
    fixture.detectChanges();
    const component = fixture.componentInstance;
    fill(component);
    component.reveal.set(true);

    fixture.destroy();

    expect(component.passwordForm.controls.current.value).toBe("");
    expect(component.passwordForm.controls.next.value).toBe("");
    expect(component.factorForm.controls.factorCode.value).toBe("");
    expect(component.reveal()).toBeFalse();
  });
});
