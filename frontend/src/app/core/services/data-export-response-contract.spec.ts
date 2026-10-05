import { TestBed, fakeAsync, flushMicrotasks } from "@angular/core/testing";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { Router } from "@angular/router";
import type { AuthUser, DataExportStatus } from "../models";
import { apiInterceptor } from "../interceptors/api.interceptor";
import { ApiRequestError } from "./api.service";
import { AuthService } from "./auth.service";
import { decodeDataExportStatusResponse } from "./auth-response-decoders";

const statuses: DataExportStatus["status"][] = ["processing", "ready", "downloaded", "failed", "cancelled", "expired"];
const exported = (status: DataExportStatus["status"], patch: Partial<DataExportStatus> = {}): DataExportStatus => ({
  id: 3, status, stage: null, failureReason: null,
  downloadExpiresAt: status === "ready" ? "2099-10-04T00:00:00Z" : null, createdAt: "2026-10-04T00:00:00Z", readyAt: null, downloadedAt: null, ...patch,
});
const account: AuthUser = { id: 1, email: "fixture@example.test", name: "Fixture", emailVerified: true, mfaEnabled: false, isAdmin: false };
const endpoint = "/api/v1/auth/data-export";
type Surface = "status" | "history" | "request";
function observe<T>(promise: Promise<T>): { value?: T; error?: unknown } {
  const result: { value?: T; error?: unknown } = {};
  void promise.then((value) => { result.value = value; }, (error: unknown) => { result.error = error; });
  return result;
}

/** Relations come from publicExport, not assumptions about nullable legacy dates. */
describe("Data export response consistency", () => {
  for (const status of statuses.filter((state) => state !== "processing")) {
    it(`rejects a live stage attached to ${status}`, () => {
      expect(() => decodeDataExportStatusResponse({ export: exported(status, { stage: "collecting" }) })).toThrow();
    });
  }
  for (const status of statuses.filter((state) => state !== "failed")) {
    it(`rejects a failure reason attached to ${status}`, () => {
      expect(() => decodeDataExportStatusResponse({ export: exported(status, { failureReason: "generation_error" }) })).toThrow();
    });
  }
  for (const status of statuses) {
    it(`preserves ${status} with nullable legacy timestamps and no optional progress or reason`, () => {
      const row = exported(status, { createdAt: null });
      expect(decodeDataExportStatusResponse({ export: row })).toEqual({ export: row });
    });
  }
  for (const stage of ["collecting", "finalizing"] as const) {
    it(`accepts live ${stage} progress`, () => {
      const row = exported("processing", { stage });
      expect(decodeDataExportStatusResponse({ export: row })).toEqual({ export: row });
    });
  }
  for (const failureReason of ["automated_size_limit", "generation_error", "stalled"] as const) {
    it(`accepts known failed reason ${failureReason}`, () => {
      const row = exported("failed", { failureReason, readyAt: "2026-10-03T00:00:00Z", downloadExpiresAt: "2026-10-05T00:00:00Z" });
      expect(decodeDataExportStatusResponse({ export: row })).toEqual({ export: row });
    });
  }
});

describe("Data export consistency through actual account HTTP transport", () => {
  let auth: AuthService;
  let http: HttpTestingController;
  beforeEach(() => {
    localStorage.clear();
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(),
      { provide: Router, useValue: { navigateByUrl: jasmine.createSpy().and.resolveTo(true) } },
    ] });
    auth = TestBed.inject(AuthService); http = TestBed.inject(HttpTestingController);
    auth.user.set(account); // Initial fixture only; no replacement is fabricated.
  });
  afterEach(() => { http.verify(); localStorage.clear(); });
  function invoke(surface: Surface): Promise<DataExportStatus | DataExportStatus[] | null> {
    return surface === "history" ? auth.dataExportHistory() : surface === "request" ? auth.requestDataExport("fixture-password", "ABCD2345EFGH6789") : auth.dataExportStatus();
  }
  function respond(surface: Surface, row: DataExportStatus | null): void {
    flushMicrotasks();
    const request = http.expectOne(surface === "history" ? endpoint + "/history" : endpoint);
    expect(request.request.method).toBe(surface === "request" ? "POST" : "GET");
    expect(request.request.headers.get("X-Uvh-Account-Id")).toBe("1");
    expect(request.request.headers.has("X-Workspace-Id")).toBeFalse();
    if (surface === "request") {
      expect(request.request.body).toEqual({ password: "fixture-password", factorCode: "ABCD2345EFGH6789" });
      expect(request.request.headers.get("X-CSRF-Token")).toBe("fixture");
    }
    // A history is rejected as a whole, including when a good row precedes it.
    request.flush(surface === "history" ? { exports: [exported("downloaded"), row] } : { export: row });
    flushMicrotasks();
  }
  for (const surface of ["status", "history", "request"] as const) {
    for (const [name, row] of [
      ["terminal progress", exported("ready", { stage: "encrypting" })],
      ["live failure", exported("processing", { failureReason: "stalled" })],
    ] as const) {
      it(`rejects ${name} from ${surface} without publishing a value, altering identity or replaying a write`, fakeAsync(() => {
        const result = observe(invoke(surface));
        respond(surface, row);
        expect(result.value).toBeUndefined();
        expect(result.error).toEqual(jasmine.any(ApiRequestError));
        expect((result.error as ApiRequestError).status).toBe(502);
        expect((result.error as ApiRequestError).message).toBe("El servidor devolvió una respuesta no válida");
        expect((result.error as ApiRequestError).details).toBeUndefined();
        expect(auth.user()).toEqual(account);
        expect(auth.sessionGeneration()).toBe(0);
        expect(auth.sessionInvalidated()).toBeFalse();
        http.expectNone((request) => request.url.startsWith(endpoint));
        http.expectNone("/api/v1/auth/me");
      }));
    }
    for (const row of [exported("processing"), exported("processing", { stage: "analytics" }), exported("failed")]) {
      it(`preserves valid or nullable legacy ${row.status}/${row.stage ?? "null"} from ${surface}`, fakeAsync(() => {
        const result = observe(invoke(surface));
        respond(surface, row);
        expect(result.error).toBeUndefined();
        expect(result.value).toEqual(surface === "history" ? [exported("downloaded"), row] : row);
        expect(auth.user()).toEqual(account);
        http.expectNone((request) => request.url.startsWith(endpoint));
      }));
    }
  }
  it("does not consider null an acknowledgement of a request that may have committed", fakeAsync(() => {
    const result = observe(invoke("request")); respond("request", null);
    expect((result.error as ApiRequestError).status).toBe(502);
    expect(result.value).toBeUndefined();
    expect(auth.user()).toEqual(account);
    http.expectNone((request) => request.method === "POST");
  }));
});
