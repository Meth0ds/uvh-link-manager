import { ComponentFixture, TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { LegalDocumentNavigationComponent, LegalSection } from "./legal-document-navigation.component";

describe("Legal document index", () => {
  let fixture: ComponentFixture<LegalDocumentNavigationComponent>;
  let host: HTMLElement;
  const sections: readonly LegalSection[] = Object.freeze([
    Object.freeze({ id: "datos", title: "Datos tratados" }),
    Object.freeze({ id: "conservacion", title: "Conservación y eliminación" }),
    Object.freeze({ id: "seguridad", title: "Seguridad" }),
  ]);
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [LegalDocumentNavigationComponent], providers: [provideRouter([])] }).compileComponents();
    fixture = TestBed.createComponent(LegalDocumentNavigationComponent);
    fixture.componentRef.setInput("sections", sections);
    host = fixture.nativeElement;
    fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());
  function search(value: string): void {
    const input = host.querySelector<HTMLInputElement>("input")!;
    input.value = value; input.dispatchEvent(new Event("input", { bubbles: true })); fixture.detectChanges();
  }
  it("matches accent-insensitive Spanish titles and preserves original chapter numbers", () => {
    search("  ELIMINACION ");
    expect(host.querySelectorAll("ol a").length).toBe(1);
    expect(host.querySelector("ol a")!.textContent).toContain("02");
    expect(host.querySelector("ol a")!.getAttribute("href")).toContain("#conservacion");
    expect(sections.length).toBe(3);
  });
  it("explains an empty result and clears it with focus returned to the search", () => {
    search("inexistente");
    expect(host.querySelectorAll("ol a").length).toBe(0);
    expect(host.querySelector(".no-results")?.textContent).toContain("No hay apartados");
    host.querySelector<HTMLButtonElement>('[aria-label="Limpiar búsqueda"]')!.click(); fixture.detectChanges();
    expect(host.querySelectorAll("ol a").length).toBe(3);
    expect(document.activeElement).toBe(host.querySelector("input"));
    expect(host.querySelector<HTMLInputElement>("input")!.value).toBe("");
  });
  it("reports expanded state on the native mobile toggle", () => {
    const button = host.querySelector<HTMLButtonElement>(".outline-toggle")!;
    expect(button.getAttribute("aria-expanded")).toBe("false");
    button.click(); fixture.detectChanges(); expect(button.getAttribute("aria-expanded")).toBe("true");
    button.click(); fixture.detectChanges(); expect(button.getAttribute("aria-expanded")).toBe("false");
  });
  it("prints the complete browser document without changing the index", () => {
    search("seguridad"); const print = spyOn(window, "print");
    host.querySelector<HTMLButtonElement>(".print-document")!.click();
    expect(print).toHaveBeenCalledTimes(1); expect(fixture.componentInstance.query()).toBe("seguridad");
  });
  it("keeps a focused search visible when resizing to a narrow viewport", () => {
    const original = Object.getOwnPropertyDescriptor(window, "innerWidth");
    try {
      host.querySelector<HTMLInputElement>("input")!.focus();
      Object.defineProperty(window, "innerWidth", { configurable: true, value: 390 });
      window.dispatchEvent(new Event("resize")); fixture.detectChanges();
      expect(fixture.componentInstance.expanded()).toBeTrue();
    } finally { if (original) Object.defineProperty(window, "innerWidth", original); }
  });
});

describe("Legal reading position", () => {
  let fixture: ComponentFixture<LegalDocumentNavigationComponent>;
  let root: HTMLElement;
  let offset: number;
  let frame: FrameRequestCallback | undefined;
  let request: jasmine.Spy;
  let observer: jasmine.SpyObj<ResizeObserver>;
  const sections: readonly LegalSection[] = [
    { id: "first", title: "Primero" }, { id: "middle", title: "Medio" }, { id: "last", title: "Final" },
  ];
  beforeEach(async () => {
    await TestBed.configureTestingModule({ imports: [LegalDocumentNavigationComponent], providers: [provideRouter([])] }).compileComponents();
    offset = 0;
    observer = jasmine.createSpyObj<ResizeObserver>("observer", ["observe", "disconnect"]);
    spyOn(window, "ResizeObserver").and.returnValue(observer);
    request = spyOn(window, "requestAnimationFrame").and.callFake((callback) => { frame = callback; return 41; });
    spyOn(window, "cancelAnimationFrame");
    fixture = TestBed.createComponent(LegalDocumentNavigationComponent);
    fixture.componentRef.setInput("sections", sections);
    root = document.createElement("div"); root.className = "legal-doc";
    document.body.append(root); root.append(fixture.nativeElement);
    const content = document.createElement("div"); content.className = "doc-content"; root.append(content);
    for (const [index, section] of sections.entries()) {
      const element = document.createElement("section"); element.className = "doc-section"; element.id = section.id;
      spyOn(element, "getBoundingClientRect").and.callFake(() => ({ top: 100 + index * 1000 - offset, bottom: 1100 + index * 1000 - offset } as DOMRect));
      content.append(element);
    }
    fixture.detectChanges();
  });
  afterEach(() => { fixture.destroy(); root.remove(); frame = undefined; });
  function scroll(to: number): void { offset = to; window.dispatchEvent(new Event("scroll")); }
  function flushFrame(): void { const callback = frame; frame = undefined; callback?.(0); fixture.detectChanges(); }
  it("tracks the visible chapter and bounded progress instead of the URL fragment", () => {
    expect(fixture.componentInstance.reading()?.id).toBe("first");
    expect(fixture.componentInstance.reading()?.percent).toBe(0);
    scroll(1200); flushFrame();
    expect(fixture.componentInstance.reading()?.id).toBe("middle");
    expect(root.querySelector('[aria-current="location"]')?.getAttribute("href")).toContain("#middle");
    expect(root.querySelectorAll('[aria-current="location"]').length).toBe(1);
    expect(Number(root.querySelector('[role="progressbar"]')?.getAttribute("aria-valuenow"))).toBeGreaterThan(0);
    scroll(3100); flushFrame();
    expect(fixture.componentInstance.reading()?.percent).toBe(100);
    expect(fixture.componentInstance.reading()?.id).toBe("last");
    scroll(-100); flushFrame(); expect(fixture.componentInstance.reading()?.percent).toBe(0);
  });
  it("coalesces scroll bursts and retains the complete-document position when searching", () => {
    request.calls.reset(); scroll(1100); scroll(1200); scroll(1300);
    expect(request).toHaveBeenCalledTimes(1); flushFrame();
    fixture.componentInstance.searchChanged("Final"); fixture.detectChanges(); flushFrame();
    expect(root.querySelectorAll("ol a").length).toBe(1);
    expect(fixture.componentInstance.reading()?.id).toBe("middle");
    expect(root.querySelector('[role="progressbar"]')?.getAttribute("aria-valuetext")).toBe("Apartado 2 de 3");
  });
  it("does not write scroll position to storage or network and cleans up queued work", () => {
    const storage = spyOn(Storage.prototype, "setItem");
    const fetch = spyOn(window, "fetch");
    scroll(1200); const stale = frame;
    const previous = fixture.componentInstance.reading(); fixture.destroy();
    expect(observer.disconnect).toHaveBeenCalledTimes(1);
    expect(window.cancelAnimationFrame).toHaveBeenCalledWith(41);
    stale?.(0); window.dispatchEvent(new Event("scroll"));
    expect(fixture.componentInstance.reading()).toEqual(previous);
    expect(storage).not.toHaveBeenCalled(); expect(fetch).not.toHaveBeenCalled();
  });
});
