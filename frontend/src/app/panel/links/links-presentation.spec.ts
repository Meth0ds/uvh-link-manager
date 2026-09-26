import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideRouter, Router } from "@angular/router";
import { LinksComponent } from "./links.component";
import { ApiService } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { LinkDto } from "../../core/models";

const links = [1, 2].map(id => ({
  id, alias: `example-${id}`, shortUrl: `https://uvh.test/example-${id}`,
  destination: "https://example.test/article", tags: ["editorial"], state: "active", clickCount: 3,
})) as LinkDto[];

describe("Link library presentation", () => {
  let fixture: ComponentFixture<LinksComponent>;
  let component: LinksComponent;
  let api: jasmine.SpyObj<ApiService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "delete"]);
    api.get.and.resolveTo({ links, total: 2, page: 1, perPage: 20 });
    await TestBed.configureTestingModule({
      imports: [LinksComponent],
      providers: [provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: WorkspaceService, useValue: { currentId: signal(1), currentRole: signal("owner") } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LinksComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  });

  it("keeps row actions outside a link and does not hijack their keyboard events", () => {
    const host: HTMLElement = fixture.nativeElement;
    const navigation = spyOn(TestBed.inject(Router), "navigate");
    const action = host.querySelector<HTMLButtonElement>('button[aria-label="Más acciones"]')!;
    action.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter", bubbles: true }));
    action.dispatchEvent(new KeyboardEvent("keydown", { key: " ", bubbles: true }));
    expect(navigation).not.toHaveBeenCalled();
    expect(host.querySelector("article[role=link]")).toBeNull();
    expect(host.querySelector<HTMLAnchorElement>("a.short")?.getAttribute("href")).toBe("/app/links/1");
  });

  it("labels each native selection input and shows partial page selection", () => {
    component.toggleSelected(1);
    fixture.detectChanges();
    const host: HTMLElement = fixture.nativeElement;
    expect(host.querySelector<HTMLInputElement>('.link-check input')?.getAttribute("aria-label"))
      .toBe("Seleccionar enlace uvh.test/example-1");
    expect(host.querySelector<HTMLInputElement>('.scale-toolbar input')?.indeterminate).toBeTrue();
    component.toggleSelectPage(true);
    fixture.detectChanges();
    expect(host.querySelector<HTMLInputElement>('.scale-toolbar input')?.indeterminate).toBeFalse();
    expect(component.allOnPage()).toBeTrue();
  });

  it("explains empty search results and resets filters, page and selection together", async () => {
    component.q.set("missing");
    component.state.set("paused");
    component.tag.set("editorial");
    component.page.set(3);
    component.links.set([]);
    component.total.set(0);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector(".empty-state")?.textContent)
      .toContain("No hay enlaces con estos filtros");
    component.selected.set(new Set([1]));
    component.clearFilters();
    await fixture.whenStable();
    expect(component.hasFilters()).toBeFalse();
    expect(component.page()).toBe(0);
    expect(component.selected().size).toBe(0);
    expect(api.get.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({ q: "", state: "", tag: "", page: 1 }));
  });

  it("does not announce an initial zero result count while a read is pending", () => {
    component.loading.set(true);
    component.total.set(0);
    fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector(".filter-count")?.textContent).toBe("Buscando…");
  });
});
