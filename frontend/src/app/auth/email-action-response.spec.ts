import { HttpClient, HttpErrorResponse } from "@angular/common/http";
import { Location } from "@angular/common";
import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FormBuilder } from "@angular/forms";
import { ActivatedRoute, provideRouter } from "@angular/router";
import { of, Subject, throwError } from "rxjs";
import { AuthService } from "../core/services/auth.service";
import { PendingInvitationService } from "../core/services/pending-invitation.service";
import { PendingLinkIntentService } from "../core/services/pending-link-intent.service";
import { ConfirmEmailChangeComponent } from "./confirm-email-change.component";
import { ResetPasswordComponent } from "./reset-password.component";
import { VerifyEmailComponent } from "./verify-email.component";

type Action = "verify" | "reset" | "email";
type View = VerifyEmailComponent | ResetPasswordComponent | ConfirmEmailChangeComponent;

describe("email action response contracts", () => {
  let http: jasmine.SpyObj<HttpClient>;
  let auth: jasmine.SpyObj<AuthService>;
  let fixture: ComponentFixture<View>;
  let component: View;

  function setup(action: Action): void {
    http = jasmine.createSpyObj<HttpClient>("HttpClient", ["get", "post"]);
    auth = jasmine.createSpyObj<AuthService>("AuthService", ["sessionGeneration", "accountSignedOut"]);
    auth.sessionGeneration.and.returnValue(7);
    TestBed.configureTestingModule({
      imports: [VerifyEmailComponent, ResetPasswordComponent, ConfirmEmailChangeComponent],
      providers: [FormBuilder, provideRouter([]),
        { provide: HttpClient, useValue: http },
        { provide: AuthService, useValue: auth },
        { provide: ActivatedRoute, useValue: { snapshot: { fragment: `token=${"t".repeat(43)}`, queryParamMap: { get: () => null } } } },
        { provide: Location, useValue: { replaceState: jasmine.createSpy("replaceState") } },
        { provide: PendingInvitationService, useValue: { pending: signal(false) } },
        { provide: PendingLinkIntentService, useValue: { pending: signal(null) } },
      ],
    });
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    fixture = TestBed.createComponent<View>(action === "verify" ? VerifyEmailComponent : action === "reset" ? ResetPasswordComponent : ConfirmEmailChangeComponent);
    component = fixture.componentInstance;
    if (component instanceof ResetPasswordComponent) component.form.setValue({ password: "brujula-limonero-zafiro-93", confirm: "brujula-limonero-zafiro-93" });
    if (component instanceof VerifyEmailComponent) component.form.setValue({ name: "Mailbox Owner", password: "brujula-limonero-zafiro-93", confirm: "brujula-limonero-zafiro-93", acceptTerms: true });
  }

  function perform(): Promise<void> {
    return component instanceof VerifyEmailComponent ? component.verify() : component instanceof ResetPasswordComponent ? component.submit() : component.confirm();
  }

  function succeeded(): boolean {
    return component instanceof ResetPasswordComponent ? component.done() : component.ok();
  }

  afterEach(() => TestBed.resetTestingModule());

  for (const action of ["verify", "reset", "email"] as const) {
    for (const payload of [null, {}, "<html>secret</html>", { ok: false }, { ok: "true" }]) {
      it(`${action} rejects malformed success ${JSON.stringify(payload)}`, async () => {
        setup(action);
        http.post.and.returnValue(of(payload));
        await perform();
        expect(succeeded()).toBeFalse();
        expect(auth.accountSignedOut).not.toHaveBeenCalled();
        expect(component.busy()).toBeFalse();
        const message = component instanceof ResetPasswordComponent ? component.error() : component.message();
        expect(message).toBe("El servidor devolvió una respuesta no válida");
        expect(message).not.toContain("secret");
      });
    }

    it(`${action} can deliberately retry after a transient failure`, async () => {
      setup(action);
      http.post.and.returnValues(throwError(() => new HttpErrorResponse({ status: 503, error: { error: "Temporal" } })), of(action === "verify" ? { ok: true } : { ok: true, current: false }));
      await perform();
      expect(succeeded()).toBeFalse();
      await perform();
      expect(succeeded()).toBeTrue();
      expect(http.post).toHaveBeenCalledTimes(2);
      expect(auth.accountSignedOut).not.toHaveBeenCalled();
    });
  }

  it("activation confirms success without authenticating or clearing another identity", async () => {
    setup("verify");
    http.post.and.returnValue(of({ ok: true }));
    await perform();
    expect(succeeded()).toBeTrue();
    expect(auth.accountSignedOut).not.toHaveBeenCalled();
    await perform();
    expect(http.post).toHaveBeenCalledTimes(1);
  });

  for (const action of ["reset", "email"] as const) {
    for (const current of [true, false]) {
      it(`${action} reconciles only its own browser identity (current=${current})`, async () => {
        setup(action);
        http.post.and.returnValue(of({ ok: true, current }));
        await perform();
        expect(succeeded()).toBeTrue();
        expect(auth.accountSignedOut).toHaveBeenCalledTimes(current ? 1 : 0);
        if (current) expect(auth.accountSignedOut).toHaveBeenCalledWith(7);
      });
    }
    for (const current of [undefined, "true"]) {
      it(`${action} requires an explicit boolean session consequence (${current})`, async () => {
        setup(action);
        http.post.and.returnValue(of({ ok: true, current }));
        await perform();
        expect(succeeded()).toBeFalse();
        expect(auth.accountSignedOut).not.toHaveBeenCalled();
      });
    }
  }

  for (const current of [true, false]) {
    it(`reset completion after destruction reconciles only affected auth (current=${current})`, async () => {
      setup("reset");
      const response = new Subject<unknown>();
      http.post.and.returnValue(response);
      const submission = perform();
      await Promise.resolve();
      fixture.destroy();
      response.next({ ok: true, current });
      response.complete();
      await submission;
      expect(auth.accountSignedOut).toHaveBeenCalledTimes(current ? 1 : 0);
      expect(succeeded()).toBeFalse();
    });
  }

  for (const action of ["verify", "reset"] as const) {
    it(`${action} stops asking for credentials after the server rejects the bearer`, async () => {
      setup(action);
      http.post.and.returnValue(throwError(() => new HttpErrorResponse({ status: 400, error: { error: "Enlace caducado" } })));
      await perform();
      fixture.detectChanges();
      expect(fixture.nativeElement.querySelector("form")).toBeNull();
      expect(fixture.nativeElement.textContent).toContain("Solicitar otro enlace");
      await perform();
      expect(http.post).toHaveBeenCalledTimes(1);
      expect(succeeded()).toBeFalse();
    });
  }
});
