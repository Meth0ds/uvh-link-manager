import { DOCUMENT } from "@angular/common";
import { TestBed } from "@angular/core/testing";
import { PublicThemeTransitionService } from "./public-theme-toggle.component";
import { ThemeService } from "./services/theme.service";

describe("PublicThemeTransitionService", () => {
  const control = document.createElement("button");
  const event = { currentTarget: control } as unknown as MouseEvent;
  let theme: { toggle: jasmine.Spy };
  let root: HTMLElement;

  function setup(reduced: boolean, start?: (callback: () => Promise<void>) => unknown): PublicThemeTransitionService {
    theme = { toggle: jasmine.createSpy("toggle") };
    root = document.createElement("html");
    // Isolate browser capabilities: tests must not take snapshots or modify
    // the runner's real theme, storage, or reduced-motion preference.
    TestBed.configureTestingModule({ providers: [
      { provide: ThemeService, useValue: theme },
      { provide: DOCUMENT, useValue: {
        documentElement: root,
        defaultView: { innerWidth: 1200, innerHeight: 800, matchMedia: () => ({ matches: reduced }), setTimeout },
        startViewTransition: start,
      } },
    ] });
    return TestBed.inject(PublicThemeTransitionService);
  }

  it("falls back without native View Transitions", () => {
    const service = setup(false);
    service.toggle(event);
    expect(theme.toggle).toHaveBeenCalledTimes(1);
    expect(service.busy()).toBeFalse();
    expect(root.classList.contains("landing-theme-transition")).toBeFalse();
  });

  it("respects reduced motion without creating a snapshot", () => {
    const start = jasmine.createSpy("startViewTransition");
    const service = setup(true, start);
    service.toggle(event);
    expect(start).not.toHaveBeenCalled();
    expect(theme.toggle).toHaveBeenCalledTimes(1);
  });

  it("prevents overlapping snapshots and releases all temporary state", async () => {
    let finish!: () => void;
    const finished = new Promise<void>((resolve) => { finish = resolve; });
    const service = setup(false, (update) => ({ ready: Promise.resolve(), updateCallbackDone: update(), finished }));
    service.toggle(event);
    service.toggle(event);
    expect(service.busy()).toBeTrue();
    expect(theme.toggle).toHaveBeenCalledTimes(1);
    expect(root.classList.contains("landing-theme-transition")).toBeTrue();
    finish();
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(service.busy()).toBeFalse();
    expect(root.classList.contains("landing-theme-transition")).toBeFalse();
    expect(root.style.getPropertyValue("--landing-theme-radius")).toBe("");
  });

  it("also cleans up a skipped or rejected transition", async () => {
    const service = setup(false, (update) => ({ ready: Promise.reject(new Error("skipped")), updateCallbackDone: update(), finished: Promise.reject(new Error("skipped")) }));
    service.toggle(event);
    await new Promise<void>((resolve) => setTimeout(resolve, 0));
    expect(service.busy()).toBeFalse();
    expect(theme.toggle).toHaveBeenCalledTimes(1);
    expect(root.classList.contains("landing-theme-transition")).toBeFalse();
  });

  it("keeps the theme switch usable when starting a snapshot throws", () => {
    const service = setup(false, () => { throw new Error("unsupported snapshot"); });
    service.toggle(event);
    expect(theme.toggle).toHaveBeenCalledTimes(1);
    expect(service.busy()).toBeFalse();
  });
});
