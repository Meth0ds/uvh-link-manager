import { TestBed } from "@angular/core/testing";
import { ApiService } from "./api.service";
import { PendingLinkIntentService } from "./pending-link-intent.service";
import { decodeClaimedLinkIntent, decodeLinkIntentReceipt } from "./link-intent-response-decoders";

const TOKEN = "a".repeat(43);
const STORAGE_KEY = "uvh.pending-link-intent.v1";

describe("PendingLinkIntentService", () => {
  let api: jasmine.SpyObj<ApiService>;
  let service: PendingLinkIntentService;

  beforeEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
    api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    service = TestBed.inject(PendingLinkIntentService);
  });

  afterEach(() => {
    localStorage.removeItem(STORAGE_KEY);
    sessionStorage.removeItem(STORAGE_KEY);
  });

  it("stores only an opaque token and expiry on the app origin", () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();

    expect(service.capture(TOKEN, expiresAt)).toBeTrue();
    expect(service.pending()).toEqual(jasmine.objectContaining({ intent: TOKEN, expiresAt }));
    expect(localStorage.getItem(STORAGE_KEY)).toContain(TOKEN);
    expect(localStorage.getItem(STORAGE_KEY)).not.toContain("example.com");
  });

  it("rejects malformed or already expired handoff tokens", () => {
    expect(service.capture("not-a-token")).toBeFalse();
    expect(service.capture(TOKEN, new Date(Date.now() - 1_000).toISOString())).toBeFalse();
    expect(service.hasPending()).toBeFalse();
  });

  it("claims the destination only after a token is present", async () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    api.post.and.resolveTo({ destination: "https://example.com/campaign", expiresAt });
    service.capture(TOKEN, expiresAt);

    await expectAsync(service.claim()).toBeResolvedTo({ destination: "https://example.com/campaign", expiresAt });
    expect(api.post).toHaveBeenCalledWith("/api/v1/link-intents/claim", { intent: TOKEN }, decodeClaimedLinkIntent);
  });

  it("validates the opaque bearer and bounded server expiry", () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    expect(decodeLinkIntentReceipt({ intent: TOKEN, expiresAt })).toEqual({ intent: TOKEN, expiresAt });
    expect(() => decodeLinkIntentReceipt({ intent: "short", expiresAt })).toThrow();
    expect(() => decodeLinkIntentReceipt({ intent: TOKEN, expiresAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString() })).toThrow();
  });

  it("rejects unsafe or malformed claimed destinations", () => {
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    expect(decodeClaimedLinkIntent({ destination: "https://example.test/path", expiresAt })).toEqual({
      destination: "https://example.test/path", expiresAt,
    });
    expect(() => decodeClaimedLinkIntent({ destination: "javascript:alert(1)", expiresAt })).toThrow();
    expect(() => decodeClaimedLinkIntent({ destination: "https://user:pass@example.test", expiresAt })).toThrow();
  });

  it("does not downgrade a successful local write when session cleanup is denied", () => {
    api.post.and.returnValue(new Promise(() => undefined));
    sessionStorage.setItem(STORAGE_KEY, JSON.stringify({
      intent: TOKEN, expiresAt: new Date(Date.now() + 60_000).toISOString(), state: "active",
    }));
    const remove = spyOn(sessionStorage, "removeItem").and.throwError("Fixture: denied cleanup");

    expect(service.capture(TOKEN, new Date(Date.now() + 60_000).toISOString())).toBeTrue();
    service.complete();
    const restored = TestBed.runInInjectionContext(() => new PendingLinkIntentService());

    expect(restored.hasPending()).toBeFalse();
    expect(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? "{}").state).toBe("completing");
    remove.and.callThrough();
  });

  it("rejects coercible non-string tokens loaded from storage", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      intent: [TOKEN], expiresAt: new Date(Date.now() + 60_000).toISOString(), state: "active",
    }));

    const restored = TestBed.runInInjectionContext(() => new PendingLinkIntentService());

    expect(restored.hasPending()).toBeFalse();
    expect(localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("does not retain an attacker-supplied expiry beyond the browser TTL", () => {
    expect(service.capture(TOKEN, new Date(Date.now() + 48 * 60 * 60 * 1000).toISOString())).toBeFalse();
    expect(service.hasPending()).toBeFalse();
  });

  it("restores the newer session token when a quota failure leaves an older local token", () => {
    const oldToken = "c".repeat(43);
    const expiresAt = new Date(Date.now() + 60_000).toISOString();
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      intent: oldToken, expiresAt, state: "active", savedAt: Date.now() - 1_000,
    }));
    const set = spyOn(localStorage, "setItem").and.throwError("Fixture: quota exceeded");

    expect(service.capture(TOKEN, expiresAt)).toBeTrue();
    const restored = TestBed.runInInjectionContext(() => new PendingLinkIntentService());

    expect(restored.pending()?.intent).toBe(TOKEN);
    expect(restored.usingSessionFallback()).toBeTrue();
    set.and.callThrough();
  });

  it("rejects unknown persisted states instead of treating them as active", () => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({
      intent: TOKEN, expiresAt: new Date(Date.now() + 60_000).toISOString(), state: "completed",
    }));
    const restored = TestBed.runInInjectionContext(() => new PendingLinkIntentService());
    expect(restored.hasPending()).toBeFalse();
  });
});
