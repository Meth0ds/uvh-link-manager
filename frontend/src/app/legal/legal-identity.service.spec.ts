import { provideHttpClient } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import { TestBed, fakeAsync, flushMicrotasks, tick } from "@angular/core/testing";
import { LegalIdentityService } from "./legal-identity.service";

describe("Legal identity loading", () => {
  let service: LegalIdentityService;
  let http: HttpTestingController;
  const identity = { name: "Prestador de prueba", taxId: "TEST", address: "Domicilio de prueba", registry: "Registro de prueba", hostingProvider: "Proveedor de prueba", hostingRegion: "UE" };
  const config = (value: unknown) => ({ appUrl: "https://app.example.test", publicHost: "example.test", appHost: "app.example.test", registrationPaused: false, legalIdentity: value, hcaptcha: { enabled: false, siteKey: null, developmentFallback: false } });
  beforeEach(() => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    service = TestBed.inject(LegalIdentityService); http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => http.verify());
  it("shares a pending read and caches a complete successful identity", fakeAsync(() => {
    const pending = service.load(); expect(service.load()).toBe(pending); expect(service.ready()).toBeFalse();
    http.expectOne("/api/v1/config").flush(config(identity)); flushMicrotasks();
    expect(service.identity()).toEqual({ ...identity, registryStatus: "registered" }); expect(service.error()).toBeNull(); expect(service.ready()).toBeTrue();
    void service.load(); http.expectNone("/api/v1/config"); flushMicrotasks();
  }));
  it("distinguishes unpublished identity from failure and allows a deduplicated retry", fakeAsync(() => {
    void service.load(); http.expectOne("/api/v1/config").flush(config(null)); flushMicrotasks();
    expect(service.identity()).toBeNull(); expect(service.error()).toBeNull(); expect(service.ready()).toBeTrue();
    const retry = service.retry(); expect(service.retry()).toBe(retry); expect(service.load()).toBe(retry);
    expect(service.ready()).toBeFalse();
    http.expectOne("/api/v1/config").flush(config(identity)); flushMicrotasks(); expect(service.identity()).toEqual({ ...identity, registryStatus: "registered" });
  }));
  it("shows a recoverable technical error and clears it on the next read", fakeAsync(() => {
    void service.load(); http.expectOne("/api/v1/config").flush({}, { status: 503, statusText: "Unavailable" }); flushMicrotasks();
    expect(service.identity()).toBeNull(); expect(service.ready()).toBeTrue(); expect(service.error()).toBeTruthy();
    void service.retry(); expect(service.error()).toBeNull();
    http.expectOne("/api/v1/config").flush(config(identity)); flushMicrotasks(); expect(service.identity()).toEqual({ ...identity, registryStatus: "registered" });
  }));
  it("does not publish malformed identity data", fakeAsync(() => {
    void service.load(); http.expectOne("/api/v1/config").flush(config({ ...identity, name: "" })); flushMicrotasks();
    expect(service.identity()).toBeNull(); expect(service.error()).toBeTruthy(); expect(service.ready()).toBeTrue();
  }));
  it("uses the API's finite read timeout and cancels a held request before retry", fakeAsync(() => {
    void service.load(); const held = http.expectOne("/api/v1/config");
    tick(20_000); flushMicrotasks();
    expect(held.cancelled).toBeTrue(); expect(service.ready()).toBeTrue(); expect(service.error()).toBeTruthy();
    void service.retry(); http.expectOne("/api/v1/config").flush(config(identity)); flushMicrotasks(); expect(service.identity()).toEqual({ ...identity, registryStatus: "registered" });
  }));
});
