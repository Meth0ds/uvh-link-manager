import { TestBed } from "@angular/core/testing";
import { ApiService } from "./api.service";
import { PendingInvitationService } from "./pending-invitation.service";

const BEARER = "b".repeat(43);
const SOON = () => new Date(Date.now() + 60_000).toISOString();

describe("PendingInvitationService", () => {
  let api: jasmine.SpyObj<ApiService>;
  let service: PendingInvitationService;

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "delete"]);
    api.post.and.resolveTo({ pending: true, expiresAt: SOON() } as never);
    api.delete.and.resolveTo({ pending: false } as never);
    api.get.and.resolveTo({
      invitation: { pending: false, expiresAt: null },
      linkIntent: { pending: false, expiresAt: null },
    } as never);
    TestBed.configureTestingModule({ providers: [{ provide: ApiService, useValue: api }] });
    service = TestBed.inject(PendingInvitationService);
  });

  it("leaves nothing in web storage that a script on this origin could read", async () => {
    // The whole point of the change: seven days of bearer readable by any script
    // is what `localStorage` gave away, and the fix is that it stores nothing.
    const local = spyOn(localStorage, "setItem");
    const session = spyOn(sessionStorage, "setItem");

    expect(service.capture(BEARER, SOON())).toBeTrue();
    expect(await service.confirmed()).toBeTrue();

    expect(local).not.toHaveBeenCalled();
    expect(session).not.toHaveBeenCalled();
  });

  it("hands the bearer to the server and keeps only its deadline", async () => {
    expect(service.capture(BEARER, SOON())).toBeTrue();
    expect(service.pending()).toBeTrue();

    await service.confirmed();

    expect(api.post).toHaveBeenCalledOnceWith(
      "/api/v1/pending/invitation",
      jasmine.objectContaining({ token: BEARER }),
      jasmine.any(Function),
    );
    expect(service.persistent()).toBeTrue();
    expect(service.expiresAt()).not.toBeNull();
  });

  it("refuses anything that is not a bearer this application issues", () => {
    for (const value of ["", "short", "c".repeat(257)]) {
      expect(service.capture(value)).toBeFalse();
    }
    expect(api.post).not.toHaveBeenCalled();
    expect(service.pending()).toBeFalse();
  });

  it("reports a refused park instead of pretending the invitation is held", async () => {
    api.post.and.rejectWith(new Error("offline"));

    expect(service.capture(BEARER, SOON())).toBeTrue();
    expect(await service.confirmed()).toBeFalse();

    // The copy about a browser that could not keep the invitation is only
    // correct when nothing was stored, which is exactly this case.
    expect(service.persistent()).toBeFalse();
    expect(service.pending()).toBeFalse();
  });

  it("finds an invitation the browser parked on an earlier visit", async () => {
    // Coming back from the login round-trip: there is no bearer in the URL, and
    // the server is the only one who can say whether the park is still there.
    api.get.and.resolveTo({
      invitation: { pending: true, expiresAt: SOON() },
      linkIntent: { pending: false, expiresAt: null },
    } as never);

    await service.refresh();

    expect(service.pending()).toBeTrue();
    expect(service.expiresAt()).not.toBeNull();
  });

  it("asks the server to drop the invitation when it is discarded", async () => {
    service.capture(BEARER, SOON());
    await service.confirmed();

    await service.forget();

    expect(api.delete).toHaveBeenCalledOnceWith("/api/v1/pending/invitation");
    expect(service.pending()).toBeFalse();
  });

  it("moves its revision on every change, so a stale acceptance is recognisable", async () => {
    const start = service.revision();
    service.capture(BEARER, SOON());

    expect(service.revision()).toBeGreaterThan(start);
  });
});
