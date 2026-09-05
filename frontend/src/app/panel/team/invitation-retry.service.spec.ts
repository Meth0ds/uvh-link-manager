import { TestBed } from "@angular/core/testing";
import { InvitationRetryService } from "./invitation-retry.service";

describe("InvitationRetryService", () => {
  let service: InvitationRetryService;

  beforeEach(() => {
    jasmine.clock().install();
    jasmine.clock().mockDate(new Date("2026-09-05T12:00:00Z"));
    TestBed.configureTestingModule({ providers: [InvitationRetryService] });
    service = TestBed.inject(InvitationRetryService);
  });

  afterEach(() => {
    TestBed.resetTestingModule();
    jasmine.clock().uninstall();
  });

  it("shares advice across create/resend email spellings, not other recipients/workspaces", () => {
    service.defer(1, " PERSON@example.test ", 60);
    expect(service.remaining(1, "person@example.test")).toBe(60);
    expect(service.remaining(1, "other@example.test")).toBe(0);
    expect(service.remaining(2, "person@example.test")).toBe(0);
  });

  it("expires at the deadline and never requires an API dependency", () => {
    service.defer(1, "person@example.test", 60);
    jasmine.clock().tick(59_001);
    expect(service.remaining(1, "person@example.test")).toBe(1);
    jasmine.clock().tick(999);
    expect(service.remaining(1, "person@example.test")).toBe(0);
  });

  it("uses elapsed time after a throttled/background timer", () => {
    service.defer(1, "person@example.test", 60);
    jasmine.clock().mockDate(new Date("2026-09-05T12:02:00Z"));
    expect(service.remaining(1, "person@example.test")).toBe(0);
  });

  it("does not shorten a known wait or invent one for invalid advice", () => {
    for (const seconds of [undefined, 0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER]) {
      service.defer(1, "other@example.test", seconds);
    }
    expect(service.remaining(1, "other@example.test")).toBe(0);
    service.defer(1, "person@example.test", 60);
    service.defer(1, "person@example.test", 5);
    expect(service.remaining(1, "person@example.test")).toBe(60);
  });

  it("cleans up on destruction and ignores a late response", () => {
    service.defer(1, "person@example.test", 86400);
    const clear = spyOn(globalThis, "clearInterval").and.callThrough();
    TestBed.resetTestingModule();
    expect(clear).toHaveBeenCalled();
    service.defer(1, "person@example.test", 60);
    expect(service.remaining(1, "person@example.test")).toBe(0);
  });

  it("formats daily limits without a 60-minute remainder", () => {
    expect(service.label(60)).toBe("1 min 0 s");
    expect(service.label(7199)).toBe("2 h 0 min");
    expect(service.label(86400)).toBe("24 h 0 min");
  });
});
