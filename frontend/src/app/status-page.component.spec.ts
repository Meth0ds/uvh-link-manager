import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, provideRouter } from "@angular/router";
import { StatusPageComponent } from "./status-page.component";

describe("StatusPageComponent safe navigation", () => {
  for (const kind of ["forbidden"] as const) {
    it(`renders useful ${kind} guidance without reflecting private route data`, async () => {
      await TestBed.configureTestingModule({ imports: [StatusPageComponent], providers: [
        provideRouter([]), { provide: ActivatedRoute, useValue: {
          snapshot: { data: { kind }, queryParams: { token: "do-not-reflect-this" }, fragment: "private-fragment" },
        } },
      ] }).compileComponents();
      const fixture = TestBed.createComponent(StatusPageComponent);
      fixture.detectChanges();
      await fixture.whenStable();
      const root = fixture.nativeElement as HTMLElement;
      expect(root.querySelectorAll("main").length).toBe(1);
      expect(root.querySelectorAll("h1").length).toBe(1);
      expect(root.textContent).toContain("403");
      expect(root.textContent).not.toContain("do-not-reflect-this");
      expect(root.textContent).not.toContain("private-fragment");
      const primary = root.querySelector(".actions a") as HTMLAnchorElement;
      expect(primary.getAttribute("href")).toBe("/es/app/dashboard");
      for (const link of Array.from(root.querySelectorAll("a"))) {
        expect(["#status-content", "/es/", "/es/app/dashboard", "/es/ayuda", "/es/estado", "/es/legal/privacidad"]).toContain(link.getAttribute("href")!);
      }
      const skip = root.querySelector(".skip-link") as HTMLAnchorElement;
      skip.click();
      expect(document.activeElement).toBe(root.querySelector("main"));
      fixture.destroy();
    });
  }
});
