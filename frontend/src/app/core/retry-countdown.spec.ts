import { DestroyRef, inject } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { RetryCountdown, formatWaitLabel } from "./retry-countdown";

describe("RetryCountdown", () => {
  let countdown: RetryCountdown;
  let timestamp: number;

  beforeEach(() => {
    timestamp = Date.parse("2026-09-05T12:00:00Z");
    // Zone.js owns browser timers. Control only the elapsed wall clock so the
    // test cannot corrupt global timer functions for another randomized spec.
    spyOn(Date, "now").and.callFake(() => timestamp);
    TestBed.configureTestingModule({});
    countdown = TestBed.runInInjectionContext(() => new RetryCountdown(inject(DestroyRef)));
  });

  afterEach(() => {
    TestBed.resetTestingModule();
  });

  it("scopes waits to their key only", () => {
    countdown.defer("a", 60);
    expect(countdown.remaining("a")).toBe(60);
    expect(countdown.remaining("b")).toBe(0);
  });

  it("expires at the deadline", () => {
    countdown.defer("a", 60);
    timestamp += 59_001;
    expect(countdown.remaining("a")).toBe(1);
    timestamp += 999;
    expect(countdown.remaining("a")).toBe(0);
  });

  it("uses elapsed time after a throttled/background timer", () => {
    countdown.defer("a", 60);
    timestamp += 120_000;
    expect(countdown.remaining("a")).toBe(0);
  });

  it("does not shorten a known wait or invent one for invalid advice", () => {
    for (const seconds of [undefined, 0, -1, NaN, Infinity, 1.5, Number.MAX_SAFE_INTEGER]) {
      countdown.defer("a", seconds);
    }
    expect(countdown.remaining("a")).toBe(0);
    countdown.defer("a", 60);
    countdown.defer("a", 5);
    expect(countdown.remaining("a")).toBe(60);
  });

  it("cleans up on destruction and ignores a late response", () => {
    countdown.defer("a", 86400);
    const clear = spyOn(globalThis, "clearInterval").and.callThrough();
    TestBed.resetTestingModule();
    expect(clear).toHaveBeenCalled();
    countdown.defer("a", 60);
    expect(countdown.remaining("a")).toBe(0);
  });
});

describe("formatWaitLabel", () => {
  it("formats seconds, minutes and daily limits without a 60-minute remainder", () => {
    expect(formatWaitLabel(45)).toBe("45 s");
    expect(formatWaitLabel(60)).toBe("1 min 0 s");
    expect(formatWaitLabel(7199)).toBe("2 h 0 min");
    expect(formatWaitLabel(86400)).toBe("24 h 0 min");
  });
});
