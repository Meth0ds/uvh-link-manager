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
    auth = jasmine.createSpyObj<AuthService>("AuthService", ["sessionGeneration", "accountSignedOut", "acceptRegistrationSession", "logout"]);
    auth.sessionGeneration.and.returnValue(7);
    Object.assign(auth, { authenticated: signal(false) });
    auth.acceptRegistrationSession.and.resolveTo(true);
    TestBed.configureTestingModule({
      imports: [VerifyEmailComponent, ResetPasswordComponent, ConfirmEmailChangeComponent],
      providers: [FormBuilder, provideRouter([]),
        { provide: HttpClient, useValue: http },
        { provide: AuthService, useValue: auth },
        { provide: ActivatedRoute, useValue: { snapshot: { fragment: `token=${"t".repeat(43)}`, queryParamMap: { get: () => null } } } },
        { provide: Location, useValue: { replaceState: jasmine.createSpy("replaceState") } },
        { provide: PendingInvitationService, useValue: { pending: signal(false) } },
        { provide: PendingLinkIntentService, useValue: { pending: signal(null), refresh: jasmine.createSpy("refresh").and.resolveTo() } },
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
      http.post.and.returnValues(throwError(() => new HttpErrorResponse({ status: 503, error: { error: "Temporal" } })), of(action === "verify" ? { ok: true, authenticated: false, newAccount: false, user: null, pendingLink: false } : { ok: true, current: false }));
      await perform();
      expect(succeeded()).toBeFalse();
      await perform();
      expect(succeeded()).toBeTrue();
      expect(http.post).toHaveBeenCalledTimes(2);
      expect(auth.accountSignedOut).not.toHaveBeenCalled();
    });
  }

  it("activation explains password strength and offers the legal documents", () => {
    setup("verify");
    const activation = component as VerifyEmailComponent;
    activation.form.controls.password.setValue("password1234");
    expect(activation.passwordStrength()).toBe("Débil");
    activation.form.controls.password.setValue("Órbita-Mango-Cobre-47!");
    expect(activation.passwordStrength()).toBe("Fuerte");
    fixture.detectChanges();
    expect(fixture.nativeElement.querySelector('a[href="/legal/terminos"]')).not.toBeNull();
    expect(fixture.nativeElement.querySelector('a[href="/legal/privacidad"]')).not.toBeNull();
  });

  it("activation confirms success without authenticating or clearing another identity", async () => {
    setup("verify");
    http.post.and.returnValue(of({ ok: true, authenticated: false, newAccount: false, user: null, pendingLink: false }));
    await perform();
    expect(succeeded()).toBeTrue();
    expect(auth.accountSignedOut).not.toHaveBeenCalled();
    await perform();
    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it("shows a panel button after adopting a new registration session", async () => {
    setup("verify");
    const user = { id: 3, email: "owner@example.test", name: "Owner", isAdmin: false, emailVerified: true, mfaEnabled: false };
    http.post.and.returnValue(of({ ok: true, authenticated: true, newAccount: true, user, pendingLink: false }));
    await perform();
    fixture.detectChanges();
    expect(auth.acceptRegistrationSession).toHaveBeenCalledOnceWith(user, 7);
    expect(fixture.nativeElement.textContent).toContain("Cuenta creada correctamente");
    expect(fixture.nativeElement.querySelector('a[href="/app"]')?.textContent).toContain("Ir al panel");
  });

  it("restores the hero before offering its continuation button", async () => {
    setup("verify");
    const user = { id: 3, email: "owner@example.test", name: "Owner", isAdmin: false, emailVerified: true, mfaEnabled: false };
    http.post.and.returnValue(of({ ok: true, authenticated: true, newAccount: true, user, pendingLink: true }));
    await perform();
    fixture.detectChanges();
    expect(TestBed.inject(PendingLinkIntentService).refresh).toHaveBeenCalledTimes(1);
    expect(fixture.nativeElement.querySelector('a[href="/app/links"]')?.textContent).toContain("Continuar con mi enlace");
  });

  it("preserves an existing account until the visitor explicitly switches", async () => {
    setup("verify");
    Object.assign(auth, { authenticated: signal(true) });
    http.post.and.returnValue(of({ ok: true, authenticated: false, newAccount: true, user: null, pendingLink: true }));
    await perform();
    fixture.detectChanges();
    expect(auth.acceptRegistrationSession).not.toHaveBeenCalled();
    expect(auth.logout).not.toHaveBeenCalled();
    expect(fixture.nativeElement.textContent).toContain("Cerrar la sesión actual");
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
