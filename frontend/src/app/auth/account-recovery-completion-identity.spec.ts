import { Location } from "@angular/common";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, provideRouter } from "@angular/router";
import { ApiService } from "../core/services/api.service";
import { AuthService } from "../core/services/auth.service";
import { AccountRecoveryCompleteComponent } from "./account-recovery-complete.component";

const TOKEN = "r".repeat(43);
const VALUES = { password: "brujula-limonero-zafiro-93", confirm: "brujula-limonero-zafiro-93", confirmation: "RECUPERAR MI CUENTA" };

function configure(api: jasmine.SpyObj<ApiService>, auth?: unknown): void {
  TestBed.configureTestingModule({
    imports: [AccountRecoveryCompleteComponent],
    providers: [
      provideRouter([]),
      { provide: ApiService, useValue: api },
      { provide: ActivatedRoute, useValue: { snapshot: { fragment: `token=${TOKEN}`, queryParamMap: { get: () => null } } } },
      { provide: Location, useValue: { replaceState: jasmine.createSpy("replaceState") } },
      ...(auth ? [{ provide: AuthService, useValue: auth }] : []),
    ],
  });
}

describe("account recovery completion browser identity", () => {
  afterEach(() => TestBed.resetTestingModule());

  for (const current of [true, false]) {
    it(`reconciles only the affected identity (current=${current})`, async () => {
      const api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
      api.post.and.callFake(async (_url, _body, decode) => decode!({ ok: true, message: "Cuenta recuperada", current }) as never);
      const auth = { sessionGeneration: () => 7, accountSignedOut: jasmine.createSpy("accountSignedOut") };
      configure(api, auth);
      const component = TestBed.createComponent(AccountRecoveryCompleteComponent).componentInstance;
      component.form.setValue(VALUES);
      await component.complete();
      expect(component.ok()).toBeTrue();
      expect(component.done()).toBeTrue();
      expect(component.form.controls.password.value).toBe("");
      if (current) {
        expect(auth.accountSignedOut).toHaveBeenCalledOnceWith(7);
      } else {
        expect(auth.accountSignedOut).not.toHaveBeenCalled();
      }
    });
  }

  for (const current of [undefined, "true", 1]) {
    it(`rejects an untrusted identity acknowledgement (${String(current)})`, async () => {
      const api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
      api.post.and.callFake(async (_url, _body, decode) => decode!({ ok: true, message: "Cuenta recuperada", current }) as never);
      const auth = { sessionGeneration: () => 7, accountSignedOut: jasmine.createSpy("accountSignedOut") };
      configure(api, auth);
      const component = TestBed.createComponent(AccountRecoveryCompleteComponent).componentInstance;
      component.form.setValue(VALUES);
      await component.complete();
      expect(component.done()).toBeFalse();
      expect(component.ok()).toBeFalse();
      expect(component.error()).toBeTruthy();
      expect(component.form.controls.password.value).toBe(VALUES.password);
      expect(auth.accountSignedOut).not.toHaveBeenCalled();
    });
  }

  it("does not sign out on a rejected acknowledgement", async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
    api.post.and.callFake(async (_url, _body, decode) => decode!({ ok: false, message: "Cuenta recuperada", current: true }) as never);
    const auth = { sessionGeneration: () => 7, accountSignedOut: jasmine.createSpy("accountSignedOut") };
    configure(api, auth);
    const component = TestBed.createComponent(AccountRecoveryCompleteComponent).componentInstance;
    component.form.setValue(VALUES);
    await component.complete();
    expect(component.done()).toBeFalse();
    expect(auth.accountSignedOut).not.toHaveBeenCalled();
  });

  it("reconciles the revoked identity after destruction without mutating the retired form", async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
    let resolve!: (value: unknown) => void;
    const reply = new Promise<unknown>((done) => { resolve = done; });
    api.post.and.callFake(async (_url, _body, decode) => decode!(await reply) as never);
    const auth = { sessionGeneration: () => 7, accountSignedOut: jasmine.createSpy("accountSignedOut") };
    configure(api, auth);
    const fixture = TestBed.createComponent(AccountRecoveryCompleteComponent);
    fixture.componentInstance.form.setValue(VALUES);
    const completing = fixture.componentInstance.complete();
    fixture.destroy();
    resolve({ ok: true, message: "Cuenta recuperada", current: true });
    await completing;
    expect(auth.accountSignedOut).toHaveBeenCalledOnceWith(7);
    expect(fixture.componentInstance.done()).toBeFalse();
    expect(fixture.componentInstance.form.controls.password.value).toBe(VALUES.password);
  });

  it("does not erase a newer identity on a delayed acknowledgement", async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
    let resolve!: (value: unknown) => void;
    const reply = new Promise<unknown>((done) => { resolve = done; });
    api.post.and.callFake(async (_url, _body, decode) => decode!(await reply) as never);
    configure(api);
    const auth = TestBed.inject(AuthService);
    const fixture = TestBed.createComponent(AccountRecoveryCompleteComponent);
    fixture.componentInstance.form.setValue(VALUES);
    const completing = fixture.componentInstance.complete();
    auth.accountSignedOut();
    const newerIdentity = { id: 23 } as never;
    auth.user.set(newerIdentity);
    const generation = auth.sessionGeneration();
    resolve({ ok: true, message: "Cuenta recuperada", current: true });
    await completing;
    expect(auth.user()).toBe(newerIdentity);
    expect(auth.sessionGeneration()).toBe(generation);
    expect(fixture.componentInstance.ok()).toBeTrue();
  });
});
