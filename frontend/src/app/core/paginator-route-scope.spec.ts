import { Component, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { MatPaginator, MatPaginatorIntl, MatPaginatorModule } from "@angular/material/paginator";
import { provideRouter, RouterOutlet } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { SpanishPaginatorIntl } from "./paginator-intl";
import { panelRoutes } from "../panel/panel.routes";

@Component({ standalone: true, imports: [RouterOutlet], template: "<router-outlet />" })
class PrivateShell {}

@Component({ standalone: true, imports: [MatPaginatorModule], template: `
  <mat-paginator [length]="23" [pageIndex]="page()" [pageSize]="10" [pageSizeOptions]="[10, 20]"
    [showFirstLastButtons]="true" (page)="page.set($event.pageIndex)" />
` })
class PrivatePage {
  readonly page = signal(0);
}

@Component({ standalone: true, template: "Public page" })
class PublicPage {}

describe("Spanish paginator in the lazy panel injector", () => {
  const pages = ["links", "links/trash", "team", "settings", "admin"];
  let harness: RouterTestingHarness;

  beforeEach(async () => {
    TestBed.configureTestingModule({ providers: [provideRouter([
      { path: "public", component: PublicPage },
      // Use the actual panel provider boundary with simple probe views. Guards
      // and page APIs are covered separately; this proves Material's DI/DOM.
      { path: "app", providers: panelRoutes[0].providers, component: PrivateShell,
        children: pages.map(path => ({ path, component: PrivatePage })) },
    ])] });
    harness = await RouterTestingHarness.create("/public");
  });

  function paginatorIntl(): MatPaginatorIntl {
    const node = harness.routeDebugElement!.query(By.directive(MatPaginator));
    return node.injector.get(MatPaginatorIntl);
  }

  for (const page of pages) {
    it(`keeps Spanish visible/accessible labels and range on direct ${page} navigation`, async () => {
      await harness.navigateByUrl("/app/" + page);
      const element = harness.routeNativeElement!;
      expect(paginatorIntl()).toEqual(jasmine.any(SpanishPaginatorIntl));
      expect(element.textContent).toContain("Elementos por página:");
      expect(element.textContent).toContain("1 – 10 de 23");
      for (const label of ["Página siguiente", "Página anterior", "Primera página", "Última página"]) {
        expect(element.querySelector(`button[aria-label="${label}"]`)).not.toBeNull();
      }
    });
  }

  it("retains pagination behavior and Spanish ranges after a page change", async () => {
    await harness.navigateByUrl("/app/links");
    (harness.routeNativeElement!.querySelector('button[aria-label="Página siguiente"]') as HTMLButtonElement).click();
    harness.detectChanges();
    expect(harness.routeNativeElement!.textContent).toContain("11 – 20 de 23");
    expect(paginatorIntl().getRangeLabel(2, 10, 23)).toBe("21 – 23 de 23");
    expect(paginatorIntl().getRangeLabel(0, 10, 0)).toBe("0 de 0");
  });

  it("shares one translation instance across private pages and a return from public navigation", async () => {
    await harness.navigateByUrl("/app/links");
    const intl = paginatorIntl();
    await harness.navigateByUrl("/app/team");
    expect(paginatorIntl()).toBe(intl);
    await harness.navigateByUrl("/public");
    await harness.navigateByUrl("/app/links/trash");
    expect(paginatorIntl()).toBe(intl);
  });
});
