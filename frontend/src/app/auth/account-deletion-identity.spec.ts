import { Location } from "@angular/common";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed, fakeAsync, flushMicrotasks } from "@angular/core/testing";
import { ActivatedRoute, provideRouter } from "@angular/router";
import { apiInterceptor } from "../core/interceptors/api.interceptor";
import type { AuthUser, Workspace } from "../core/models";
import { AuthService } from "../core/services/auth.service";
import { WorkspaceService } from "../core/services/workspace.service";
import { decodeAccountDeletionConfirmation } from "../core/services/public-action-response-decoders";
import { ConfirmAccountDeletionComponent } from "./confirm-account-deletion.component";

const token = "F".repeat(43);
const endpoint = "/api/v1/auth/account-deletion/confirm";
const executeAfter = "2099-10-04T00:00:00Z";
const account = (id: number): AuthUser => ({ id, email: `fixture${id}@example.test`, name: `Account ${id}`, isAdmin: false, emailVerified: true, mfaEnabled: false });
const workspace = (id: number): Workspace => ({ id, name: `Workspace ${id}`, slug: `fixture-${id}`, role: "owner", createdAt: "2026-10-04T00:00:00Z" });

describe("account deletion confirmation response contract", () => {
  for (const current of [true, false]) {
    it(`preserves a trusted current=${current} discriminator`, () => {
      expect<unknown>(decodeAccountDeletionConfirmation({ ok: true, executeAfter, current, token: "private-extra" })).toEqual({ ok: true, executeAfter, current });
    });
  }
  for (const current of [undefined, null, "true", 1, {}]) {
    it(`rejects untrusted ownership ${JSON.stringify(current)}`, () => {
      expect(() => decodeAccountDeletionConfirmation({ ok: true, executeAfter, current })).toThrow();
    });
  }
});

/** Actual component/API/interceptor/Auth. Replacement is observed by /me. */
describe("account deletion confirmed browser identity", () => {
  let auth: AuthService;
  let http: HttpTestingController;
  let workspaces: WorkspaceService;
  beforeEach(() => {
    localStorage.clear();
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    TestBed.configureTestingModule({ imports: [ConfirmAccountDeletionComponent], providers: [
      provideRouter([]), provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(),
      { provide: ActivatedRoute, useValue: { snapshot: { fragment: `token=${token}`, queryParamMap: { get: () => null } } } },
      { provide: Location, useValue: { replaceState: jasmine.createSpy("replaceState") } },
    ] });
    auth = TestBed.inject(AuthService); http = TestBed.inject(HttpTestingController); workspaces = TestBed.inject(WorkspaceService);
    auth.user.set(account(1)); // Initial fixture only.
    workspaces.setList([workspace(10)]);
  });
  afterEach(() => { http.verify(); localStorage.clear(); });
  function post() {
    const request = http.expectOne(endpoint);
    expect(request.request.method).toBe("POST"); expect(request.request.body).toEqual({ token });
    expect(request.request.withCredentials).toBeTrue();
    expect(request.request.headers.get("X-CSRF-Token")).toBe("fixture");
    expect(request.request.headers.has("X-Uvh-Account-Id")).toBeFalse();
    expect(request.request.headers.has("X-Workspace-Id")).toBeFalse();
    return request;
  }
  function original(): void {
    expect(auth.user()).toEqual(account(1)); expect(auth.sessionGeneration()).toBe(0);
    expect(auth.sessionInvalidated()).toBeFalse(); expect(workspaces.currentId()).toBe(10);
    expect(localStorage.getItem("uvh.auth.invalidated")).toBeNull();
  }
  function replacement(): void {
    auth.sessionExpired();
    void auth.me();
    const request = http.expectOne("/api/v1/auth/me"); expect(request.request.headers.has("X-Uvh-Account-Id")).toBeFalse();
    request.flush({ user: account(2) }); flushMicrotasks();
    http.expectOne("/api/v1/workspaces").flush({ workspaces: [workspace(20)] }); flushMicrotasks();
  }
  for (const current of [true, false]) {
    it(`reconciles the owning account only (current=${current})`, fakeAsync(() => {
      const fixture = TestBed.createComponent(ConfirmAccountDeletionComponent); const component = fixture.componentInstance;
      void component.confirm(); flushMicrotasks(); post().flush({ ok: true, executeAfter, current }); flushMicrotasks();
      expect(component.done()).toBeTrue(); expect(component.error()).toBeFalse(); expect(component.busy()).toBeFalse();
      if (current) { expect(auth.user()).toBeNull(); expect(workspaces.currentId()).toBeNull(); expect(auth.sessionGeneration()).toBe(1); }
      else original();
    }));
    it(`reconciles only the owning account after destruction (current=${current})`, fakeAsync(() => {
      const fixture = TestBed.createComponent(ConfirmAccountDeletionComponent); const component = fixture.componentInstance;
      void component.confirm(); flushMicrotasks(); const request = post(); fixture.destroy();
      expect(request.cancelled).toBeFalse(); request.flush({ ok: true, executeAfter, current }); flushMicrotasks();
      expect(component.done()).toBeFalse(); expect(component.error()).toBeFalse();
      if (current) { expect(auth.user()).toBeNull(); expect(workspaces.currentId()).toBeNull(); }
      else original();
    }));
    it(`preserves a legitimate replacement after late current=${current} acknowledgement`, fakeAsync(() => {
      const fixture = TestBed.createComponent(ConfirmAccountDeletionComponent);
      void fixture.componentInstance.confirm(); flushMicrotasks(); const request = post();
      replacement(); const generation = auth.sessionGeneration(); request.flush({ ok: true, executeAfter, current }); flushMicrotasks();
      expect(auth.user()).toEqual(account(2)); expect(auth.sessionGeneration()).toBe(generation);
      expect(auth.sessionInvalidated()).toBeFalse(); expect(workspaces.currentId()).toBe(20);
    }));
  }
  for (const current of [undefined, null, "true", 1, {}]) {
    it(`does not confirm or sign out after malformed ownership ${JSON.stringify(current)}`, fakeAsync(() => {
      const fixture = TestBed.createComponent(ConfirmAccountDeletionComponent); const component = fixture.componentInstance;
      void component.confirm(); flushMicrotasks(); post().flush({ ok: true, executeAfter, current }); flushMicrotasks();
      expect(component.done()).toBeFalse(); expect(component.error()).toBeTrue(); expect(component.busy()).toBeFalse();
      expect(component.message()).toBe("El servidor devolvió una respuesta no válida"); original(); http.expectNone(endpoint);
    }));
  }
  for (const status of [400, 401, 503, 0]) {
    it(`does not sign out or automatically repeat a public bearer refusal ${status}`, fakeAsync(() => {
      const fixture = TestBed.createComponent(ConfirmAccountDeletionComponent); const component = fixture.componentInstance;
      void component.confirm(); flushMicrotasks(); const request = post();
      if (status === 0) request.error(new ProgressEvent("error"));
      else request.flush({ error: "Fixture bearer refusal" }, { status, statusText: "Fixture refusal" });
      flushMicrotasks(); expect(component.done()).toBeFalse(); expect(component.error()).toBeTrue(); original(); http.expectNone(endpoint);
    }));
  }
  it("discards an invalid response after destruction without affecting auth", fakeAsync(() => {
    const fixture = TestBed.createComponent(ConfirmAccountDeletionComponent); const component = fixture.componentInstance;
    void component.confirm(); flushMicrotasks(); const request = post(); fixture.destroy(); request.flush({ ok: true, executeAfter }); flushMicrotasks();
    expect(component.done()).toBeFalse(); expect(component.error()).toBeFalse(); original();
  }));
});
