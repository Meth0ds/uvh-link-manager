import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { MatDialogRef } from "@angular/material/dialog";
import { CollectionsDialogComponent } from "./collections-dialog.component";
import { TagsDialogComponent } from "./tags-dialog.component";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { ActionDialogService } from "../action-dialog.service";

// Exercise real components/templates through rejected/successful responses.
// Existing catalog and workspace-authority assertions remain untouched.
describe("Organization dialog recovery", () => {
  let fixture: ComponentFixture<CollectionsDialogComponent | TagsDialogComponent>;
  let api: jasmine.SpyObj<ApiService>;
  const workspace = signal<number | null>(1);

  async function mount(kind: "collections" | "tags", loadFails = false): Promise<void> {
    workspace.set(1);
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "patch", "delete"]);
    const collection = { id: 1, name: "Editorial", links: 2 };
    const catalog = kind === "collections" ? { collections: [collection] } : { tags: [collection] };
    if (loadFails) api.get.and.rejectWith(new ApiRequestError("No se pudo cargar el catálogo", 503));
    else api.get.and.resolveTo(catalog);
    api.post.and.resolveTo({ collection: { id: 2, name: "Mi campaña", links: 0 } });
    const actions = jasmine.createSpyObj<ActionDialogService>("ActionDialogService", ["confirm", "prompt"]);
    actions.confirm.and.resolveTo(true);
    actions.prompt.and.resolveTo("Otro nombre");
    await TestBed.configureTestingModule({
      imports: [CollectionsDialogComponent, TagsDialogComponent],
      providers: [provideNoopAnimations(),
        { provide: ApiService, useValue: api },
        { provide: WorkspaceService, useValue: { currentId: workspace, currentRole: signal("owner") } },
        { provide: ActionDialogService, useValue: actions },
        { provide: MatDialogRef, useValue: jasmine.createSpyObj("MatDialogRef", ["close"]) },
      ],
    }).compileComponents();
    fixture = kind === "collections" ? TestBed.createComponent(CollectionsDialogComponent) : TestBed.createComponent(TagsDialogComponent);
    fixture.detectChanges();
    await fixture.whenStable();
    fixture.detectChanges();
  }

  afterEach(() => fixture?.destroy());

  it("names the native tag checkbox so its purpose is available to assistive technology", async () => {
    await mount("tags");
    const checkbox = (fixture.nativeElement as HTMLElement).querySelector('input[type="checkbox"]');
    expect(checkbox?.getAttribute("aria-label")).toBe("Seleccionar la etiqueta Editorial");
  });

  it("retains the collection draft and existing rows after a rejected creation", async () => {
    await mount("collections");
    const component = fixture.componentInstance as CollectionsDialogComponent;
    component.newName = " Mi campaña ";
    api.post.and.rejectWith(new ApiRequestError("Nombre ya utilizado", 422));
    await component.create();
    fixture.detectChanges();
    expect(component.newName).toBe(" Mi campaña ");
    expect(api.get).toHaveBeenCalledTimes(1);
    expect(component.collections()[0].name).toBe("Editorial");
    expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')?.textContent).toContain("Nombre ya utilizado");
  });

  it("can retry the same draft, clearing it only after successful creation", async () => {
    await mount("collections");
    const component = fixture.componentInstance as CollectionsDialogComponent;
    component.newName = "Mi campaña";
    api.post.and.rejectWith(new ApiRequestError("Sin respuesta", 503));
    await component.create();
    api.post.and.resolveTo({ collection: { id: 2, name: "Mi campaña", links: 0 } });
    await component.create();
    expect(api.post).toHaveBeenCalledTimes(2);
    expect(api.post.calls.mostRecent().args[1]).toEqual({ name: "Mi campaña" });
    expect(component.newName).toBe("");
    expect(component.error()).toBeNull();
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  for (const kind of ["collections", "tags"] as const) {
    it(`recovers ${kind} from a load error through its retry button`, async () => {
      await mount(kind, true);
      api.get.and.resolveTo(kind === "collections" ? { collections: [{ id: 2, name: "Recuperado", links: 1 }] } : { tags: [{ id: 2, name: "Recuperado", links: 1 }] });
      const retry = Array.from((fixture.nativeElement as HTMLElement).querySelectorAll("button")).find(button => button.textContent?.includes("Reintentar"));
      expect(retry).toBeDefined(); retry!.click();
      fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')).toBeNull();
      expect((fixture.nativeElement as HTMLElement).textContent).toContain("Recuperado");
      expect(api.get).toHaveBeenCalledTimes(2);
    });
    it(`shows the empty ${kind} state only after a successful read`, async () => {
      await mount(kind);
      api.get.and.resolveTo(kind === "collections" ? { collections: [] } : { tags: [] });
      await fixture.componentInstance.reload(); fixture.detectChanges();
      expect((fixture.nativeElement as HTMLElement).querySelector('[role="alert"]')).toBeNull();
      expect((fixture.nativeElement as HTMLElement).querySelector(".manager-empty")?.textContent).toContain("Todavía no hay");
    });
  }

  it("keeps a newer draft entered while the previous collection is being created", async () => {
    await mount("collections");
    const component = fixture.componentInstance as CollectionsDialogComponent;
    let resolve!: (value: unknown) => void;
    api.post.and.returnValue(new Promise(done => { resolve = done; }));
    component.newName = "Primera";
    const pending = component.create(); component.newName = "Segunda";
    resolve({ collection: { id: 2, name: "Primera", links: 0 } }); await pending;
    expect(component.newName).toBe("Segunda");
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("preserves the previous collection and its error after a rejected rename", async () => {
    await mount("collections");
    const component = fixture.componentInstance as CollectionsDialogComponent;
    api.patch.and.rejectWith(new ApiRequestError("El cambio no se pudo guardar", 422));
    await component.rename(component.collections()[0]);
    expect(component.collections()[0].name).toBe("Editorial");
    expect(component.error()).toBe("El cambio no se pudo guardar");
    expect(api.get).toHaveBeenCalledTimes(1);
  });

  for (const kind of ["collections", "tags"] as const) {
    it(`never declares an empty ${kind} catalog when its initial read failed`, async () => {
      await mount(kind, true);
      const host = fixture.nativeElement as HTMLElement;
      expect(host.querySelector('[role="alert"]')?.textContent).toContain("No se pudo cargar el catálogo");
      expect(host.textContent).not.toContain("Todavía no hay");
      expect(Array.from(host.querySelectorAll("button")).some(button => button.textContent?.includes("Reintentar"))).toBeTrue();
    });
  }
});
