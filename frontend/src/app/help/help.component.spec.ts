import { ComponentFixture, TestBed } from "@angular/core/testing";
import { signal } from "@angular/core";
import { provideRouter } from "@angular/router";
import { HelpComponent } from "./help.component";
import { ThemeService } from "../core/services/theme.service";

describe("HelpComponent public guide", () => {
  let fixture: ComponentFixture<HelpComponent>;
  let component: HelpComponent;

  beforeEach(async () => {
    await TestBed.configureTestingModule({
      imports: [HelpComponent],
      providers: [provideRouter([]), { provide: ThemeService, useValue: { resolved: signal("light"), toggle: jasmine.createSpy("toggle") } }],
    }).compileComponents();
    fixture = TestBed.createComponent(HelpComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it("indexes the actual guide content, not just its titles", () => {
    component.query.set("milisegundos");
    expect(component.matchingChapters().map((chapter) => chapter.id)).toEqual(["webhooks"]);
  });

  it("finds unaccented queries and common access terminology", () => {
    component.query.set("analitica");
    expect(component.matchingChapters().some((chapter) => chapter.id === "analytics")).toBeTrue();
    component.query.set("no puedo entrar");
    expect(component.matchingChapters().some((chapter) => chapter.id === "troubleshooting")).toBeTrue();
  });

  it("keeps the complete index when search has no matches", () => {
    component.query.set("tema-inexistente-xyz");
    fixture.detectChanges();
    const host = fixture.nativeElement as HTMLElement;
    expect(component.matchingChapters()).toEqual([]);
    expect(host.querySelectorAll('.guide-index nav a').length).toBe(7);
    expect(host.textContent).toContain("No hemos encontrado ese tema.");
  });

  it("clears search and returns keyboard focus to the field", () => {
    component.query.set("dominio");
    fixture.detectChanges();
    component.clearSearch();
    expect(component.query()).toBe("");
    expect(document.activeElement).toBe(fixture.nativeElement.querySelector('input[type="search"]'));
  });

  it("does not consume slash while someone is typing", () => {
    const input = fixture.nativeElement.querySelector('input[type="search"]') as HTMLInputElement;
    const event = new KeyboardEvent("keydown", { key: "/", bubbles: true, cancelable: true });
    input.dispatchEvent(event);
    expect(event.defaultPrevented).toBeFalse();
  });

  it("documents the token API route and the actual webhook signature header", () => {
    expect(component.requestExample).toContain("/api/v1/public/links");
    expect(component.signatureExample).toMatch(/^X-UVH-Signature:/);
    expect(component.requestExample).toContain("<tu-token>");
  });

  it("reports clipboard failure honestly", () => {
    component.copied(false);
    expect(component.copyMessage()).toContain("No se pudo copiar");
  });
});
