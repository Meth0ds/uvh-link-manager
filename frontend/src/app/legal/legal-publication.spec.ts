import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { TERMS_VERSION, PRIVACY_VERSION } from "../core/legal-documents";
import { LegalIdentityService } from "./legal-identity.service";
import { LegalShellComponent } from "./legal-shell.component";
import { TermsComponent } from "./terms.component";
import { PrivacyComponent } from "./privacy.component";

@Component({ selector: "app-legal-shell", template: "<ng-content />" })
class ReadingShellStub {}

for (const [component, slug, version] of [[TermsComponent, "terminos", TERMS_VERSION], [PrivacyComponent, "privacidad", PRIVACY_VERSION]] as const) {
  describe(`Published ${slug}`, () => {
    beforeEach(async () => {
      const legal = { ready: signal(true), identity: signal(null), error: signal(null), load: async () => {}, retry: async () => {} };
      await TestBed.configureTestingModule({ imports: [component], providers: [provideRouter([]), { provide: LegalIdentityService, useValue: legal }] })
        .overrideComponent(component, { remove: { imports: [LegalShellComponent] }, add: { imports: [ReadingShellStub] } }).compileComponents();
    });
    it("publishes every indexed clause once without draft instructions", () => {
      const fixture = TestBed.createComponent(component); fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      const sections = fixture.componentInstance.sections;
      expect(host.querySelectorAll(".doc-section").length).toBe(20);
      for (const section of sections) expect(host.querySelectorAll(`[id="${section.id}"]`).length).toBe(1);
      expect(host.querySelector(".doc-meta")!.textContent).toContain(version);
      expect(host.querySelector(".doc-content")!.textContent).not.toMatch(/borrador|código examinado|antes de publicar/i);
      fixture.destroy();
    });
    it("offers native links to the exact accepted copy and the previous version", () => {
      const fixture = TestBed.createComponent(component); fixture.detectChanges();
      const host = fixture.nativeElement as HTMLElement;
      const links = host.querySelectorAll<HTMLAnchorElement>(".doc-versions a");
      expect(links.length).toBe(2);
      expect(links[0].getAttribute("href")).toBe(`/legal/versions/${version}/${slug}.html`);
      expect(links[1].getAttribute("href")).toBe(`/legal/versions/2026-08-30/${slug}.html`);
      expect(host.textContent).toContain("Roberto Osorio Vidal");
      expect(host.textContent).toContain("49192425W");
      fixture.destroy();
    });
  });
}
