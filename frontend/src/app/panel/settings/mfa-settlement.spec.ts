import { TestBed, fakeAsync, flushMicrotasks } from "@angular/core/testing";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { Router, ActivatedRoute } from "@angular/router";
import { Location } from "@angular/common";
import { MatSnackBar } from "@angular/material/snack-bar";
import type { AuthUser, Session } from "../../core/models";
import { AuthOperationSupersededError, AuthService } from "../../core/services/auth.service";
import { ApiRequestError } from "../../core/services/api.service";
import { apiInterceptor } from "../../core/interceptors/api.interceptor";
import { ActionDialogService } from "../action-dialog.service";
import { SettingsComponent } from "./settings.component";
import QRCode from "qrcode";
import { QR_CODE_IMPORT, type QrCodeGenerator } from "../../core/services/qr-code.service";

const user = (enabled = false): AuthUser => ({ id: 1, email: "user@example.test", name: "Fixture", isAdmin: false, emailVerified: true, mfaEnabled: enabled, recoveryCodesRemaining: enabled ? 10 : 0 });
const setupSecret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
const setupReply = { secret: setupSecret, uri: `otpauth://totp/UVH%3Auser%40example.test?secret=${setupSecret}&issuer=UVH&algorithm=SHA1&digits=6&period=30` };
const issuedCodes = [..."ABCDEFGHJK"].map((last) => `ABCD-EFGH-JKLM-NPQ${last}`);
const session = (id: string, current = false): Session => ({ id, current, user_agent: id, created_at: "2026-10-03T00:00:00Z", last_used_at: "2026-10-03T00:00:00Z", expires_at: "2099-10-03T00:00:00Z", revoked_at: null, mfa_verified_at: null });

describe("MFA confirmation and projection with real auth transport", () => {
  let http: HttpTestingController;
  let auth: AuthService;
  let snack: jasmine.SpyObj<MatSnackBar>;
  let importer: jasmine.Spy<() => Promise<QrCodeGenerator>>;

  beforeEach(() => {
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    snack = jasmine.createSpyObj("MatSnackBar", ["open"]);
    // Keep fakeAsync transport cases deterministic while rendering real PNGs.
    // The service's separate async test exercises its production import.
    importer = jasmine.createSpy("QR importer").and.callFake(() => Promise.resolve(QRCode));
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(),
      { provide: Router, useValue: { navigate: jasmine.createSpy("navigate").and.resolveTo(true), navigateByUrl: jasmine.createSpy("navigateByUrl").and.resolveTo(true) } },
      { provide: ActivatedRoute, useValue: { snapshot: { data: { section: "security" } } } },
      { provide: Location, useValue: { replaceState: jasmine.createSpy("replaceState") } },
      { provide: MatSnackBar, useValue: snack },
      { provide: ActionDialogService, useValue: { confirm: jasmine.createSpy("confirm").and.resolveTo(true) } },
      { provide: QR_CODE_IMPORT, useValue: importer },
    ] });
    // MatSnackBarModule supplies a component injector instance: observe that
    // actual caller rather than a root spy the rendered view never uses.
    TestBed.overrideComponent(SettingsComponent, { add: { providers: [{ provide: MatSnackBar, useValue: snack }] } });
    auth = TestBed.inject(AuthService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  function mount(enabled = false) {
    auth.user.set(user(enabled));
    auth.loaded.set(true);
    const fixture = TestBed.createComponent(SettingsComponent);
    fixture.detectChanges();
    http.expectOne("/api/v1/auth/sessions").flush({ sessions: [session("current", true), session("other")], truncated: false });
    http.expectOne("/api/v1/auth/data-export").flush({ export: null });
    http.expectNone(r => ["/api/v1/auth/data-export/history", "/api/v1/auth/account-deletion", "/api/v1/auth/privacy-requests", "/api/v1/notifications/preferences"].includes(r.url));
    flushMicrotasks();
    fixture.detectChanges();
    snack.open.calls.reset();
    return fixture;
  }
  function observe<T>(promise: Promise<T>) {
    const result = { done: false, error: undefined as unknown };
    void promise.then(() => { result.done = true; }, (error: unknown) => { result.error = error; });
    return result;
  }

  for (const failure of ["import", "render"] as const) {
    it(`keeps admitted manual MFA setup after a QR ${failure} failure without repeating the write`, fakeAsync(() => {
      const fixture = mount();
      expect(importer).not.toHaveBeenCalled();
      const render = jasmine.createSpy("render").and.rejectWith(new Error("Fixture render"));
      if (failure === "import") importer.and.callFake(() => Promise.reject(new Error("Fixture import")));
      else importer.and.resolveTo({ toDataURL: render } as QrCodeGenerator);
      const c = fixture.componentInstance;
      c.mfaPasswordForm.setValue({ password: "fixture" });
      observe(c.startMfaSetup()); flushMicrotasks();
      http.expectOne("/api/v1/auth/mfa/setup").flush(setupReply);
      flushMicrotasks(); fixture.detectChanges();
      expect(importer).toHaveBeenCalledTimes(1);
      expect(c.mfaSecret()).toBe(setupSecret);
      expect(c.mfaUri()).toBe(setupReply.uri);
      expect(c.mfaQr()).toBeNull();
      expect(c.mfaBusy()).toBeFalse();
      expect(c.mfaQrLoading()).toBeFalse();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain(setupSecret);
      expect(snack.open.calls.allArgs().some(([message]) => String(message).includes("Usa la clave manual"))).toBeTrue();
      http.expectNone(r => r.method === "POST");
      fixture.destroy();
    }));
  }

  for (const end of ["owner", "destroy"] as const) {
    it(`does not render private MFA instructions after ${end} changes while library code is loading`, fakeAsync(() => {
      let loaded!: (value: QrCodeGenerator) => void;
      importer.and.returnValue(new Promise<QrCodeGenerator>(done => loaded = done));
      const render = jasmine.createSpy("render").and.resolveTo("data:image/png;base64,fixture");
      const fixture = mount();
      const c = fixture.componentInstance;
      c.mfaPasswordForm.setValue({ password: "fixture" });
      observe(c.startMfaSetup()); flushMicrotasks();
      http.expectOne("/api/v1/auth/mfa/setup").flush(setupReply);
      flushMicrotasks();
      expect(importer).toHaveBeenCalledTimes(1);
      expect(c.mfaBusy()).toBeTrue();
      expect(c.mfaQrLoading()).toBeTrue();
      expect(c.mfaSecret()).toBe(setupSecret);
      if (end === "destroy") fixture.destroy();
      else {
        auth.sessionExpired(); fixture.detectChanges();
        void auth.me(); http.expectOne("/api/v1/auth/me").flush({ user: { ...user(), id: 2, email: "other@example.test" } });
        flushMicrotasks(); http.expectOne("/api/v1/workspaces").flush({ workspaces: [] });
        flushMicrotasks(); fixture.detectChanges();
        http.expectOne("/api/v1/auth/sessions").flush({ sessions: [], truncated: false });
        http.expectOne("/api/v1/auth/data-export").flush({ export: null });
        flushMicrotasks();
      }
      snack.open.calls.reset(); loaded({ toDataURL: render } as QrCodeGenerator); flushMicrotasks();
      expect(render).not.toHaveBeenCalled();
      expect(c.mfaSecret()).toBeNull();
      expect(c.mfaQr()).toBeNull();
      expect(c.mfaQrLoading()).toBeFalse();
      expect(snack.open).not.toHaveBeenCalled();
      http.expectNone(r => r.method === "POST");
      fixture.destroy();
    }));
  }

  for (const outcome of ["success", "failure"] as const) {
    it(`keeps a code entered during QR loading after ${outcome}, clearing only the old setup code`, fakeAsync(() => {
      let resolve!: (generator: QrCodeGenerator) => void;
      let reject!: (error: Error) => void;
      importer.and.returnValue(new Promise<QrCodeGenerator>((done, fail) => { resolve = done; reject = fail; }));
      const fixture = mount(), c = fixture.componentInstance;
      c.mfaCodeForm.setValue({ code: "654321" });
      c.mfaPasswordForm.setValue({ password: "fixture" });
      observe(c.startMfaSetup()); flushMicrotasks();
      http.expectOne("/api/v1/auth/mfa/setup").flush(setupReply);
      flushMicrotasks(); fixture.detectChanges();
      expect(c.mfaCodeForm.controls.code.value).toBe("");
      c.mfaCodeForm.setValue({ code: "123456" });
      fixture.detectChanges();
      expect(c.mfaBusy()).toBeTrue();
      if (outcome === "success") resolve(QRCode); else reject(new Error("Fixture import"));
      flushMicrotasks(); fixture.detectChanges();
      expect(c.mfaCodeForm.controls.code.value).toBe("123456");
      expect(c.mfaBusy()).toBeFalse();
      expect(c.mfaCodeForm.valid).toBeTrue();
      http.expectNone(r => r.method === "POST");
      fixture.destroy();
    }));
  }

  it("does not show a previous QR beside a newly admitted manual key while the library is pending", fakeAsync(() => {
    let loaded!: (value: QrCodeGenerator) => void;
    importer.and.returnValue(new Promise<QrCodeGenerator>(done => loaded = done));
    const fixture = mount();
    const c = fixture.componentInstance;
    c.mfaQr.set("data:image/png;base64,old-fixture");
    c.mfaPasswordForm.setValue({ password: "fixture" });
    observe(c.startMfaSetup()); flushMicrotasks();
    http.expectOne("/api/v1/auth/mfa/setup").flush(setupReply);
    flushMicrotasks(); fixture.detectChanges();
    expect(c.mfaSecret()).toBe(setupSecret);
    expect(c.mfaQr()).toBeNull();
    expect(fixture.nativeElement.querySelector(".mfa-qr")).toBeNull();
    expect(fixture.nativeElement.querySelector(".mfa-qr-loading")?.textContent).toContain("Preparando código QR");
    loaded(QRCode); flushMicrotasks(); fixture.detectChanges();
    expect(c.mfaQr()).toMatch(/^data:image\/png;base64,/);
    const png = Uint8Array.from(atob(c.mfaQr()!.split(",")[1]), char => char.charCodeAt(0));
    expect(new DataView(png.buffer).getUint32(16)).toBe(480);
    expect(new DataView(png.buffer).getUint32(20)).toBe(480);
    expect(c.mfaQrLoading()).toBeFalse();
    fixture.destroy();
  }));
  for (const replacement of [false, true]) {
    it(`never publishes inconsistent ${replacement ? "replacement" : "initial"} manual/QR instructions`, fakeAsync(() => {
      const fixture = mount(replacement);
      const component = fixture.componentInstance;
      const secret = "GEZDGNBVGY3TQOJQGEZDGNBVGY3TQOJQ";
      const wrong = "JBSWY3DPEHPK3PXPJBSWY3DPEHPK3PXP";
      if (replacement) {
        component.beginMfaReconfiguration();
        component.mfaReconfigureForm.setValue({ password: "fixture", factorCode: "123456" });
      } else component.mfaPasswordForm.setValue({ password: "fixture" });
      const result = observe(replacement ? component.startMfaReconfiguration() : component.startMfaSetup());
      flushMicrotasks();
      http.expectOne("/api/v1/auth/mfa/setup").flush({ secret, uri: `otpauth://totp/UVH%3Auser%40example.test?secret=${wrong}&issuer=UVH&algorithm=SHA1&digits=6&period=30` });
      flushMicrotasks();
      // A pre-fix confirmed replacement may start a projection read. Settle
      // that too so the regression targets instructions/confirmation, not I/O.
      for (const read of http.match("/api/v1/auth/me")) read.flush({ error: "Fixture read unavailable" }, { status: 503, statusText: "Unavailable" });
      flushMicrotasks(); fixture.detectChanges();
      expect(result.done).toBeTrue();
      expect(component.mfaSecret()).toBeNull();
      expect(component.mfaUri()).toBeNull();
      expect(component.mfaQr()).toBeNull();
      expect(component.mfaSetupStep()).toBe(1);
      expect(component.mfaBusy()).toBeFalse();
      expect(auth.userMutationUnconfirmed()).toBe(replacement);
      expect(auth.userRefreshRequired()).toBe(replacement);
      const root: HTMLElement = fixture.nativeElement;
      expect(root.querySelector('.mfa-enrol')).toBeNull();
      expect(root.querySelector('.mfa-secret')).toBeNull();
      expect(root.textContent).not.toContain(secret);
      expect(root.textContent).not.toContain(wrong);
      expect(snack.open.calls.count()).toBe(1);
      expect(snack.open.calls.mostRecent().args[0]).toBe("El servidor devolvió una respuesta no válida");
      http.expectNone((r) => r.method === "POST");
    }));
  }

  for (const replacement of [false, true]) {
    it(`presents valid ${replacement ? "replacement" : "initial"} emitter instructions and a real QR`, fakeAsync(() => {
      const fixture = mount(replacement);
      const component = fixture.componentInstance;
      if (replacement) {
        component.beginMfaReconfiguration();
        component.mfaReconfigureForm.setValue({ password: "fixture", factorCode: "123456" });
      } else component.mfaPasswordForm.setValue({ password: "fixture" });
      const result = observe(replacement ? component.startMfaReconfiguration() : component.startMfaSetup());
      flushMicrotasks();
      http.expectOne("/api/v1/auth/mfa/setup").flush(setupReply);
      flushMicrotasks();
      if (replacement) {
        expect(auth.userRefreshRequired()).toBeTrue();
        expect(auth.userMutationUnconfirmed()).toBeFalse();
        http.expectOne("/api/v1/auth/me").flush({ user: user(true) });
        flushMicrotasks();
      } else http.expectNone("/api/v1/auth/me");
      fixture.detectChanges();
      expect(result.done).toBeTrue();
      expect(component.mfaSecret()).toBe(setupSecret);
      expect(component.mfaUri()).toBe(setupReply.uri);
      expect(component.mfaQr()).toMatch(/^data:image\/png;base64,/);
      expect(component.mfaSetupStep()).toBe(2);
      expect(component.mfaBusy()).toBeFalse();
      const root: HTMLElement = fixture.nativeElement;
      expect(root.querySelector('.mfa-secret')?.textContent).toContain(setupSecret);
      expect(root.querySelector('.mfa-qr')).not.toBeNull();
      expect(snack.open).not.toHaveBeenCalled();
      http.expectNone((r) => r.method === "POST");
    }));
  }

  it("keeps validated manual instructions when QR rendering fails without repeating setup", fakeAsync(() => {
    const fixture = mount();
    spyOn(HTMLCanvasElement.prototype, "toDataURL").and.throwError("Fixture canvas unavailable");
    const component = fixture.componentInstance;
    component.mfaPasswordForm.setValue({ password: "fixture" });
    const result = observe(component.startMfaSetup());
    flushMicrotasks();
    http.expectOne("/api/v1/auth/mfa/setup").flush(setupReply);
    flushMicrotasks(); fixture.detectChanges();
    expect(result.done).toBeTrue();
    expect(component.mfaSecret()).toBe(setupSecret);
    expect(component.mfaUri()).toBe(setupReply.uri);
    expect(component.mfaQr()).toBeNull();
    expect(component.mfaSetupStep()).toBe(2);
    expect(component.mfaBusy()).toBeFalse();
    const root: HTMLElement = fixture.nativeElement;
    expect(root.querySelector('.mfa-secret')?.textContent).toContain(setupSecret);
    expect(snack.open.calls.count()).toBe(1);
    expect(snack.open.calls.mostRecent().args[0]).toContain("Usa la clave manual mostrada");
    http.expectNone((r) => r.method === "POST");
  }));

  it("does not publish a valid setup ACK to a destroyed Settings view", fakeAsync(() => {
    const fixture = mount();
    const component = fixture.componentInstance;
    component.mfaPasswordForm.setValue({ password: "fixture" });
    const result = observe(component.startMfaSetup());
    flushMicrotasks();
    const write = http.expectOne("/api/v1/auth/mfa/setup");
    fixture.destroy();
    expect(write.cancelled).toBeFalse();
    write.flush(setupReply);
    flushMicrotasks();
    expect(result.done).toBeTrue();
    expect(component.mfaSecret()).toBeNull();
    expect(component.mfaUri()).toBeNull();
    expect(component.mfaQr()).toBeNull();
    expect(auth.user()?.id).toBe(1);
    expect(snack.open).not.toHaveBeenCalled();
    http.expectNone((r) => r.method === "POST");
  }));

  it("does not publish old setup instructions after an invalidated session observes another account", fakeAsync(() => {
    const fixture = mount();
    const component = fixture.componentInstance;
    component.mfaPasswordForm.setValue({ password: "fixture" });
    observe(component.startMfaSetup());
    flushMicrotasks();
    const write = http.expectOne("/api/v1/auth/mfa/setup");
    auth.sessionExpired();
    fixture.detectChanges();
    observe(auth.me());
    const identity = http.expectOne("/api/v1/auth/me");
    expect(identity.request.headers.has("X-Uvh-Account-Id")).toBeFalse();
    identity.flush({ user: { ...user(), id: 2, email: "other@example.test" } });
    flushMicrotasks();
    http.expectOne("/api/v1/workspaces").flush({ workspaces: [] });
    fixture.detectChanges();
    http.expectOne("/api/v1/auth/sessions").flush({ sessions: [], truncated: false });
    http.expectOne("/api/v1/auth/data-export").flush({ export: null });
    http.expectNone(r => ["/api/v1/auth/data-export/history", "/api/v1/auth/account-deletion", "/api/v1/auth/privacy-requests", "/api/v1/notifications/preferences"].includes(r.url));
    flushMicrotasks(); fixture.detectChanges();
    snack.open.calls.reset();
    expect(write.cancelled).toBeFalse();
    write.flush(setupReply);
    flushMicrotasks(); fixture.detectChanges();
    expect(auth.user()?.id).toBe(2);
    expect(auth.userRefreshRequired()).toBeFalse();
    expect(component.mfaSecret()).toBeNull();
    expect(component.mfaUri()).toBeNull();
    expect(component.mfaQr()).toBeNull();
    expect((fixture.nativeElement as HTMLElement).textContent).not.toContain(setupSecret);
    expect(snack.open).not.toHaveBeenCalled();
    http.expectNone((r) => r.method === "POST");
  }));

  function submit(component: SettingsComponent, mode: "enable" | "disable" | "regenerate") {
    if (mode === "enable") {
      component.mfaSecret.set("ABCDEFGH23456789");
      component.mfaCodeForm.setValue({ code: "123456" });
      return observe(component.enableMfa());
    }
    if (mode === "disable") {
      component.mfaDisableForm.setValue({ password: "fixture", factorCode: "123456" });
      return observe(component.disableMfa());
    }
    component.recoveryRegenerateForm.setValue({ password: "fixture", factorCode: "123456" });
    return observe(component.regenerateRecoveryCodes());
  }
  function path(mode: "enable" | "disable" | "regenerate") {
    return mode === "regenerate" ? "/api/v1/auth/mfa/recovery-codes/regenerate" : `/api/v1/auth/mfa/${mode}`;
  }
  function finishSessionRefresh(): void {
    for (const read of http.match("/api/v1/auth/sessions")) read.flush({ sessions: [session("current", true)], truncated: false });
    flushMicrotasks();
  }

  for (const mode of ["enable", "disable", "regenerate"] as const) {
    it(`refreshes the session registry after confirmed ${mode} revokes other sessions`, fakeAsync(() => {
      const fixture = mount(mode !== "enable");
      const result = submit(fixture.componentInstance, mode);
      flushMicrotasks();
      http.expectOne(path(mode)).flush(mode === "disable" ? { ok: true } : { recoveryCodes: issuedCodes });
      flushMicrotasks();
      http.expectOne("/api/v1/auth/me").flush({ user: user(mode !== "disable") });
      finishSessionRefresh();
      fixture.detectChanges();
      expect(fixture.componentInstance.sessions().map((s) => s.id)).toEqual(["current"]);
      expect(result.done).toBeTrue();
      expect(result.error).toBeUndefined();
      expect(fixture.componentInstance.mfaBusy()).toBeFalse();
      expect(snack.open.calls.allArgs().map((args) => args[0])).not.toContain("No se pudo completar la operación");
    }));

    it(`keeps confirmed ${mode} separate from a failed identity read`, fakeAsync(() => {
      const fixture = mount(mode !== "enable");
      const component = fixture.componentInstance;
      const result = submit(component, mode);
      flushMicrotasks();
      http.expectOne(path(mode)).flush(mode === "disable" ? { ok: true } : { recoveryCodes: issuedCodes });
      flushMicrotasks();
      http.expectOne("/api/v1/auth/me").flush({ error: "Offline" }, { status: 503, statusText: "Unavailable" });
      finishSessionRefresh();
      expect(result.done).toBeTrue();
      expect(auth.userRefreshRequired()).toBeTrue();
      if (mode !== "disable") {
        expect(component.recoveryCodes()).toEqual(issuedCodes);
        component.recoveryCodesAcknowledged.set(true);
        component.finishRecoveryCodes();
      }
      fixture.detectChanges();
      const root: HTMLElement = fixture.nativeElement;
      expect(root.querySelector('.mfa-card .mini-state')?.textContent).toContain("Pendiente de actualizar");
      expect(root.querySelector('.mfa-refresh-notice [role="status"], .mfa-refresh-notice')?.textContent).toContain("Actualizar datos");
      expect(root.querySelector('.mfa-intro')).toBeNull();
      expect(root.querySelector('.mfa-summary')).toBeNull();
      expect(root.querySelector('.security-strip')?.textContent).toContain("Estado de seguridad pendiente de actualizar");
      expect(root.querySelector('.security-strip')?.classList.contains("protected")).toBeFalse();
      http.expectNone((request) => request.method === "POST");
    }));
  }

  for (const mode of ["enable", "regenerate"] as const) {
    for (const invalid of [[], [issuedCodes[0]], Array(10).fill(issuedCodes[0]), issuedCodes.map(() => "OOOO-OOOO-OOOO-OOOO")] as string[][]) {
      it(`rejects an unusable ${mode} code issue instead of clearing the previous configuration`, fakeAsync(() => {
        const fixture = mount(mode !== "enable");
        const component = fixture.componentInstance;
        const result = submit(component, mode);
        flushMicrotasks();
        http.expectOne(path(mode)).flush({ recoveryCodes: invalid });
        flushMicrotasks();
        // Existing code accepts the envelope and starts refresh, which is part
        // of the erroneous success path. Resolve it to expose visible state.
        for (const read of http.match("/api/v1/auth/me")) read.flush({ user: user(true) });
        finishSessionRefresh();
        expect(result.done).toBeTrue();
        expect(component.recoveryCodes()).toEqual([]);
        expect(auth.userRefreshRequired()).toBeTrue();
        expect(auth.userMutationUnconfirmed()).toBeTrue();
        if (mode === "enable") expect(component.mfaSecret()).toBe("ABCDEFGH23456789");
        expect(snack.open.calls.allArgs().map((args) => args[0])).not.toContain(mode === "enable" ? "MFA activado" : "Códigos regenerados");
        expect(snack.open).toHaveBeenCalledWith("El servidor devolvió una respuesta no válida", "Cerrar", jasmine.objectContaining({ duration: 4000 }));
      }));
    }
  }

  it("preserves a confirmed MFA ACK against an older pending profile DTO even if its view is gone", fakeAsync(() => {
    auth.user.set(user());
    const profile = observe(auth.updateProfile("After"));
    flushMicrotasks();
    const command = http.expectOne("/api/v1/auth/profile");
    const mfa = observe(auth.mfaEnable("123456"));
    flushMicrotasks();
    http.expectOne("/api/v1/auth/mfa/enable").flush({ recoveryCodes: issuedCodes });
    flushMicrotasks();
    expect(mfa.done).toBeTrue();
    expect(auth.userRefreshRequired()).toBeTrue();
    command.flush({ user: { ...user(), name: "After" } });
    flushMicrotasks();
    http.expectOne("/api/v1/auth/me").flush({ user: { ...user(true), name: "After" } });
    flushMicrotasks();
    expect(profile.done).toBeTrue();
    expect(auth.user()?.mfaEnabled).toBeTrue();
    expect(auth.userRefreshRequired()).toBeFalse();
  }));

  it("inherits an unresolved security projection when a new profile command begins", fakeAsync(() => {
    auth.user.set(user());
    observe(auth.mfaEnable("123456"));
    flushMicrotasks();
    http.expectOne("/api/v1/auth/mfa/enable").flush({ recoveryCodes: issuedCodes });
    flushMicrotasks();
    const profile = observe(auth.updateProfile("After"));
    flushMicrotasks();
    http.expectOne("/api/v1/auth/profile").flush({ user: { ...user(), name: "After" } });
    flushMicrotasks();
    expect(auth.userRefreshRequired()).toBeTrue();
    http.expectOne("/api/v1/auth/me").flush({ user: { ...user(true), name: "After" } });
    flushMicrotasks();
    expect(profile.done).toBeTrue();
    expect(auth.user()?.mfaEnabled).toBeTrue();
  }));

  it("cancels pre-security identity probes before their old response can hide the confirmed change", fakeAsync(() => {
    auth.user.set(user());
    const old = observe(auth.me());
    const read = http.expectOne("/api/v1/auth/me");
    observe(auth.mfaEnable("123456"));
    flushMicrotasks();
    http.expectOne("/api/v1/auth/mfa/enable").flush({ recoveryCodes: issuedCodes });
    flushMicrotasks();
    expect(read.cancelled).toBeTrue();
    expect(old.error).toEqual(jasmine.any(AuthOperationSupersededError));
    expect(auth.userRefreshRequired()).toBeTrue();
  }));

  it("does not mark a rejected MFA command as committed or cancel its unrelated probe", fakeAsync(() => {
    auth.user.set(user());
    observe(auth.me());
    const read = http.expectOne("/api/v1/auth/me");
    const mfa = observe(auth.mfaEnable("123456"));
    flushMicrotasks();
    http.expectOne("/api/v1/auth/mfa/enable").flush({ error: "Invalid" }, { status: 403, statusText: "Forbidden" });
    flushMicrotasks();
    expect(mfa.error).toEqual(jasmine.any(ApiRequestError));
    expect(auth.userRefreshRequired()).toBeFalse();
    expect(read.cancelled).toBeFalse();
    read.flush({ user: user() });
    flushMicrotasks();
  }));

  for (const remount of [false, true]) {
    it(`recovers an uncertain enrollment after an independent identity read${remount ? " and remount" : ""}`, fakeAsync(() => {
      let fixture = mount();
      submit(fixture.componentInstance, "enable");
      flushMicrotasks();
      http.expectOne("/api/v1/auth/mfa/enable").flush({ recoveryCodes: [] });
      flushMicrotasks();
      expect(auth.userMutationUnconfirmed()).toBeTrue();
      // A profile reconciliation or another caller can own the successful
      // read. It need not pass through Settings' manual-refresh handler.
      observe(auth.me());
      http.expectOne("/api/v1/auth/me").flush({ user: user(true) });
      flushMicrotasks();
      fixture.detectChanges();
      if (remount) {
        fixture.destroy();
        fixture = mount(true);
      }
      expect(fixture.componentInstance.recoveryIssueUnconfirmed()).toBeTrue();
      expect(fixture.componentInstance.mfaSecret()).toBeNull();
      const root: HTMLElement = fixture.nativeElement;
      expect(root.querySelector('.mfa-card')?.textContent).toContain("No se recibieron códigos de recuperación utilizables");
      expect(root.querySelector('.mfa-summary')).not.toBeNull();
      expect(root.querySelector('.mfa-enrol')).toBeNull();
    }));
  }

  const commands = [
    { name: "setup", run: () => auth.mfaSetup("fixture"), path: "/api/v1/auth/mfa/setup", body: { password: "fixture", code: undefined }, reply: setupReply, dirty: false },
    { name: "replace setup", run: () => auth.mfaSetup("fixture", "123456"), path: "/api/v1/auth/mfa/setup", body: { password: "fixture", code: "123456" }, reply: setupReply, dirty: true },
    { name: "enable", run: () => auth.mfaEnable("123456"), path: "/api/v1/auth/mfa/enable", body: { code: "123456" }, reply: { recoveryCodes: issuedCodes }, dirty: true },
    { name: "cancel", run: () => auth.mfaCancelSetup(), path: "/api/v1/auth/mfa/cancel-setup", body: {}, reply: { ok: true }, dirty: false },
    { name: "regenerate", run: () => auth.mfaRegenerateRecoveryCodes("fixture", "123456"), path: "/api/v1/auth/mfa/recovery-codes/regenerate", body: { password: "fixture", factorCode: "123456" }, reply: { recoveryCodes: issuedCodes }, dirty: true },
    { name: "disable", run: () => auth.mfaDisable("fixture", "123456"), path: "/api/v1/auth/mfa/disable", body: { password: "fixture", code: "123456" }, reply: { ok: true }, dirty: true },
  ];
  for (const command of commands) {
    it(`preserves ${command.name} transport and the projection boundary`, fakeAsync(() => {
      auth.user.set(user(true));
      const result = observe<unknown>(command.run());
      flushMicrotasks();
      const request = http.expectOne(command.path);
      expect(request.request.body).toEqual(command.body);
      expect(request.request.headers.get("X-Uvh-Account-Id")).toBe("1");
      request.flush(command.reply);
      flushMicrotasks();
      expect(result.done).toBeTrue();
      expect(auth.userRefreshRequired()).toBe(command.dirty);
      expect(auth.userMutationUnconfirmed()).toBeFalse();
      http.expectNone("/api/v1/auth/me");
    }));

    it(`rejects a late ${command.name} ACK after the observed account changes`, fakeAsync(() => {
      auth.user.set(user(true));
      const result = observe<unknown>(command.run());
      flushMicrotasks();
      const request = http.expectOne(command.path);
      observe(auth.me());
      http.expectOne("/api/v1/auth/me").flush({ user: { ...user(), id: 2 } });
      flushMicrotasks();
      http.expectOne("/api/v1/workspaces").flush({ workspaces: [] });
      flushMicrotasks();
      request.flush(command.reply);
      flushMicrotasks();
      expect(result.error).toEqual(jasmine.any(AuthOperationSupersededError));
      expect(auth.user()?.id).toBe(2);
      expect(auth.userRefreshRequired()).toBeFalse();
      expect(auth.mfaRecoveryIssueUnconfirmed()).toBeFalse();
    }));
  }

  it("keeps a lost recovery issue through repeated reads until a usable issue arrives", fakeAsync(() => {
    auth.user.set(user(true));
    observe(auth.mfaRegenerateRecoveryCodes("fixture", "123456"));
    flushMicrotasks();
    http.expectOne("/api/v1/auth/mfa/recovery-codes/regenerate").flush({ recoveryCodes: [] });
    flushMicrotasks();
    observe(auth.me());
    http.expectOne("/api/v1/auth/me").flush({ user: user(true) });
    flushMicrotasks();
    expect(auth.mfaRecoveryIssueUnconfirmed()).toBeTrue();
    observe(auth.mfaRegenerateRecoveryCodes("fixture", "123456"));
    flushMicrotasks();
    http.expectOne("/api/v1/auth/mfa/recovery-codes/regenerate").flush({ recoveryCodes: issuedCodes });
    flushMicrotasks();
    expect(auth.mfaRecoveryIssueUnconfirmed()).toBeFalse();
    expect(auth.userRefreshRequired()).toBeTrue();
  }));

  it("does not carry an uncertain recovery issue into a replacement identity", fakeAsync(() => {
    auth.user.set(user());
    observe(auth.mfaEnable("123456"));
    flushMicrotasks();
    http.expectOne("/api/v1/auth/mfa/enable").flush({ recoveryCodes: [] });
    flushMicrotasks();
    expect(auth.mfaRecoveryIssueUnconfirmed()).toBeTrue();
    observe(auth.me());
    http.expectOne("/api/v1/auth/me").flush({ user: { ...user(true), id: 2 } });
    flushMicrotasks();
    http.expectOne("/api/v1/workspaces").flush({ workspaces: [] });
    flushMicrotasks();
    expect(auth.userMutationUnconfirmed()).toBeFalse();
    expect(auth.mfaRecoveryIssueUnconfirmed()).toBeFalse();
  }));

  it("requires a read after a transport failure without claiming confirmation or replaying MFA", fakeAsync(() => {
    auth.user.set(user());
    const result = observe(auth.mfaEnable("123456"));
    flushMicrotasks();
    http.expectOne("/api/v1/auth/mfa/enable").error(new ProgressEvent("error"));
    flushMicrotasks();
    expect(result.error).toEqual(jasmine.any(ApiRequestError));
    expect(auth.userRefreshRequired()).toBeTrue();
    expect(auth.userMutationUnconfirmed()).toBeTrue();
    expect(auth.mfaRecoveryIssueUnconfirmed()).toBeTrue();
    http.expectNone((request) => request.method === "POST");
  }));
});
