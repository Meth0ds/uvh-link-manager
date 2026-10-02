import { signal } from "@angular/core";
import { ComponentFixture, TestBed, fakeAsync, tick, flushMicrotasks } from "@angular/core/testing";
import { ThemeService } from "../core/services/theme.service";
import { HCaptchaExecutionError, HCaptchaWidgetComponent } from "./hcaptcha-widget.component";

interface CaptchaHarness {
  fixture: ComponentFixture<HCaptchaWidgetComponent>;
  component: HCaptchaWidgetComponent;
  frameWindow: { postMessage: jasmine.Spy };
  channel: string;
  frameElement: { contentWindow: { postMessage: jasmine.Spy }; src: string };
  receive: (type: string, token?: unknown, overrides?: Record<string, unknown>) => void;
}

describe("HCaptchaWidgetComponent invisible execution", () => {
  function createHarness(invisible = true): CaptchaHarness {
    const fixture = TestBed.createComponent(HCaptchaWidgetComponent);
    const component = fixture.componentInstance;
    const frameWindow = { postMessage: jasmine.createSpy("postMessage") };
    const nativeElement = { contentWindow: frameWindow, src: "" };

    // The real frame is isolated by sandbox/CSP. This narrow fake exercises
    // only the authenticated host-frame message contract without contacting
    // hCaptcha or depending on the network in the unit suite.
    (component as unknown as { frame: { nativeElement: typeof nativeElement } }).frame = { nativeElement };
    component.siteKey = "10000000-ffff-ffff-ffff-000000000001";
    component.invisible = invisible;
    component.ngAfterViewInit();
    component.onFrameLoad();

    const initMessage = frameWindow.postMessage.calls.mostRecent().args[0] as { channel: string };
    const channel = initMessage.channel;
    const receive = (type: string, token?: unknown, overrides: Record<string, unknown> = {}): void => {
      const event = {
        source: frameWindow,
        data: { source: "uvh-hcaptcha-frame", channel: frameWindow.postMessage.calls.mostRecent().args[0].channel, type, token, ...overrides },
      };
      (component as unknown as { onMessage: (value: typeof event) => void }).onMessage(event);
    };

    return { fixture, component, frameWindow, frameElement: nativeElement, channel, receive };
  }

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HCaptchaWidgetComponent],
      providers: [{ provide: ThemeService, useValue: { resolved: signal<"light" | "dark">("light") } }],
    }).compileComponents();
  });

  it("waits for the frame and resolves with the fresh token returned by execute", async () => {
    const harness = createHarness();
    const execution = harness.component.execute();

    expect(harness.frameWindow.postMessage.calls.allArgs().some(([message]) => message.type === "execute")).toBeFalse();
    harness.receive("ready");
    expect(harness.frameWindow.postMessage.calls.mostRecent().args[0].type).toBe("execute");

    harness.receive("verified", "fresh-provider-token");
    await expectAsync(execution).toBeResolvedTo("fresh-provider-token");
    expect(harness.component.state()).toBe("verified");
    harness.fixture.destroy();
  });

  it("deduplicates concurrent submits and rejects a challenge closed by the user", async () => {
    const harness = createHarness();
    harness.receive("ready");

    const first = harness.component.execute();
    const second = harness.component.execute();
    expect(second).toBe(first);
    expect(harness.frameWindow.postMessage.calls.allArgs().filter(([message]) => message.type === "execute").length).toBe(1);

    harness.receive("challenge-close");
    await expectAsync(first).toBeRejectedWithError(HCaptchaExecutionError, "Completa la protección antiabuso para continuar.");
    harness.fixture.destroy();
  });

  it("ignores messages from another frame, source marker or channel", async () => {
    const h = createHarness();
    h.receive("ready");
    const execute = h.component.execute();
    const emitted = spyOn(h.component.tokenChange, "emit");
    h.receive("verified", "foreign-channel-token", { channel: "0".repeat(32) });
    h.receive("verified", "foreign-source-token", { source: "foreign" });
    const receive = h.component as unknown as { onMessage: (event: unknown) => void };
    receive.onMessage({ source: {}, data: { source: "uvh-hcaptcha-frame", channel: h.channel, type: "verified", token: "foreign-frame-token" } });
    expect(h.component.state()).toBe("verifying");
    expect(emitted).not.toHaveBeenCalled();
    h.receive("verified", "current-token");
    await expectAsync(execute).toBeResolvedTo("current-token");
    h.fixture.destroy();
  });

  for (const token of ["", "x".repeat(8193), null, {}, "token\nwith-control"]) {
    it(`rejects malformed provider tokens (${typeof token}, ${typeof token === "string" ? token.length : "non-string"})`, async () => {
      const h = createHarness();
      h.receive("ready");
      const execute = h.component.execute();
      h.receive("verified", token);
      await expectAsync(execute).toBeRejectedWithError(HCaptchaExecutionError);
      expect(h.component.state()).toBe("error");
      h.fixture.destroy();
    });
  }

  it("does not replace verifying state or dispatch twice on a duplicate ready message", async () => {
    const h = createHarness();
    h.receive("ready");
    const execute = h.component.execute();
    h.receive("ready");
    expect(h.component.state()).toBe("verifying");
    expect(h.frameWindow.postMessage.calls.allArgs().filter(([message]) => message.type === "execute").length).toBe(1);
    h.receive("verified", "current-token");
    await expectAsync(execute).toBeResolvedTo("current-token");
    h.fixture.destroy();
  });

  it("ignores an invisible result arriving after the user closed the challenge", async () => {
    const h = createHarness();
    h.receive("ready");
    const execute = h.component.execute();
    h.receive("challenge-close");
    await expectAsync(execute).toBeRejectedWithError(HCaptchaExecutionError);
    const emitted = spyOn(h.component.tokenChange, "emit");
    h.receive("verified", "closed-challenge-token");
    expect(h.component.state()).not.toBe("verified");
    expect(emitted).not.toHaveBeenCalled();
    h.fixture.destroy();
  });

  it("ignores an invisible result arriving after the execution deadline", fakeAsync(() => {
    const h = createHarness();
    h.receive("ready");
    let error: unknown;
    void h.component.execute().catch((value: unknown) => { error = value; });
    tick(120_000);
    expect(error).toEqual(jasmine.any(HCaptchaExecutionError));
    const emitted = spyOn(h.component.tokenChange, "emit");
    h.receive("verified", "late-token");
    expect(h.component.state()).toBe("expired");
    expect(emitted).not.toHaveBeenCalled();
    h.fixture.destroy();
  }));

  it("does not let a queued result from the previous frame complete a reloaded challenge", async () => {
    const h = createHarness();
    h.receive("ready");
    const execute = h.component.execute();
    h.component.retry();
    const emitted = spyOn(h.component.tokenChange, "emit");
    h.receive("verified", "old-frame-token", { channel: h.channel });
    expect(emitted).not.toHaveBeenCalled();
    expect(h.component.state()).toBe("loading");
    h.component.onFrameLoad();
    h.receive("ready");
    expect(h.frameWindow.postMessage.calls.mostRecent().args[0].channel).not.toBe(h.channel);
    h.receive("verified", "old-frame-token", { channel: h.channel });
    expect(h.component.state()).toBe("verifying");
    h.receive("verified", "new-frame-token");
    await expectAsync(execute).toBeResolvedTo("new-frame-token");
    h.fixture.destroy();
  });

  it("starts a manual attempt after cancellation in a fresh frame before accepting a token", async () => {
    const h = createHarness();
    h.receive("ready");
    const first = h.component.execute();
    h.receive("challenge-close");
    await expectAsync(first).toBeRejectedWithError(HCaptchaExecutionError);
    const second = h.component.execute();
    expect(h.component.state()).toBe("loading");
    h.receive("verified", "cancelled-attempt-token", { channel: h.channel });
    h.component.onFrameLoad();
    h.receive("ready");
    h.receive("verified", "second-attempt-token");
    await expectAsync(second).toBeResolvedTo("second-attempt-token");
    h.fixture.destroy();
  });

  it("clears a visible credential on frame navigation and accepts the replacement result", () => {
    const h = createHarness(false);
    h.receive("ready");
    h.receive("verified", "visible-token");
    expect(h.component.state()).toBe("verified");
    const emitted = spyOn(h.component.tokenChange, "emit");
    h.component.onFrameLoad();
    expect(emitted).toHaveBeenCalledWith("");
    h.receive("ready");
    h.receive("verified", "replacement-visible-token");
    expect(emitted).toHaveBeenCalledWith("replacement-visible-token");
    h.fixture.destroy();
  });

  it("settles a pending execution and clears timers when the view is destroyed", fakeAsync(() => {
    const h = createHarness();
    let error: unknown;
    void h.component.execute().catch((value: unknown) => { error = value; });
    h.fixture.destroy();
    flushMicrotasks();
    expect(error).toEqual(jasmine.any(HCaptchaExecutionError));
    const state = h.component.state();
    tick(120_000);
    expect(h.component.state()).toBe(state);
  }));


  it("rejects unsolicited invisible success without an execution", () => {
    const h = createHarness();
    h.receive("ready");
    const emitted = spyOn(h.component.tokenChange, "emit");
    h.receive("verified", "unsolicited-token");
    expect(h.component.state()).toBe("ready");
    expect(emitted).not.toHaveBeenCalled();
    h.fixture.destroy();
  });

  it("does not settle execution before the replacement frame is ready", async () => {
    const h = createHarness();
    const execution = h.component.execute();
    const emitted = spyOn(h.component.tokenChange, "emit");
    h.receive("verified", "premature-token");
    expect(emitted).not.toHaveBeenCalled();
    expect(h.component.state()).toBe("loading");
    h.receive("ready");
    h.receive("verified", "current-token");
    await expectAsync(execution).toBeResolvedTo("current-token");
    h.fixture.destroy();
  });

  it("retires the channel on reset and keeps the visible flow usable", () => {
    const h = createHarness(false);
    h.receive("ready");
    h.receive("verified", "previous-visible-token");
    h.component.reset();
    const emitted = spyOn(h.component.tokenChange, "emit");
    h.receive("verified", "queued-reset-token", { channel: h.channel });
    expect(emitted).not.toHaveBeenCalled();
    expect(h.component.state()).toBe("loading");
    h.component.onFrameLoad();
    h.receive("ready");
    h.receive("verified", "new-visible-token");
    expect(emitted).toHaveBeenCalledWith("new-visible-token");
    h.fixture.destroy();
  });

  it("uses distinct reload URLs even when retries occur in the same millisecond", () => {
    const h = createHarness();
    spyOn(Date, "now").and.returnValue(123);
    h.component.retry();
    const first = h.frameElement.src;
    h.component.retry();
    expect(h.frameElement.src).not.toBe(first);
    h.fixture.destroy();
  });

  it("preserves confirmed success when the SDK closes its completed challenge", async () => {
    const h = createHarness();
    h.receive("ready");
    const execute = h.component.execute();
    h.receive("verified", "confirmed-token");
    h.receive("challenge-close");
    await expectAsync(execute).toBeResolvedTo("confirmed-token");
    expect(h.component.state()).toBe("verified");
    h.fixture.destroy();
  });

  it("settles a pending attempt when the replacement frame does not load", fakeAsync(() => {
    const h = createHarness();
    let error: unknown;
    void h.component.execute().catch((value: unknown) => { error = value; });
    tick(12_000);
    expect(error).toEqual(jasmine.any(HCaptchaExecutionError));
    expect(h.component.state()).toBe("error");
    const state = h.component.state();
    tick(120_000);
    expect(h.component.state()).toBe(state);
    h.fixture.destroy();
  }));


  it("does not reopen an invisible challenge after its execution deadline", fakeAsync(() => {
    const h = createHarness();
    h.receive("ready");
    void h.component.execute().catch(() => undefined);
    tick(120_000);
    h.receive("challenge-open");
    expect(h.component.challengeOpen()).toBeFalse();
    expect(h.component.state()).toBe("expired");
    h.fixture.destroy();
  }));

  it("does not let late ready revive a retired frame for the next attempt", fakeAsync(() => {
    const h = createHarness();
    h.receive("ready");
    void h.component.execute().catch(() => undefined);
    tick(120_000);
    h.receive("ready");
    expect(h.component.state()).toBe("expired");
    let completed = "";
    void h.component.execute().then(token => { completed = token; });
    expect(h.component.state()).toBe("loading");
    h.receive("verified", "retired-token", { channel: h.channel });
    flushMicrotasks();
    expect(completed).toBe("");
    h.component.onFrameLoad();
    h.receive("ready");
    h.receive("verified", "new-attempt-token");
    flushMicrotasks();
    expect(completed).toBe("new-attempt-token");
    h.fixture.destroy();
  }));

});
