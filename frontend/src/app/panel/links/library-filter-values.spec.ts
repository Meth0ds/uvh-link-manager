import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideRouter } from "@angular/router";
import { LinksComponent } from "./links.component";
import { ApiService } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { LinkDto } from "../../core/models";

// Material's null handling must not turn a real choice into an empty trigger.
// Assert the visible value, not the component's configuration.
describe("Library filter and destination labels", () => {
  let fixture: ComponentFixture<LinksComponent>;
  const link: LinkDto = {
    id: 1, alias: "editorial", shortUrl: "https://uvh.test/editorial", destination: "https://example.invalid",
    fallbackDestination: null, tags: [], state: "active", clickCount: 0, maxClicks: null, singleUse: false,
    usedAt: null, scheduledAt: null, expiresAt: null, notes: null, passwordProtected: false,
    utm: { source: null, medium: null, campaign: null, term: null, content: null },
    domainId: null, domain: null, collectionId: null, collection: null,
    createdAt: "2026-10-06T00:00:00Z", updatedAt: "2026-10-06T00:00:00Z", version: 1,
  };

  beforeEach(async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "delete"]);
    api.get.and.callFake(((path: string) => Promise.resolve(path === "/api/v1/domains" ? { domains: [] }
      : path === "/api/v1/collections" ? { collections: [] } : { links: [link], total: 1, page: 1, perPage: 20 })) as never);
    await TestBed.configureTestingModule({
      imports: [LinksComponent], providers: [provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: WorkspaceService, useValue: { currentId: signal(1), currentRole: signal("owner") } },
      ],
    }).compileComponents();
    fixture = TestBed.createComponent(LinksComponent);
    fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  });
  afterEach(() => fixture.destroy());

  it("shows All domains when the domain filter has no restriction", () => {
    expect((fixture.nativeElement as HTMLElement).querySelector('.filters mat-select[aria-label="Dominio"] .mat-mdc-select-value-text')?.textContent)
      .toContain("Todos los dominios");
  });
  it("shows No collection when the bulk destination is null", async () => {
    fixture.componentInstance.selected.set(new Set([1]));
    fixture.componentInstance.bulkPanel.set("move"); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.bulk-inline mat-select .mat-mdc-select-value-text')?.textContent)
      .toContain("Sin colección");
  });
  it("shows the platform domain for the null bulk-domain destination", async () => {
    fixture.componentInstance.selected.set(new Set([1]));
    fixture.componentInstance.bulkPanel.set("domain"); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
    expect((fixture.nativeElement as HTMLElement).querySelector('.bulk-inline mat-select .mat-mdc-select-value-text')?.textContent)
      .toContain("uvh.es");
  });
  it("keeps the empty-string state filter readable", () => {
    expect((fixture.nativeElement as HTMLElement).querySelector('.filters mat-select[aria-label="Estado"] .mat-mdc-select-value-text')?.textContent)
      .toContain("Todos los estados");
  });
});
