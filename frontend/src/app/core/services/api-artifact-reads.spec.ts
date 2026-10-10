import { fakeAsync, flushMicrotasks, TestBed, tick } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { ApiService } from "./api.service";

describe("ApiService cancellable GET artifacts", () => {
  let api: ApiService;
  let http: HttpTestingController;

  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    api = TestBed.inject(ApiService);
    http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());

  it("unsubscribes an in-flight artifact and removes its abort listener", async () => {
    const controller = new AbortController();
    const remove = spyOn(controller.signal, "removeEventListener").and.callThrough();
    const pending = api.getBlob("/api/v1/links/export.csv", undefined, { signal: controller.signal });
    const request = http.expectOne("/api/v1/links/export.csv");
    expect(request.request.responseType).toBe("blob");
    controller.abort();
    await expectAsync(pending).toBeRejectedWith(jasmine.objectContaining({ status: 0, details: { reason: "cancelled" } }));
    expect(request.cancelled).toBeTrue();
    expect(remove).toHaveBeenCalledWith("abort", jasmine.any(Function));
  });

  it("does not start the transport for an already cancelled read", async () => {
    const controller = new AbortController();
    controller.abort();
    await expectAsync(api.getBlob("/api/v1/links/export.csv", undefined, { signal: controller.signal }))
      .toBeRejectedWith(jasmine.objectContaining({ details: { reason: "cancelled" } }));
    http.expectNone("/api/v1/links/export.csv");
  });

  it("retains Blob, query parameters and cleanup on success", async () => {
    const controller = new AbortController();
    const remove = spyOn(controller.signal, "removeEventListener").and.callThrough();
    const pending = api.getBlob("/api/v1/analytics/export", { period: "7d", format: "csv", unused: null }, { signal: controller.signal });
    const request = http.expectOne("/api/v1/analytics/export?period=7d&format=csv");
    const blob = new Blob(["fixture csv"]);
    request.flush(blob);
    await expectAsync(pending).toBeResolvedTo(blob);
    expect(remove).toHaveBeenCalledWith("abort", jasmine.any(Function));
  });

  it("preserves JSON error details, reason and retry advice within a Blob", async () => {
    const pending = api.getBlob("/api/v1/links/export.csv");
    http.expectOne("/api/v1/links/export.csv").flush(new Blob([JSON.stringify({ error: "Espera", reason: "limited", details: { ceiling: 5 } })]), {
      status: 429, statusText: "Too Many Requests", headers: { "Retry-After": "30" },
    });
    await expectAsync(pending).toBeRejectedWith(jasmine.objectContaining({
      message: "Espera", status: 429, reason: "limited", retryAfterSeconds: 30, details: { ceiling: 5 },
    }));
  });

  it("keeps the default artifact timeout at 120 seconds", fakeAsync(() => {
    let failure: unknown;
    void api.getBlob("/api/v1/links/export.csv").catch(error => { failure = error; });
    const request = http.expectOne("/api/v1/links/export.csv");
    tick(119_999);
    expect(request.cancelled).toBeFalse();
    tick(1);
    flushMicrotasks();
    expect(request.cancelled).toBeTrue();
    expect(failure).toEqual(jasmine.objectContaining({ details: { reason: "timeout" } }));
  }));
});
