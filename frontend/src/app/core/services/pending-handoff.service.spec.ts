import { TestBed } from "@angular/core/testing";
import { ApiService } from "./api.service";
import { PendingHandoffService } from "./pending-handoff.service";

const BEARER = "a".repeat(43);
const SOON = () => new Date(Date.now() + 60_000).toISOString();

/** A promise the test resolves by hand, to keep a request in flight. */
function deferred<T>(): { promise: Promise<T>; resolve: (value: T) => void; reject: (reason: unknown) => void } {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => { resolve = onResolve; reject = onReject; });
  return { promise, resolve, reject };
}

describe("PendingHandoffService", () => {
  let api: jasmine.SpyObj<ApiService>;
  let service: PendingHandoffService;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "delete"]);
    api.post.and.resolveTo({ pending: true, expiresAt: SOON() } as never);
    api.delete.and.resolveTo({ pending: false } as never);
    api.get.and.resolveTo({
      invitation: { pending: false, expiresAt: null },
      linkIntent: { pending: false, expiresAt: null },
    } as never);
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    service = TestBed.inject(PendingHandoffService);
  });

  it("parks a bearer and keeps only the deadline the server confirms", async () => {
    const declared = SOON();
    const confirmed = new Date(Date.now() + 120_000).toISOString();
    api.post.and.resolveTo({ pending: true, expiresAt: confirmed } as never);

    expect(service.park("invitation", BEARER, declared)).toBeTrue();
    // Optimistic: the caller can decide which screen to paint before the answer.
    expect(service.parked("invitation")).toBeTrue();
    expect(await service.confirmed("invitation")).toBeTrue();

    expect(api.post).toHaveBeenCalledOnceWith(
      "/api/v1/pending/invitation",
      { token: BEARER, expiresAt: declared },
      jasmine.any(Function),
    );
    expect(service.expiresAt("invitation")).toBe(confirmed);
  });

  it("sends no deadline when the caller has none, and lets the server cap it", () => {
    service.park("link-intent", BEARER);

    expect(api.post).toHaveBeenCalledOnceWith(
      "/api/v1/pending/link-intent",
      { token: BEARER },
      jasmine.any(Function),
    );
  });

  it("reverts a park the server refused instead of offering a dead flow", async () => {
    api.post.and.rejectWith(new Error("offline"));

    expect(service.park("link-intent", BEARER)).toBeTrue();
    expect(await service.confirmed("link-intent")).toBeFalse();
    expect(service.parked("link-intent")).toBeFalse();
    expect(service.expiresAt("link-intent")).toBeNull();
  });

  it("never contacts the server for a value that is not a bearer", () => {
    for (const value of ["", "short", "b".repeat(257), "has spaces and punctuation!"]) {
      expect(service.park("invitation", value)).toBeFalse();
    }
    expect(api.post).not.toHaveBeenCalled();
  });

  it("refuses a deadline that has already passed", () => {
    expect(service.park("invitation", BEARER, new Date(Date.now() - 1_000).toISOString())).toBeFalse();
    expect(service.park("invitation", BEARER, "not-a-date")).toBeFalse();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("waits for the park before reporting it as confirmed", async () => {
    const response = deferred<unknown>();
    api.post.and.returnValue(response.promise as never);
    service.park("invitation", BEARER);

    let settled = false;
    const confirmation = service.confirmed("invitation").then((value) => { settled = true; return value; });
    await Promise.resolve();
    expect(settled).toBeFalse();

    response.resolve({ pending: true, expiresAt: SOON() });
    expect(await confirmation).toBeTrue();
  });

  it("adopts what the server says is parked, without ever holding a bearer", async () => {
    const expiresAt = SOON();
    api.get.and.resolveTo({
      invitation: { pending: true, expiresAt },
      linkIntent: { pending: false, expiresAt: null },
    } as never);

    await service.refresh();

    expect(service.parked("invitation")).toBeTrue();
    expect(service.expiresAt("invitation")).toBe(expiresAt);
    expect(service.parked("link-intent")).toBeFalse();
    expect(api.get).toHaveBeenCalledOnceWith("/api/v1/pending", undefined, jasmine.any(Function));
  });

  it("keeps the previous answer when the park cannot be reached", async () => {
    const expiresAt = SOON();
    api.get.and.resolveTo({ invitation: { pending: true, expiresAt }, linkIntent: { pending: false, expiresAt: null } } as never);
    await service.refresh();
    api.get.and.rejectWith(new Error("offline"));

    await service.refresh();

    expect(service.parked("invitation")).toBeTrue();
  });

  it("shares one request between concurrent refreshes", async () => {
    const response = deferred<unknown>();
    api.get.and.returnValue(response.promise as never);

    const first = service.refresh();
    const second = service.refresh();
    response.resolve({ invitation: { pending: false, expiresAt: null }, linkIntent: { pending: false, expiresAt: null } });
    await Promise.all([first, second]);

    expect(api.get).toHaveBeenCalledTimes(1);
  });

  it("moves the revision whenever the caller changes the park", () => {
    const initial = service.revision("invitation");
    service.park("invitation", BEARER);
    const parked = service.revision("invitation");
    service.hide("invitation");

    expect(parked).toBeGreaterThan(initial);
    expect(service.revision("invitation")).toBeGreaterThan(parked);
  });

  it("asks the server to drop a live handoff and forgets it locally either way", async () => {
    service.park("invitation", BEARER);
    await service.confirmed("invitation");

    await service.forget("invitation");

    expect(api.delete).toHaveBeenCalledOnceWith("/api/v1/pending/invitation");
    expect(service.parked("invitation")).toBeFalse();

    // A request that fails still leaves the panel without the handoff, and the
    // next refresh restores the truth rather than the panel inventing one.
    api.delete.and.rejectWith(new Error("offline"));
    service.park("invitation", BEARER);
    await service.forget("invitation");
    expect(service.parked("invitation")).toBeFalse();
  });

  it("hides a handoff the server already dropped without another request", () => {
    service.park("invitation", BEARER);
    api.delete.calls.reset();

    service.hide("invitation");

    expect(service.parked("invitation")).toBeFalse();
    expect(api.delete).not.toHaveBeenCalled();
  });

  it("records whether the browser ended up holding the handoff", async () => {
    expect(service.invitationOutcome()).toBeNull();

    service.park("invitation", BEARER);
    expect(await service.confirmed("invitation")).toBeTrue();
    expect(service.invitationOutcome()).toBeTrue();

    api.post.and.rejectWith(new Error("offline"));
    service.park("invitation", BEARER);
    await service.confirmed("invitation");
    expect(service.invitationOutcome()).toBeFalse();
  });
});
