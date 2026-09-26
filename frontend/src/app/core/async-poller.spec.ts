import { DestroyRef, inject } from "@angular/core";
import { TestBed, fakeAsync, tick } from "@angular/core/testing";
import { AsyncPoller, AsyncPollerOptions } from "./async-poller";

describe("AsyncPoller", () => {
  let attempt: jasmine.Spy<() => void>;
  let wantsMore: boolean;
  let hidden: boolean;
  let destroyRef: DestroyRef;
  let poller: AsyncPoller;

  const build = (delays: readonly number[]): AsyncPoller =>
    new AsyncPoller({ destroyRef, delays, wantsMore: () => wantsMore, attempt } as AsyncPollerOptions);

  beforeEach(() => {
    TestBed.configureTestingModule({});
    destroyRef = TestBed.runInInjectionContext(() => inject(DestroyRef));
    attempt = jasmine.createSpy("attempt");
    wantsMore = true;
    hidden = false;
    // The headless test tab may report itself hidden; own the value per test.
    spyOnProperty(document, "hidden", "get").and.callFake(() => hidden);
  });

  afterEach(() => {
    poller?.stop();
    TestBed.resetTestingModule();
  });

  it("runs attempts on a ladder that saturates at its last delay", fakeAsync(() => {
    poller = build([10, 20, 30]);
    poller.schedule();
    tick(9);
    expect(attempt).not.toHaveBeenCalled();
    tick(1);
    expect(attempt).toHaveBeenCalledTimes(1);
    poller.schedule();
    tick(20);
    expect(attempt).toHaveBeenCalledTimes(2);
    poller.schedule();
    tick(29);
    expect(attempt).toHaveBeenCalledTimes(2);
    tick(1);
    expect(attempt).toHaveBeenCalledTimes(3);
    // The last delay repeats instead of growing without bound.
    poller.schedule();
    tick(30);
    expect(attempt).toHaveBeenCalledTimes(4);
  }));

  it("forgets the ladder on reset", fakeAsync(() => {
    poller = build([10, 20, 30]);
    poller.schedule();
    tick(10);
    poller.reset();
    poller.schedule();
    tick(10);
    expect(attempt).toHaveBeenCalledTimes(2);
  }));

  it("never arms an attempt once the operation is settled", fakeAsync(() => {
    poller = build([10]);
    wantsMore = false;
    poller.schedule();
    tick(1000);
    expect(attempt).not.toHaveBeenCalled();
  }));

  it("replaces any pending attempt instead of stacking timers", fakeAsync(() => {
    poller = build([10, 10]);
    poller.schedule();
    poller.schedule();
    tick(10);
    expect(attempt).toHaveBeenCalledTimes(1);
  }));

  it("pauses while hidden and runs the next attempt when the tab returns", fakeAsync(() => {
    poller = build([10]);
    hidden = true;
    poller.schedule();
    tick(1000);
    expect(attempt).not.toHaveBeenCalled();

    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(attempt).toHaveBeenCalledTimes(1);
  }));

  it("cancels an armed attempt while hidden so it cannot fire unseen", fakeAsync(() => {
    poller = build([10]);
    poller.schedule();
    hidden = true;
    document.dispatchEvent(new Event("visibilitychange"));
    tick(1000);
    expect(attempt).not.toHaveBeenCalled();

    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(attempt).toHaveBeenCalledTimes(1);
  }));

  it("spends no request when the tab hid without an event and resumes on return", fakeAsync(() => {
    poller = build([10]);
    poller.schedule();
    // Hiding without a visibilitychange event must not consume the attempt…
    hidden = true;
    tick(10);
    expect(attempt).not.toHaveBeenCalled();

    // …but a returning tab runs it immediately instead of waiting again.
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(attempt).toHaveBeenCalledTimes(1);
  }));

  it("does not resume on a returning tab when attempts are no longer wanted", fakeAsync(() => {
    poller = build([10]);
    hidden = true;
    poller.schedule();
    wantsMore = false;
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(attempt).not.toHaveBeenCalled();
  }));

  it("cleans up timers and visibility listeners on destroy", fakeAsync(() => {
    poller = build([10]);
    poller.schedule();
    TestBed.resetTestingModule();
    tick(1000);
    expect(attempt).not.toHaveBeenCalled();
    hidden = false;
    document.dispatchEvent(new Event("visibilitychange"));
    expect(attempt).not.toHaveBeenCalled();
  }));
});
