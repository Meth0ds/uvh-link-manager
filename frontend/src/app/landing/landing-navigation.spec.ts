import { ViewportScroller } from "@angular/common";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { signal } from "@angular/core";
import { provideRouter } from "@angular/router";
import { LandingComponent } from "./landing.component";
import { ApiService } from "../core/services/api.service";
import { PendingLinkIntentService } from "../core/services/pending-link-intent.service";
import { ThemeService } from "../core/services/theme.service";

describe("Landing navigation and preparation ownership", () => {
  let fixture: ComponentFixture<LandingComponent>, component: LandingComponent, host: HTMLElement;
  let intents: jasmine.SpyObj<PendingLinkIntentService>;
  let scroller: jasmine.SpyObj<ViewportScroller>;
  let frames: Map<number, FrameRequestCallback>, nextFrame: number, width: number, offset: number;
  let originalWidth: PropertyDescriptor | undefined, originalScroll: PropertyDescriptor | undefined;
  const bounds = new Map<string, [number, number]>();
  const box = (selector: string, top: number, bottom: number): void => { bounds.set(selector, [top, bottom]); };
  function flush(): void { const callbacks = [...frames.values()]; frames.clear(); callbacks.forEach((cb) => cb(performance.now())); fixture.detectChanges(); }
  function current(nav = ".desktop-nav"): string | null { return host.querySelector(`${nav} a[aria-current='location']`)?.getAttribute("href") ?? null; }
  function action(): HTMLButtonElement | null { return host.querySelector(".mobile-create"); }

  beforeEach(async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["get"]); api.get.and.resolveTo({ appUrl: "https://app.uvh.test" });
    scroller = jasmine.createSpyObj<ViewportScroller>("ViewportScroller", ["setOffset"]);
    intents = jasmine.createSpyObj<PendingLinkIntentService>("PendingLinkIntentService", ["create"]);
    await TestBed.configureTestingModule({ imports: [LandingComponent], providers: [provideRouter([]),
      { provide: ViewportScroller, useValue: scroller }, { provide: ApiService, useValue: api }, { provide: PendingLinkIntentService, useValue: intents },
      { provide: ThemeService, useValue: { resolved: signal("light"), toggle: jasmine.createSpy("toggle") } }], }).compileComponents();
    fixture = TestBed.createComponent(LandingComponent); component = fixture.componentInstance; host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges(); await fixture.whenStable(); await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    width = 1440; offset = 0;
    originalWidth = Object.getOwnPropertyDescriptor(window, "innerWidth"); originalScroll = Object.getOwnPropertyDescriptor(window, "scrollY");
    Object.defineProperty(window, "innerWidth", { configurable: true, get: () => width }); Object.defineProperty(window, "scrollY", { configurable: true, get: () => offset });
    frames = new Map(); nextFrame = 1;
    spyOn(window, "requestAnimationFrame").and.callFake((callback) => { const id = nextFrame++; frames.set(id, callback); return id; });
    spyOn(window, "cancelAnimationFrame").and.callFake((id) => { frames.delete(id); });
    bounds.clear();
    for (const selector of [".site-header", ".hero-form", ".closing-section", "#producto", "#control", "#operacion", "#faq"]) {
      box(selector, 3000, 4000); spyOn(host.querySelector<HTMLElement>(selector)!, "getBoundingClientRect").and.callFake(() => {
        const [top, bottom] = bounds.get(selector)!; return DOMRect.fromRect({ x: 0, y: top, width: 300, height: bottom - top });
      });
    }
    box(".site-header", 0, 84); component.onWindowScroll(); flush();
  });
  afterEach(() => { fixture.destroy(); if (originalWidth) Object.defineProperty(window, "innerWidth", originalWidth); if (originalScroll) Object.defineProperty(window, "scrollY", originalScroll); });

  it("keeps router anchor targets clear of the changing header and resets the offset on exit", () => {
    const configured = scroller.setOffset.calls.mostRecent()?.args[0];
    expect(typeof configured).toBe("function"); if (typeof configured !== "function") return;
    expect(configured()).toEqual([0, 116]); box(".site-header", 0, 72); expect(configured()).toEqual([0, 104]);
    fixture.destroy(); expect(scroller.setOffset.calls.mostRecent().args[0]).toEqual([0, 0]);
  });
  it("marks the covered section in desktop and mobile menus", () => {
    box("#producto", 100, 800); component.onWindowScroll(); flush(); expect(current()).toBe("#producto"); expect(current(".mobile-sheet")).toBe("#producto");
    box("#producto", -800, 40); box("#control", 90, 700); component.onWindowScroll(); flush(); expect(current()).toBe("#control"); expect(current(".mobile-sheet")).toBe("#control");
    expect(host.querySelectorAll(".desktop-nav [aria-current]").length).toBe(1);
  });
  it("clears the active item outside sections", () => {
    box("#faq", 80, 500); component.onWindowScroll(); flush(); expect(current()).toBe("#faq");
    box("#faq", -800, 40); component.onWindowScroll(); flush(); expect(current()).toBeNull();
    box("#producto", 400, 1000); component.onWindowScroll(); flush(); expect(current()).toBeNull();
  });
  it("coalesces scroll notifications into one layout frame", () => {
    const read = host.querySelector("#producto")!.getBoundingClientRect as jasmine.Spy;
    read.calls.reset(); (window.requestAnimationFrame as jasmine.Spy).calls.reset();
    component.onWindowScroll(); component.onWindowScroll(); component.onWindowScroll(); expect(window.requestAnimationFrame).toHaveBeenCalledTimes(1); expect(read).not.toHaveBeenCalled();
    flush(); expect(read).toHaveBeenCalledTimes(1);
  });
  it("cancels queued layout work on teardown and releases scrolling", () => {
    component.openMobileMenu();
    const before = new Set(frames.keys());
    const read = host.querySelector("#producto")!.getBoundingClientRect as jasmine.Spy;
    read.calls.reset(); component.onWindowScroll();
    const owned = [...frames.keys()].filter((id) => !before.has(id));
    expect(owned.length).toBe(1); const lateCallback = frames.get(owned[0])!;
    fixture.destroy();
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(owned[0]); expect(frames.has(owned[0])).toBeFalse();
    lateCallback(performance.now()); expect(read).not.toHaveBeenCalled();
    expect(document.body.classList.contains("uvh-menu-open")).toBeFalse();
  });
  it("uses compact header hysteresis", () => {
    offset = 200; component.onWindowScroll(); flush(); expect(host.querySelector("header")!.classList.contains("compact")).toBeTrue();
    offset = 100; component.onWindowScroll(); flush(); expect(host.querySelector("header")!.classList.contains("compact")).toBeTrue();
    offset = 0; component.onWindowScroll(); flush(); expect(host.querySelector("header")!.classList.contains("compact")).toBeFalse();
  });
  it("offers mobile preparation after the form leaves view", () => {
    width = 320; box(".hero-form", -300, 70); component.onWindowScroll(); flush(); expect(action()).not.toBeNull(); expect(action()?.hasAttribute("inert")).toBeFalse();
    expect(host.querySelector(".login-link")?.getAttribute("aria-hidden")).toBe("true");
  });
  it("retires contextual preparation at the form and closing section", () => {
    width = 320; box(".hero-form", -300, 70); component.onWindowScroll(); flush(); expect(action()?.hasAttribute("inert")).toBeFalse();
    box(".hero-form", 200, 500); component.onWindowScroll(); flush(); expect(action()?.hasAttribute("inert")).toBeTrue();
    box(".hero-form", -300, 70); box(".closing-section", 200, 900); component.onWindowScroll(); flush(); expect(action()?.hasAttribute("inert")).toBeTrue();
  });
  it("preserves a focused contextual action until it loses focus", () => {
    width = 320; box(".hero-form", -300, 70); component.onWindowScroll(); flush(); const button = action(); expect(button).not.toBeNull(); if (!button) return;
    button.style.display = "inline-flex"; button.focus(); expect(document.activeElement).toBe(button); box(".hero-form", 200, 500); component.onWindowScroll(); flush();
    expect(button.hasAttribute("inert")).toBeFalse(); expect(document.activeElement).toBe(button); button.blur(); component.onWindowScroll(); flush(); expect(button.hasAttribute("inert")).toBeTrue();
  });
  it("does not hide a focused login link", () => {
    width = 320; const login = host.querySelector<HTMLAnchorElement>(".login-link")!; login.focus(); box(".hero-form", -300, 70); component.onWindowScroll(); flush();
    expect(login.getAttribute("aria-hidden")).toBeNull(); expect(document.activeElement).toBe(login); login.blur(); component.onWindowScroll(); flush(); expect(action()?.hasAttribute("inert")).toBeFalse();
  });
  it("freezes the submitted destination then unlocks on failure without replay", async () => {
    let reject!: (error: Error) => void; intents.create.and.returnValue(new Promise((_resolve, fail) => { reject = fail; }));
    component.onUrlChange("https://example.invalid/carta"); fixture.detectChanges(); const pending = component.submitDemo(); fixture.detectChanges(); const input = host.querySelector<HTMLInputElement>("#hero-url")!;
    expect(input.readOnly).toBeTrue(); expect(host.querySelector(".hero-form")!.getAttribute("aria-busy")).toBe("true");
    await component.submitDemo(); expect(intents.create).toHaveBeenCalledTimes(1); reject(new Error("Synthetic failure")); await pending; fixture.detectChanges();
    expect(input.readOnly).toBeFalse(); expect(input.value).toBe("https://example.invalid/carta"); expect(host.querySelector(".hero-form")!.getAttribute("aria-busy")).toBe("false"); expect(intents.create).toHaveBeenCalledTimes(1);
  });
  it("connects format feedback to the input without publishing", () => {
    component.onUrlChange("https://example.invalid/carta"); fixture.detectChanges(); expect(host.querySelector("#hero-valid")).not.toBeNull(); expect(host.querySelector("#hero-url")!.getAttribute("aria-describedby")).toContain("hero-valid"); expect(intents.create).not.toHaveBeenCalled();
    component.onUrlChange(""); fixture.detectChanges(); expect(host.querySelector("#hero-valid")).toBeNull();
  });
  it("returns from the footer to a focused heading and retires focus work on teardown", () => {
    const back = host.querySelector<HTMLButtonElement>(".footer-back-top"); expect(back).not.toBeNull(); if (!back) return;
    const title = host.querySelector<HTMLElement>("#hero-title")!; spyOn(title, "scrollIntoView"); back.click(); flush(); expect(document.activeElement).toBe(title); expect(title.scrollIntoView).toHaveBeenCalled();
    back.click(); fixture.destroy(); expect(frames.size).toBe(0);
  });
  for (const url of ["https://user:password@example.invalid/carta", "https://example.invalid/" + "a".repeat(2048), "data:text/html,hello"]) {
    it("keeps rejected URL formats local: " + url.slice(0, 50), async () => { component.onUrlChange(url); await component.submitDemo(); expect(intents.create).not.toHaveBeenCalled(); expect(component.demoError()).toBeTruthy(); });
  }
});
