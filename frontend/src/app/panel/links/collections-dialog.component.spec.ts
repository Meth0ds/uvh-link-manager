import { signal, type WritableSignal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { MatDialogRef } from "@angular/material/dialog";
import { CollectionsDialogComponent } from "./collections-dialog.component";
import { ApiService } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { ActionDialogService } from "../action-dialog.service";

describe("CollectionsDialogComponent", () => {
  let fixture: ComponentFixture<CollectionsDialogComponent>;
  let component: CollectionsDialogComponent;
  let api: jasmine.SpyObj<ApiService>;
  let actions: jasmine.SpyObj<ActionDialogService>;
  let dialogRef: jasmine.SpyObj<MatDialogRef<CollectionsDialogComponent, boolean>>;
  let workspaceId: WritableSignal<number | null>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "patch", "delete"]);
    api.get.and.resolveTo({ collections: [{ id: 1, name: "Campaña", links: 2 }] });
    api.post.and.resolveTo({ collection: { id: 2, name: "Nueva", links: 0 } });
    api.patch.and.resolveTo({ ok: true, id: 1, name: "Renombrada" });
    api.delete.and.resolveTo({ ok: true, moved: 2 });
    actions = jasmine.createSpyObj<ActionDialogService>("ActionDialogService", ["confirm", "prompt"]);
    actions.confirm.and.resolveTo(true);
    actions.prompt.and.resolveTo("Renombrada");
    dialogRef = jasmine.createSpyObj("MatDialogRef", ["close"]);
    workspaceId = signal(1);

    await TestBed.configureTestingModule({
      imports: [CollectionsDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ApiService, useValue: api },
        { provide: WorkspaceService, useValue: { currentId: workspaceId, currentRole: signal("owner") } },
        { provide: ActionDialogService, useValue: actions },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(CollectionsDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it("creates a collection with the store contract and reloads the list", async () => {
    component.newName = "Nueva";
    await component.create();

    expect(api.post).toHaveBeenCalledOnceWith("/api/v1/collections", { name: "Nueva" }, jasmine.any(Function));
    expect(api.get).toHaveBeenCalledTimes(2);
  });

  it("renames and deletes through their own endpoints", async () => {
    await component.rename(component.collections()[0]);
    expect(api.patch).toHaveBeenCalledOnceWith("/api/v1/collections/1", { name: "Renombrada" }, jasmine.any(Function));

    await component.remove(component.collections()[0]);
    expect(actions.confirm).toHaveBeenCalled();
    expect(api.delete).toHaveBeenCalledOnceWith("/api/v1/collections/1", undefined, jasmine.any(Function));
  });

  it("refuses to mutate into a workspace selected after the dialog opened", async () => {
    // El selector global cambia con el gestor abierto: crear/renombrar/borrar
    // pertenece al workspace de apertura y jamás debe salir hacia el nuevo.
    workspaceId.set(2);
    component.newName = "Nueva";

    await component.create();

    expect(api.post).not.toHaveBeenCalled();
    expect(dialogRef.close).toHaveBeenCalled();
  });

  it("closes telling the list changed after a mutation", async () => {
    component.newName = "Nueva";
    await component.create();
    component.close();
    expect(dialogRef.close).toHaveBeenCalledOnceWith(true);
  });
});
