import { signal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ThemeService } from "../core/services/theme.service";
import { HCaptchaExecutionError, HCaptchaWidgetComponent } from "./hcaptcha-widget.component";

interface CaptchaHarness {
  fixture: ComponentFixture<HCaptchaWidgetComponent>;
  component: HCaptchaWidgetComponent;
  frameWindow: { postMessage: jasmine.Spy };
  channel: string;
  receive: (type: string, token?: string) => void;
}

describe("HCaptchaWidgetComponent invisible execution", () => {
  function createHarness(): CaptchaHarness {
    const fixture = TestBed.createComponent(HCaptchaWidgetComponent);
    const component = fixture.componentInstance;
    const frameWindow = { postMessage: jasmine.createSpy("postMessage") };
    const nativeElement = { contentWindow: frameWindow, src: "" };

    // The real frame is isolated by sandbox/CSP. This narrow fake exercises
    // only the authenticated host-frame message contract without contacting
    // hCaptcha or depending on the network in the unit suite.
    (component as unknown as { frame: { nativeElement: typeof nativeElement } }).frame = { nativeElement };
    component.siteKey = "10000000-ffff-ffff-ffff-000000000001";
    component.invisible = true;
    component.ngAfterViewInit();
    component.onFrameLoad();

    const initMessage = frameWindow.postMessage.calls.mostRecent().args[0] as { channel: string };
    const channel = initMessage.channel;
    const receive = (type: string, token?: string): void => {
      const event = {
        source: frameWindow,
        data: { source: "uvh-hcaptcha-frame", channel, type, token },
      };
      (component as unknown as { onMessage: (value: typeof event) => void }).onMessage(event);
    };

    return { fixture, component, frameWindow, channel, receive };
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
});
