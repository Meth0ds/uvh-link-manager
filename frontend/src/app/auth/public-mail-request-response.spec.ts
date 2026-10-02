import { HttpClient } from "@angular/common/http";
import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { FormBuilder } from "@angular/forms";
import { provideRouter } from "@angular/router";
import { of } from "rxjs";
import { ApiService } from "../core/services/api.service";
import { AuthService } from "../core/services/auth.service";
import { PendingInvitationService } from "../core/services/pending-invitation.service";
import { PendingLinkIntentService } from "../core/services/pending-link-intent.service";
import { ForgotPasswordComponent } from "./forgot-password.component";

describe("public mail request confirmations", () => {
  let http: jasmine.SpyObj<HttpClient>;
  let component: ForgotPasswordComponent;
  let auth: AuthService;

  beforeEach(() => {
    http = jasmine.createSpyObj<HttpClient>("HttpClient", ["get", "post"]);
    TestBed.configureTestingModule({
      imports: [ForgotPasswordComponent],
      providers: [FormBuilder, provideRouter([]), { provide: HttpClient, useValue: http },
        { provide: PendingInvitationService, useValue: { pending: signal(false) } },
        { provide: PendingLinkIntentService, useValue: { pending: signal(null) } },
      ],
    });
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    spyOn(TestBed.inject(ApiService), "get").and.resolveTo({ hcaptcha: { enabled: true, siteKey: "10000000-ffff-ffff-ffff-000000000001" } });
    auth = TestBed.inject(AuthService);
    component = TestBed.createComponent(ForgotPasswordComponent).componentInstance;
    component.form.controls.email.setValue("owner@example.test");
    component.onCaptchaToken("fixture-captcha");
  });

  afterEach(() => TestBed.resetTestingModule());

  for (const action of ["reset", "resend"] as const) {
    for (const payload of [null, "<html>secret</html>", {}, { ok: false }, { ok: "true" }]) {
      it(`${action} rejects an invalid confirmation ${JSON.stringify(payload)}`, async () => {
        http.post.and.returnValue(of(payload));
        if (action === "reset") {
          await component.submit();
          expect(component.sent()).toBeFalse();
          expect(component.busy()).toBeFalse();
          expect(component.error()).toBe("El servidor devolvió una respuesta no válida");
          expect(component.captchaToken()).toBe("");
        } else {
          await expectAsync(auth.resendVerification("owner@example.test", "fixture-captcha")).toBeRejectedWith(jasmine.objectContaining({ status: 502, message: "El servidor devolvió una respuesta no válida" }));
          expect(auth.user()).toBeNull();
        }
      });
    }

    it(`${action} accepts a valid generic confirmation without authentication`, async () => {
      http.post.and.returnValue(of({ ok: true }));
      if (action === "reset") {
        await component.submit();
        expect(component.sent()).toBeTrue();
      } else {
        await expectAsync(auth.resendVerification("owner@example.test", "fixture-captcha")).toBeResolved();
      }
      expect(auth.user()).toBeNull();
      expect(http.post).toHaveBeenCalledTimes(1);
    });
  }

  it("reset allows a manual retry with a fresh CAPTCHA after invalid confirmation", async () => {
    http.post.and.returnValues(of({ ok: false }), of({ ok: true }));
    await component.submit();
    expect(component.sent()).toBeFalse();
    await component.submit();
    expect(http.post).toHaveBeenCalledTimes(1);
    component.onCaptchaToken("new-fixture-captcha");
    await component.submit();
    expect(component.sent()).toBeTrue();
    expect(component.error()).toBeNull();
    expect(http.post).toHaveBeenCalledTimes(2);
  });

  it("reset does not repeat a confirmed request when submit is invoked again", async () => {
    http.post.and.returnValue(of({ ok: true }));
    await component.submit();
    await component.submit();
    expect(component.sent()).toBeTrue();
    expect(http.post).toHaveBeenCalledTimes(1);
  });

});
