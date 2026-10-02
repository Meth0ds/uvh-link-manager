import { HttpClient } from "@angular/common/http";
import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { FormBuilder } from "@angular/forms";
import { provideRouter } from "@angular/router";
import { of } from "rxjs";
import { ApiService } from "../core/services/api.service";
import { PendingInvitationService } from "../core/services/pending-invitation.service";
import { PendingLinkIntentService } from "../core/services/pending-link-intent.service";
import { AccountRecoveryRequestComponent } from "./account-recovery-request.component";

describe("recovery request response contract", () => {
  let http: jasmine.SpyObj<HttpClient>;
  let component: AccountRecoveryRequestComponent;

  beforeEach(() => {
    http = jasmine.createSpyObj<HttpClient>("HttpClient", ["get", "post"]);
    TestBed.configureTestingModule({
      imports: [AccountRecoveryRequestComponent],
      providers: [
        FormBuilder,
        provideRouter([]),
        { provide: HttpClient, useValue: http },
        { provide: PendingInvitationService, useValue: { pending: signal(false) } },
        { provide: PendingLinkIntentService, useValue: { pending: signal(null) } },
      ],
    });
    // Exercise the real POST/decoder pipeline; CAPTCHA/config loading is a
    // separate concern, with no provider network or cookie writes in this test.
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    const api = TestBed.inject(ApiService);
    spyOn(api, "get").and.resolveTo({ hcaptcha: { enabled: true, siteKey: "10000000-ffff-ffff-ffff-000000000001" } });
    component = TestBed.createComponent(AccountRecoveryRequestComponent).componentInstance;
    component.form.controls.email.setValue("owner@example.test");
    component.onCaptchaToken("captcha-fixture");
  });

  afterEach(() => TestBed.resetTestingModule());

  for (const [name, payload] of [
    ["null", null],
    ["HTML", "<html>upstream-secret</html>"],
    ["false ok", { ok: false, message: "upstream-secret" }],
    ["missing message", { ok: true }],
    ["invalid message", { ok: true, message: 123 }],
  ] as const) {
    it(`does not claim an accepted request for ${name}`, async () => {
      http.post.and.returnValue(of(payload));
      await component.submit();
      expect(component.sent()).toBeFalse();
      expect(component.busy()).toBeFalse();
      expect(component.error()).toBe("El servidor devolvió una respuesta no válida");
      expect(component.error()).not.toContain("upstream-secret");
      expect(component.captchaToken()).toBe("");
    });
  }

  it("accepts the generic valid response without treating it as an authenticated account", async () => {
    http.post.and.returnValue(of({ ok: true, message: "Si la cuenta cumple los requisitos, recibirás un enlace." }));
    await component.submit();
    expect(component.sent()).toBeTrue();
    expect(component.error()).toBeNull();
    expect(component.busy()).toBeFalse();
    expect(http.post).toHaveBeenCalledTimes(1);
  });

  it("permits a deliberate retry with a fresh CAPTCHA after an invalid response", async () => {
    http.post.and.returnValues(of({ ok: false, message: "Invalid" }), of({ ok: true, message: "Si la cuenta cumple los requisitos, recibirás un enlace." }));
    await component.submit();
    expect(component.sent()).toBeFalse();
    await component.submit();
    expect(http.post).toHaveBeenCalledTimes(1);
    component.onCaptchaToken("new-captcha-fixture");
    await component.submit();
    expect(http.post).toHaveBeenCalledTimes(2);
    expect(component.sent()).toBeTrue();
    expect(component.error()).toBeNull();
  });
});
