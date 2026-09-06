import { Location } from "@angular/common";
import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { FormBuilder } from "@angular/forms";
import { ActivatedRoute, provideRouter } from "@angular/router";

import { ApiService } from "../core/services/api.service";
import { PendingInvitationService } from "../core/services/pending-invitation.service";
import { PendingLinkIntentService } from "../core/services/pending-link-intent.service";
import { AccountRecoveryCompleteComponent } from "./account-recovery-complete.component";
import { AccountRecoveryConfirmComponent } from "./account-recovery-confirm.component";
import { AccountRecoveryRequestComponent } from "./account-recovery-request.component";
import { ForgotPasswordComponent } from "./forgot-password.component";
import { ResetPasswordComponent } from "./reset-password.component";
import { VerifyEmailComponent } from "./verify-email.component";
import { ConfirmEmailChangeComponent } from "./confirm-email-change.component";
import { ConfirmDataExportComponent } from "./confirm-data-export.component";
import { ConfirmAccountDeletionComponent } from "./confirm-account-deletion.component";
import { CancelAccountDeletionComponent } from "./cancel-account-deletion.component";
import { SecurityIncidentComponent } from "./security-incident.component";
import { MfaReauthenticateComponent } from "./mfa-reauthenticate.component";
import { AuthService } from "../core/services/auth.service";
import { Router } from "@angular/router";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}

const TOKEN = "t".repeat(43);
const SITE_KEY_NEW = "10000000-ffff-ffff-ffff-000000000002";
const SITE_KEY_OLD = "10000000-ffff-ffff-ffff-000000000003";

function route(fragment: string | null = null): Partial<ActivatedRoute> {
  return { snapshot: { fragment, queryParamMap: { get: () => null } } as unknown as ActivatedRoute["snapshot"] };
}

function sharedProviders(api: jasmine.SpyObj<ApiService>, fragment: string | null = null): unknown[] {
  return [
    FormBuilder,
    provideRouter([]),
    { provide: ApiService, useValue: api },
    { provide: ActivatedRoute, useValue: route(fragment) },
    { provide: Location, useValue: { replaceState: jasmine.createSpy("replaceState") } },
    { provide: PendingLinkIntentService, useValue: { pending: signal(null) } },
    { provide: PendingInvitationService, useValue: { hasPending: () => false } },
  ];
}

describe("public auth views async safety", () => {
  afterEach(() => TestBed.resetTestingModule());

  it("keeps the newest forgot-password hCaptcha configuration", async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post"]);
    api.get.and.resolveTo({ hcaptcha: { enabled: true, siteKey: SITE_KEY_OLD } } as never);
    TestBed.configureTestingModule({
      imports: [ForgotPasswordComponent],
      providers: sharedProviders(api),
    });
    const fixture = TestBed.createComponent(ForgotPasswordComponent);
    const component = fixture.componentInstance;
    await Promise.resolve();
    const older = deferred<{ hcaptcha: { enabled: boolean; siteKey: string } }>();
    const newer = deferred<{ hcaptcha: { enabled: boolean; siteKey: string } }>();
    api.get.and.returnValues(older.promise, newer.promise);

    const first = component.retryCaptchaConfiguration();
    const second = component.retryCaptchaConfiguration();
    newer.resolve({ hcaptcha: { enabled: true, siteKey: SITE_KEY_NEW } });
    await second;
    older.resolve({ hcaptcha: { enabled: true, siteKey: SITE_KEY_OLD } });
    await first;

    expect(component.hcaptchaSiteKey()).toBe(SITE_KEY_NEW);
    fixture.destroy();
  });

  it("ignores a forgot-password submission after destruction", async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post"]);
    api.get.and.resolveTo({ hcaptcha: { enabled: true, siteKey: SITE_KEY_NEW } } as never);
    const response = deferred<unknown>();
    api.post.and.returnValue(response.promise);
    TestBed.configureTestingModule({ imports: [ForgotPasswordComponent], providers: sharedProviders(api) });
    const fixture = TestBed.createComponent(ForgotPasswordComponent);
    const component = fixture.componentInstance;
    component.form.controls.email.setValue("user@example.test");
    component.onCaptchaToken("captcha-token");

    const submission = component.submit();
    fixture.destroy();
    response.resolve({});
    await submission;

    expect(component.sent()).toBeFalse();
  });

  it("ignores a password reset after destruction", async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
    const response = deferred<unknown>();
    api.post.and.returnValue(response.promise);
    TestBed.configureTestingModule({
      imports: [ResetPasswordComponent],
      providers: sharedProviders(api, `token=${TOKEN}`),
    });
    const fixture = TestBed.createComponent(ResetPasswordComponent);
    const component = fixture.componentInstance;
    component.form.setValue({ password: "Safe-password-123!", confirm: "Safe-password-123!" });

    const submission = component.submit();
    fixture.destroy();
    response.resolve({});
    await submission;

    expect(component.done()).toBeFalse();
  });

  it("ignores an account-recovery request after destruction", async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post"]);
    api.get.and.resolveTo({ hcaptcha: { enabled: true, siteKey: SITE_KEY_NEW } } as never);
    const response = deferred<unknown>();
    api.post.and.returnValue(response.promise);
    TestBed.configureTestingModule({
      imports: [AccountRecoveryRequestComponent],
      providers: sharedProviders(api),
    });
    const fixture = TestBed.createComponent(AccountRecoveryRequestComponent);
    const component = fixture.componentInstance;
    component.form.controls.email.setValue("user@example.test");
    component.onCaptchaToken("captcha-token");

    const submission = component.submit();
    fixture.destroy();
    response.resolve({});
    await submission;

    expect(component.sent()).toBeFalse();
  });

  it("ignores account-recovery confirmation after destruction", async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
    const response = deferred<{ ok: true; message: string }>();
    api.post.and.returnValue(response.promise);
    TestBed.configureTestingModule({
      imports: [AccountRecoveryConfirmComponent],
      providers: sharedProviders(api, `token=${TOKEN}`),
    });
    const fixture = TestBed.createComponent(AccountRecoveryConfirmComponent);
    const component = fixture.componentInstance;

    const confirmation = component.confirm();
    fixture.destroy();
    response.resolve({ ok: true, message: "confirmed" });
    await confirmation;

    expect(component.ok()).toBeFalse();
    expect(component.done()).toBeFalse();
  });

  it("does not clear recovery credentials after a destroyed completion", async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
    const response = deferred<{ ok: true; message: string }>();
    api.post.and.returnValue(response.promise);
    TestBed.configureTestingModule({
      imports: [AccountRecoveryCompleteComponent],
      providers: sharedProviders(api, `token=${TOKEN}`),
    });
    const fixture: ComponentFixture<AccountRecoveryCompleteComponent> = TestBed.createComponent(AccountRecoveryCompleteComponent);
    const component = fixture.componentInstance;
    component.form.setValue({
      password: "Safe-password-123!",
      confirm: "Safe-password-123!",
      confirmation: "RECUPERAR MI CUENTA",
    });

    const completion = component.complete();
    fixture.destroy();
    response.resolve({ ok: true, message: "completed" });
    await completion;

    expect(component.done()).toBeFalse();
    expect(component.form.controls.password.value).toBe("Safe-password-123!");
  });

  it("ignores email verification UI after destruction", async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
    const response = deferred<unknown>();
    api.post.and.returnValue(response.promise);
    TestBed.configureTestingModule({
      imports: [VerifyEmailComponent],
      providers: sharedProviders(api, `token=${TOKEN}`),
    });
    const fixture = TestBed.createComponent(VerifyEmailComponent);
    const component = fixture.componentInstance;

    const verification = component.verify();
    fixture.destroy();
    response.resolve({});
    await verification;

    expect(component.ok()).toBeFalse();
    expect(component.done()).toBeFalse();
  });

  it("reconciles email-change signout without updating a destroyed view", async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
    const response = deferred<unknown>();
    api.post.and.returnValue(response.promise);
    const auth = jasmine.createSpyObj<AuthService>("AuthService", ["sessionGeneration", "accountSignedOut"]);
    auth.sessionGeneration.and.returnValue(7);
    TestBed.configureTestingModule({
      imports: [ConfirmEmailChangeComponent],
      providers: [...sharedProviders(api, `token=${TOKEN}`), { provide: AuthService, useValue: auth }],
    });
    const fixture = TestBed.createComponent(ConfirmEmailChangeComponent);
    const component = fixture.componentInstance;

    const confirmation = component.confirm();
    fixture.destroy();
    response.resolve({});
    await confirmation;

    expect(auth.accountSignedOut).toHaveBeenCalledOnceWith(7);
    expect(component.ok()).toBeFalse();
    expect(component.done()).toBeFalse();
  });

  it("ignores export confirmation UI after destruction", async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
    const response = deferred<unknown>();
    api.post.and.returnValue(response.promise);
    TestBed.configureTestingModule({
      imports: [ConfirmDataExportComponent],
      providers: sharedProviders(api, `token=${TOKEN}`),
    });
    const fixture = TestBed.createComponent(ConfirmDataExportComponent);
    const component = fixture.componentInstance;

    const confirmation = component.confirm();
    fixture.destroy();
    response.resolve({});
    await confirmation;

    expect(component.ok()).toBeFalse();
    expect(component.done()).toBeFalse();
  });

  it("reconciles deletion signout without updating a destroyed view", async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
    const response = deferred<{ ok: true; executeAfter: string }>();
    api.post.and.returnValue(response.promise);
    const auth = jasmine.createSpyObj<AuthService>("AuthService", ["sessionGeneration", "accountSignedOut"]);
    auth.sessionGeneration.and.returnValue(8);
    TestBed.configureTestingModule({
      imports: [ConfirmAccountDeletionComponent],
      providers: [...sharedProviders(api, `token=${TOKEN}`), { provide: AuthService, useValue: auth }],
    });
    const fixture = TestBed.createComponent(ConfirmAccountDeletionComponent);
    const component = fixture.componentInstance;

    const confirmation = component.confirm();
    fixture.destroy();
    response.resolve({ ok: true, executeAfter: "2026-09-12T00:00:00Z" });
    await confirmation;

    expect(auth.accountSignedOut).toHaveBeenCalledOnceWith(8);
    expect(component.done()).toBeFalse();
  });

  it("ignores deletion cancellation UI after destruction", async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
    const response = deferred<unknown>();
    api.post.and.returnValue(response.promise);
    TestBed.configureTestingModule({
      imports: [CancelAccountDeletionComponent],
      providers: sharedProviders(api, `token=${TOKEN}`),
    });
    const fixture = TestBed.createComponent(CancelAccountDeletionComponent);
    const component = fixture.componentInstance;

    const cancellation = component.cancel();
    fixture.destroy();
    response.resolve({});
    await cancellation;

    expect(component.done()).toBeFalse();
    expect(component.error()).toBeFalse();
  });

  it("reconciles incident signout without updating a destroyed view", async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
    const response = deferred<{ ok: true; message: string }>();
    api.post.and.returnValue(response.promise);
    const auth = jasmine.createSpyObj<AuthService>("AuthService", ["sessionGeneration", "accountSignedOut"]);
    auth.sessionGeneration.and.returnValue(9);
    TestBed.configureTestingModule({
      imports: [SecurityIncidentComponent],
      providers: [...sharedProviders(api, `token=${TOKEN}`), { provide: AuthService, useValue: auth }],
    });
    const fixture = TestBed.createComponent(SecurityIncidentComponent);
    const component = fixture.componentInstance;

    const revocation = component.revoke();
    fixture.destroy();
    response.resolve({ ok: true, message: "revoked" });
    await revocation;

    expect(auth.accountSignedOut).toHaveBeenCalledOnceWith(9);
    expect(component.ok()).toBeFalse();
    expect(component.done()).toBeFalse();
  });

  it("does not navigate when MFA initialization finishes after destruction", async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["get"]);
    const status = deferred<{ enabled: boolean; fresh: boolean; verifiedAt: null; expiresAt: null }>();
    const auth = jasmine.createSpyObj<AuthService>("AuthService", [
      "init", "mfaSessionStatus", "reauthenticateMfa", "clearAdminMfaReauthentication",
    ]);
    Object.assign(auth, {
      loaded: signal(true),
      authenticated: signal(true),
      user: signal({ id: 1, email: "admin@example.test", name: "Admin", isAdmin: true, emailVerified: true, mfaEnabled: true }),
    });
    auth.mfaSessionStatus.and.returnValue(status.promise);
    const router = jasmine.createSpyObj<Router>("Router", ["navigate", "navigateByUrl"]);
    router.navigate.and.resolveTo(true);
    router.navigateByUrl.and.resolveTo(true);
    TestBed.configureTestingModule({
      imports: [MfaReauthenticateComponent],
      providers: [
        ...sharedProviders(api),
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
      ],
    });
    const fixture = TestBed.createComponent(MfaReauthenticateComponent);

    fixture.destroy();
    status.resolve({ enabled: true, fresh: true, verifiedAt: null, expiresAt: null });
    await Promise.resolve();
    await Promise.resolve();

    expect(router.navigate).not.toHaveBeenCalled();
    expect(router.navigateByUrl).not.toHaveBeenCalled();
  });
});
