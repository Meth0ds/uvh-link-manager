import { ComponentFixture, TestBed } from "@angular/core/testing";
import { signal } from "@angular/core";
import { provideRouter } from "@angular/router";
import { LandingComponent } from "./landing.component";
import { ApiService } from "../core/services/api.service";
import { PendingLinkIntentService } from "../core/services/pending-link-intent.service";
import { ThemeService } from "../core/services/theme.service";

describe("LandingComponent URL console", () => {
  let fixture: ComponentFixture<LandingComponent>;
  let component: LandingComponent;
  let intents: jasmine.SpyObj<PendingLinkIntentService>;

  beforeEach(async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["get"]);
    api.get.and.resolveTo({ appUrl: "https://app.uvh.test" });
    intents = jasmine.createSpyObj<PendingLinkIntentService>("PendingLinkIntentService", ["create"]);
    const theme = {
      resolved: signal<"light" | "dark">("light"),
      set: jasmine.createSpy("set"),
      toggle: jasmine.createSpy("toggle"),
    };

    await TestBed.configureTestingModule({
      imports: [LandingComponent],
      providers: [
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: PendingLinkIntentService, useValue: intents },
        { provide: ThemeService, useValue: theme },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LandingComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it("blocks an invalid destination before creating a pending intent", async () => {
    component.onUrlChange("javascript:alert(1)");

    await component.submitDemo();

    expect(intents.create).not.toHaveBeenCalled();
    expect(component.demoError()).toContain("URL http(s) válida");
  });

  it("hands off only an opaque intent and a short return path", async () => {
    const destination = "https://example.com/campaign?source=landing";
    intents.create.and.resolveTo({ intent: "a".repeat(43), expiresAt: new Date(Date.now() + 86_400_000).toISOString() });
    const handoff = spyOn(component as any, "handoffToAuth");
    component.onUrlChange(destination);

    await component.submitDemo();

    expect(intents.create).toHaveBeenCalledWith(destination);
    const target = handoff.calls.mostRecent().args[0] as string;
    const targetUrl = new URL(target);
    expect(targetUrl.origin).toBe(window.location.origin);
    expect(targetUrl.searchParams.get("mode")).toBe("register");
    expect(targetUrl.searchParams.get("returnTo")).toBe("/app/links");
    expect(targetUrl.searchParams.get("intent")).toBe("a".repeat(43));
    expect(target).not.toContain(encodeURIComponent(destination));
    expect(target).not.toContain("destination=");
  });

  it("locks page scrolling while the mobile navigation is open", () => {
    component.openMobileMenu();
    fixture.detectChanges();

    expect(component.mobileOpen()).toBeTrue();
    expect(document.body.classList.contains("uvh-menu-open")).toBeTrue();

    component.onEscape();
    fixture.detectChanges();

    expect(component.mobileOpen()).toBeFalse();
    expect(document.body.classList.contains("uvh-menu-open")).toBeFalse();
  });

  it("uses a single visible menu control and removes the closed menu from interaction", () => {
    const host = fixture.nativeElement as HTMLElement;
    const trigger = host.querySelector<HTMLButtonElement>(".menu-trigger")!;
    const layer = host.querySelector<HTMLElement>(".mobile-menu-layer")!;

    expect(host.querySelectorAll(".menu-trigger").length).toBe(1);
    expect(host.querySelectorAll(".mobile-sheet button[aria-label*='Cerrar']").length).toBe(0);
    expect(trigger.getAttribute("aria-expanded")).toBe("false");
    expect(layer.hasAttribute("inert")).toBeTrue();

    trigger.click();
    fixture.detectChanges();

    expect(trigger.getAttribute("aria-expanded")).toBe("true");
    expect(layer.hasAttribute("inert")).toBeFalse();
  });

  it("supports arrow, Home and End navigation across the product tabs", () => {
    const host = fixture.nativeElement as HTMLElement;
    const tabs = () => Array.from(host.querySelectorAll<HTMLButtonElement>("[role='tab']"));

    tabs()[0].dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowRight", bubbles: true }));
    fixture.detectChanges();
    expect(component.activeProductViewId()).toBe("route");
    expect(tabs()[1].getAttribute("aria-selected")).toBe("true");
    expect(tabs()[1].tabIndex).toBe(0);

    tabs()[1].dispatchEvent(new KeyboardEvent("keydown", { key: "End", bubbles: true }));
    fixture.detectChanges();
    expect(component.activeProductViewId()).toBe("measure");

    tabs()[2].dispatchEvent(new KeyboardEvent("keydown", { key: "Home", bubbles: true }));
    fixture.detectChanges();
    expect(component.activeProductViewId()).toBe("publish");
  });

  it("describes implemented product capabilities without decorative security claims", () => {
    const text = (fixture.nativeElement as HTMLElement).textContent ?? "";

    expect(text).toContain("Dominios propios");
    expect(text).toContain("API tokens");
    expect(text).toContain("retomaremos esta URL");
    expect(text).not.toContain("Cookie HttpOnly");
    expect(text).not.toContain("CSRF activo");
    expect(text).not.toContain("hCaptcha oficial");
    expect(text).not.toContain("testimonio");
    expect(text).not.toContain("€/mes");
  });
});
