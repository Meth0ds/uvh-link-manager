import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { MatDialogRef } from "@angular/material/dialog";
import { TagsDialogComponent } from "./tags-dialog.component";
import { ApiService } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { ActionDialogService } from "../action-dialog.service";

describe("TagsDialogComponent", () => {
  let fixture: ComponentFixture<TagsDialogComponent>;
  let component: TagsDialogComponent;
  let api: jasmine.SpyObj<ApiService>;
  let actions: jasmine.SpyObj<ActionDialogService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post"]);
    api.get.and.resolveTo({
      tags: [
        { id: 1, name: "vieja", links: 2 },
        { id: 2, name: "nueva", links: 1 },
        { id: 3, name: "extra", links: 0 },
      ],
    });
    api.post.and.resolveTo({ ok: true, id: 1, name: "Prensa 2026" });
    actions = jasmine.createSpyObj<ActionDialogService>("ActionDialogService", ["confirm", "prompt"]);
    actions.confirm.and.resolveTo(true);
    actions.prompt.and.resolveTo("Prensa 2026");

    await TestBed.configureTestingModule({
      imports: [TagsDialogComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ApiService, useValue: api },
        { provide: WorkspaceService, useValue: { currentId: signal(1), currentRole: signal("owner") } },
        { provide: ActionDialogService, useValue: actions },
        { provide: MatDialogRef, useValue: jasmine.createSpyObj("MatDialogRef", ["close"]) },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(TagsDialogComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it("renames through the API and updates the row in place", async () => {
    await component.rename(component.tags()[0]);

    expect(api.post).toHaveBeenCalledOnceWith("/api/v1/tags/1/rename", { name: "Prensa 2026" }, jasmine.any(Function));
    expect(component.tags()[0].name).toBe("Prensa 2026");
  });

  it("merges the selected sources into the chosen target and reloads", async () => {
    component.toggle(1);
    component.toggle(3);
    expect(component.mergeTargets().map((tag) => tag.id)).toEqual([2]);
    component.mergeTargetId.set(2);

    await component.merge();

    expect(api.post).toHaveBeenCalledOnceWith("/api/v1/tags/merge", { sourceIds: [1, 3], targetId: 2 }, jasmine.any(Function));
    // La recarga posterior vuelve a listar: las fuentes ya no están.
    expect(api.get).toHaveBeenCalledTimes(2);
    expect(component.selected().size).toBe(0);
  });

  it("never offers a selected tag as merge target", () => {
    component.toggle(2);
    expect(component.mergeTargets().map((tag) => tag.id)).toEqual([1, 3]);
    expect(component.mergeTargetId()).toBeNull();
  });
});
