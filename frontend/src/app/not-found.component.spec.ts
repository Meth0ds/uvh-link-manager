import { TestBed } from "@angular/core/testing";
import { Meta } from "@angular/platform-browser";
import { provideRouter } from "@angular/router";
import { NotFoundComponent } from "./not-found.component";

describe("NotFoundComponent", () => {
  it("mounts a keyboard-operated game and cleans up listeners and robots metadata", async () => {
    await TestBed.configureTestingModule({ imports: [NotFoundComponent], providers: [provideRouter([])] }).compileComponents();
    const meta = TestBed.inject(Meta);
    const previous = meta.getTag('name="robots"')?.content;
    const fixture = TestBed.createComponent(NotFoundComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    const root = fixture.nativeElement as HTMLElement;
    expect(root.querySelectorAll("main").length).toBe(1);
    expect(root.querySelectorAll("h1").length).toBe(1);
    expect(root.querySelectorAll("button[data-piece]").length).toBe(5);
    expect(meta.getTag('name="robots"')?.content).toBe("noindex, nofollow");
    const piece = root.querySelector<HTMLButtonElement>('[data-piece="0"]')!;
    const initial = piece.getAttribute("aria-label");
    piece.click();
    expect(piece.getAttribute("aria-label")).not.toBe(initial);
    for (const anchor of Array.from(root.querySelectorAll("a"))) {
      expect(["/es/", "/es/ayuda", "/es/app/dashboard", "/es/legal/privacidad", "#not-found-content"]).toContain(anchor.getAttribute("href")!);
    }
    root.querySelector<HTMLAnchorElement>(".nf-skip")!.click();
    expect(document.activeElement).toBe(root.querySelector("main"));
    fixture.destroy();
    const label = piece.getAttribute("aria-label");
    piece.click();
    expect(piece.getAttribute("aria-label")).toBe(label);
    expect(meta.getTag('name="robots"')?.content).toBe(previous);
  });
});
