import { TestBed } from "@angular/core/testing";
import { MatDialog, MatDialogModule } from "@angular/material/dialog";
import { provideRouter } from "@angular/router";
import { firstValueFrom } from "rxjs";
import { ApiService } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { LinkDto, Workspace } from "../../core/models";
import type { LinkDialogComponent } from "./link-dialog.component";
import { LinkDialogService } from "./link-dialog.service";

const drain = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe("Lazy link editor with real Material dialog", () => {
  let api: jasmine.SpyObj<ApiService>;
  let dialog: MatDialog;
  let service: LinkDialogService;
  let trigger: HTMLButtonElement;
  let stored: string | null;
  const link: LinkDto = {
    id: 42, version: 3, alias: "operativa", destination: "https://example.com/original",
    shortUrl: "https://uvh.test/operativa", domainId: null, collectionId: null, tags: [],
    utm: { source: null, medium: null, campaign: null, term: null, content: null }, singleUse: false, maxClicks: null, scheduledAt: null, expiresAt: null, state: "active",
    fallbackDestination: null, clickCount: 0, usedAt: null, notes: null, passwordProtected: false,
    domain: null, collection: null, createdAt: "2026-10-09T00:00:00Z", updatedAt: "2026-10-09T00:00:00Z",
  };

  beforeEach(async () => {
    stored = localStorage.getItem("uvh.workspaceId"); localStorage.removeItem("uvh.workspaceId");
    api = jasmine.createSpyObj<ApiService>("api", ["get", "post", "patch"]);
    api.get.and.resolveTo({ domains: [], collections: [], templates: [], rules: [], available: true } as never);
    api.post.and.resolveTo({ link } as never); api.patch.and.resolveTo({ link } as never);
    await TestBed.configureTestingModule({ imports: [MatDialogModule], providers: [
      provideRouter([]), WorkspaceService, { provide: ApiService, useValue: api },
    ] }).compileComponents();
    TestBed.inject(WorkspaceService).setList([{ id: 1, role: "owner" }] as Workspace[]);
    dialog = TestBed.inject(MatDialog); service = TestBed.inject(LinkDialogService);
    trigger = document.createElement("button"); trigger.textContent = "Crear enlace";
    document.body.appendChild(trigger); trigger.focus();
  });
  afterEach(async () => {
    dialog.closeAll(); await drain(); TestBed.resetTestingModule(); trigger.remove();
    if (stored === null) localStorage.removeItem("uvh.workspaceId"); else localStorage.setItem("uvh.workspaceId", stored);
  });
  async function instance(): Promise<LinkDialogComponent> {
    await firstValueFrom(dialog.afterOpened);
    await drain(); TestBed.tick(); await drain();
    expect(dialog.openDialogs.length).toBe(1);
    return dialog.openDialogs[0].componentInstance as LinkDialogComponent;
  }
  it("loads and renders the actual create form, returns its save and restores focus", async () => {
    const opening = firstValueFrom(service.openCreate("https://example.com/saved"));
    const component = await instance();
    expect(component.isEdit).toBeFalse();
    expect(component.form.controls.destination.value).toBe("https://example.com/saved");
    expect(document.querySelector(".editor-heading h2")?.textContent).toContain("Crear enlace");
    await component.save();
    await expectAsync(opening).toBeResolvedTo(link);
    expect(api.post).toHaveBeenCalledTimes(1);
    expect(api.post.calls.mostRecent().args[0]).toBe("/api/v1/links");
    expect(document.activeElement).toBe(trigger);
  });
  it("loads and renders the actual edit form with versioned save", async () => {
    const opening = firstValueFrom(service.openEdit(link));
    const component = await instance();
    expect(component.isEdit).toBeTrue();
    expect(component.editDetailsLoaded()).toBeTrue();
    expect(component.form.controls.destination.value).toBe(link.destination);
    expect(document.querySelector(".editor-heading h2")?.textContent).toContain("Editar enlace");
    component.form.controls.destination.setValue("https://example.com/updated");
    await component.save();
    await expectAsync(opening).toBeResolvedTo(link);
    expect(api.patch.calls.mostRecent().args[0]).toBe("/api/v1/links/42");
    expect(api.patch.calls.mostRecent().args[1]).toEqual(jasmine.objectContaining({ version: 3, destination: "https://example.com/updated" }));
    expect(document.activeElement).toBe(trigger);
  });
  it("reopens the actual editor after cancellation without preserving the previous destination", async () => {
    const first = firstValueFrom(service.openCreate("https://example.com/first"));
    await instance(); dialog.openDialogs[0].close();
    await expectAsync(first).toBeResolvedTo(null);
    const second = firstValueFrom(service.openCreate());
    const component = await instance();
    expect(component.form.controls.destination.value).toBe("");
    dialog.openDialogs[0].close();
    await expectAsync(second).toBeResolvedTo(null);
  });
});
