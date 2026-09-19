import { TestBed } from "@angular/core/testing";
import { ApiRequestError, ApiService } from "./api.service";
import { decodeClaimedLinkIntent, decodeLinkIntentReceipt } from "./link-intent-response-decoders";
import { PendingLinkIntentService } from "./pending-link-intent.service";

const BEARER = "a".repeat(43);
const SOON = () => new Date(Date.now() + 60_000).toISOString();
const PARKED = () => ({ pending: true as const, expiresAt: SOON() });
const CLAIMED = () => ({ destination: "https://example.test/campaign", expiresAt: SOON() });

describe("PendingLinkIntentService", () => {
  let api: jasmine.SpyObj<ApiService>;
  let service: PendingLinkIntentService;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "delete"]);
    api.post.and.resolveTo(PARKED() as never);
    api.delete.and.resolveTo({ pending: false } as never);
    api.get.and.resolveTo({
      invitation: { pending: false, expiresAt: null },
      linkIntent: { pending: false, expiresAt: null },
    } as never);
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    service = TestBed.inject(PendingLinkIntentService);
  });

  it("parks the handoff token instead of keeping it in the browser", async () => {
    const local = spyOn(localStorage, "setItem");
    const session = spyOn(sessionStorage, "setItem");

    expect(service.capture(BEARER, SOON())).toBeTrue();
    expect(service.hasPending()).toBeTrue();
    expect(await service.confirmed()).toBeTrue();

    expect(local).not.toHaveBeenCalled();
    expect(session).not.toHaveBeenCalled();
  });

  it("claims without sending a bearer: the server reads its own cookie", async () => {
    api.post.and.returnValues(Promise.resolve(PARKED()), Promise.resolve(CLAIMED()));
    service.capture(BEARER, SOON());

    const claimed = await service.claim();

    expect(claimed).toEqual({ destination: "https://example.test/campaign", expiresAt: jasmine.any(String) });
    expect(api.post).toHaveBeenCalledWith("/api/v1/link-intents/claim", {}, jasmine.any(Function));
  });

  it("waits for the park before claiming, so the cookie is actually there", async () => {
    let releasePark!: (value: unknown) => void;
    api.post.and.returnValues(
      new Promise((resolve) => { releasePark = resolve; }),
      Promise.resolve(CLAIMED()),
    );
    service.capture(BEARER, SOON());

    const claiming = service.claim();
    await Promise.resolve();
    expect(api.post).toHaveBeenCalledTimes(1);

    releasePark(PARKED());
    await claiming;

    expect(api.post).toHaveBeenCalledTimes(2);
  });

  it("does not claim an intent the server refused to park", async () => {
    api.post.and.rejectWith(new Error("offline"));
    service.capture(BEARER, SOON());

    expect(await service.claim()).toBeNull();
    expect(api.post).toHaveBeenCalledTimes(1);
  });

  it("stops offering an intent the server says is gone", async () => {
    api.post.and.returnValues(
      Promise.resolve(PARKED()),
      Promise.reject(new ApiRequestError("La URL guardada ya no está disponible", 404)),
    );
    service.capture(BEARER, SOON());

    await expectAsync(service.claim()).toBeRejected();
    expect(service.hasPending()).toBeFalse();
  });

  it("releases the intent on the server once the link exists", async () => {
    api.post.and.resolveTo({ ok: true } as never);
    service.capture(BEARER, SOON());

    await service.complete();

    expect(service.hasPending()).toBeFalse();
    expect(api.post).toHaveBeenCalledWith("/api/v1/link-intents/complete", {});
  });

  it("stops offering the intent even when the server cannot release it", async () => {
    api.post.and.rejectWith(new Error("offline"));
    service.capture(BEARER, SOON());

    await service.complete();

    expect(service.hasPending()).toBeFalse();
    expect(api.delete).toHaveBeenCalledOnceWith("/api/v1/pending/link-intent");
  });

  it("rejects malformed or already expired handoff tokens without parking", () => {
    expect(service.capture("not-a-token")).toBeFalse();
    expect(service.capture(BEARER, new Date(Date.now() - 1_000).toISOString())).toBeFalse();
    expect(service.hasPending()).toBeFalse();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("keeps the public create() contract the landing page depends on", async () => {
    const expiresAt = SOON();
    api.post.and.resolveTo({ intent: BEARER, expiresAt } as never);

    await expectAsync(service.create("https://example.test/x")).toBeResolvedTo({ intent: BEARER, expiresAt });
    expect(api.post).toHaveBeenCalledOnceWith(
      "/api/v1/link-intents",
      { destination: "https://example.test/x" },
      decodeLinkIntentReceipt,
    );
  });

  it("validates the opaque bearer and the bounded expiry it accepts", () => {
    const expiresAt = SOON();
    expect(decodeLinkIntentReceipt({ intent: BEARER, expiresAt })).toEqual({ intent: BEARER, expiresAt });
    expect(() => decodeLinkIntentReceipt({ intent: "short", expiresAt })).toThrow();
    expect(() => decodeLinkIntentReceipt({ intent: BEARER, expiresAt: new Date(Date.now() + 48 * 60 * 60_000).toISOString() })).toThrow();
  });

  it("rejects unsafe or malformed claimed destinations", () => {
    const expiresAt = SOON();
    expect(decodeClaimedLinkIntent({ destination: "https://example.test/path", expiresAt })).toEqual({
      destination: "https://example.test/path", expiresAt,
    });
    expect(() => decodeClaimedLinkIntent({ destination: "javascript:alert(1)", expiresAt })).toThrow();
    expect(() => decodeClaimedLinkIntent({ destination: "https://user:pass@example.test", expiresAt })).toThrow();
  });
});
