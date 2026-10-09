import { ViewportScroller } from "@angular/common";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { LegalShellComponent } from "./legal-shell.component";

describe("Public shell navigation", () => {
  let fixture: ComponentFixture<LegalShellComponent>, host: HTMLElement;
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [LegalShellComponent], providers: [provideRouter([])] }).compileComponents();
    fixture = TestBed.createComponent(LegalShellComponent); host = fixture.nativeElement as HTMLElement;
    fixture.detectChanges(); await fixture.whenStable();
  });
  afterEach(() => fixture.destroy());
  function trigger(): HTMLButtonElement | null { const button = host.querySelector<HTMLButtonElement>(".public-menu-trigger"); expect(button).not.toBeNull(); return button; }
  it("makes the background inert and locks scroll while mobile navigation is open", () => {
    const button = trigger(); if (!button) return; button.click(); fixture.detectChanges();
    expect(button.getAttribute("aria-expanded")).toBe("true"); expect(host.querySelector("main")!.hasAttribute("inert")).toBeTrue();
    expect(host.querySelector("footer")!.hasAttribute("inert")).toBeTrue(); expect(document.body.classList.contains("uvh-menu-open")).toBeTrue();
  });
  it("closes on Escape, restores trigger focus and unlocks background", async () => {
    const button = trigger(); if (!button) return; button.click(); fixture.detectChanges(); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    fixture.detectChanges(); await new Promise<void>((resolve) => requestAnimationFrame(() => resolve()));
    expect(button.getAttribute("aria-expanded")).toBe("false"); expect(document.activeElement).toBe(button);
    expect(host.querySelector("main")!.hasAttribute("inert")).toBeFalse(); expect(document.body.classList.contains("uvh-menu-open")).toBeFalse();
  });
  it("closes and releases scroll after resizing into desktop navigation", () => {
    const button = trigger(); if (!button) return; button.click(); fixture.detectChanges(); const original = Object.getOwnPropertyDescriptor(window, "innerWidth");
    try { Object.defineProperty(window, "innerWidth", { configurable: true, value: 1440 }); window.dispatchEvent(new Event("resize")); fixture.detectChanges(); expect(button.getAttribute("aria-expanded")).toBe("false"); expect(document.body.classList.contains("uvh-menu-open")).toBeFalse(); }
    finally { if (original) Object.defineProperty(window, "innerWidth", original); }
  });
  it("cancels queued focus and restores anchor offsets on teardown", () => {
    const button = trigger(); if (!button) return;
    let late!: FrameRequestCallback;
    spyOn(window, "requestAnimationFrame").and.callFake((callback) => { late = callback; return 987654; });
    const cancel = spyOn(window, "cancelAnimationFrame").and.callThrough(); const focus = spyOn(button, "focus");
    const offset = spyOn(TestBed.inject(ViewportScroller), "setOffset").and.callThrough();
    button.click(); document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
    fixture.destroy(); expect(cancel).toHaveBeenCalledWith(987654); expect(offset).toHaveBeenCalledWith([0, 0]);
    late(performance.now()); expect(focus).not.toHaveBeenCalled();
  });
  it("releases page scrolling when the open shell is destroyed", () => {
    const button = trigger(); if (!button) return; button.click(); fixture.detectChanges(); fixture.destroy(); expect(document.body.classList.contains("uvh-menu-open")).toBeFalse();
  });
});
