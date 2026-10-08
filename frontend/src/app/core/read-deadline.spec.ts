import { DestroyRef, NgZone, inject } from "@angular/core";
import { TestBed, fakeAsync, tick } from "@angular/core/testing";
import { ReadDeadline } from "./read-deadline";

describe("ReadDeadline", () => {
  let deadline: ReadDeadline; let expired: jasmine.Spy; let hidden: boolean;
  beforeEach(() => {
    TestBed.configureTestingModule({}); hidden = false;
    spyOnProperty(document, "hidden", "get").and.callFake(() => hidden);
    expired = jasmine.createSpy("expired");
    deadline = new ReadDeadline(TestBed.runInInjectionContext(() => inject(DestroyRef)), TestBed.inject(NgZone), expired);
  });
  afterEach(() => { deadline.stop(); TestBed.resetTestingModule(); });
  it("consumes an exact deadline once despite both return events", fakeAsync(() => {
    deadline.schedule(Date.now() + 10); tick(9); expect(expired).not.toHaveBeenCalled(); tick(1);
    window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange"));
    expect(expired).toHaveBeenCalledTimes(1); deadline.stop();
  }));
  it("replaces a deadline and treats invalid dates as cancellation", fakeAsync(() => {
    deadline.schedule(Date.now() + 10); deadline.schedule(Date.now() + 20); tick(10); expect(expired).not.toHaveBeenCalled();
    deadline.schedule(NaN); tick(20); expect(expired).not.toHaveBeenCalled(); deadline.schedule(Date.now() + 10); deadline.schedule(null); tick(10);
    expect(expired).not.toHaveBeenCalled();
  }));
  it("does not overflow a deadline farther than the native timer range", fakeAsync(() => {
    deadline.schedule(Date.now() + 2_147_483_657); tick(2_147_483_647); expect(expired).not.toHaveBeenCalled(); tick(9);
    expect(expired).not.toHaveBeenCalled(); tick(1); expect(expired).toHaveBeenCalledTimes(1);
  }));
  it("does not round fractional deadlines down to an early callback", fakeAsync(() => {
    deadline.schedule(Date.now() + 1.5); tick(1); expect(expired).not.toHaveBeenCalled(); tick(1); expect(expired).toHaveBeenCalledTimes(1);
  }));
  it("waits unseen and catches up once when focus and visibility return", fakeAsync(() => {
    hidden = true; deadline.schedule(Date.now() + 10); tick(20); expect(expired).not.toHaveBeenCalled();
    hidden = false; window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); expect(expired).toHaveBeenCalledTimes(1);
  }));
  it("rechecks the clock instead of expiring early after a backwards adjustment", fakeAsync(() => {
    let now = 1_000; spyOn(Date, "now").and.callFake(() => now);
    deadline.schedule(1_010); now = 990; tick(10); expect(expired).not.toHaveBeenCalled();
    now = 1_010; tick(20); expect(expired).toHaveBeenCalledTimes(1);
  }));
  it("catches up on a forward clock adjustment without waiting for the old timeout", fakeAsync(() => {
    let now = 1_000; spyOn(Date, "now").and.callFake(() => now); deadline.schedule(10_000);
    now = 20_000; window.dispatchEvent(new Event("focus")); expect(expired).toHaveBeenCalledTimes(1); tick(10_000); expect(expired).toHaveBeenCalledTimes(1);
  }));
  it("cannot be rearmed or resumed after its owner is destroyed", fakeAsync(() => {
    deadline.schedule(Date.now() + 10); TestBed.resetTestingModule(); deadline.schedule(Date.now()); tick(20);
    window.dispatchEvent(new Event("focus")); document.dispatchEvent(new Event("visibilitychange")); expect(expired).not.toHaveBeenCalled();
  }));
});
