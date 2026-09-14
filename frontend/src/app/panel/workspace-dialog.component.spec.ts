import { TestBed } from "@angular/core/testing";
import { FormBuilder } from "@angular/forms";
import { MatDialogRef } from "@angular/material/dialog";

import type { Workspace } from "../core/models";
import { ApiService } from "../core/services/api.service";
import { WorkspaceDialogComponent } from "./workspace-dialog.component";

describe("WorkspaceDialogComponent async safety", () => {
  it("rejects whitespace-padded short names and provides a visible validation message", async () => {
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
    TestBed.configureTestingModule({ imports: [WorkspaceDialogComponent], providers: [
      { provide: ApiService, useValue: api }, { provide: MatDialogRef, useValue: { close: jasmine.createSpy("close") } },
    ] });
    const fixture = TestBed.createComponent(WorkspaceDialogComponent);
    fixture.componentInstance.form.controls.name.setValue("  a  ");
    await fixture.componentInstance.save(); fixture.detectChanges();
    expect(fixture.componentInstance.form.invalid).toBeTrue();
    expect(fixture.nativeElement.querySelector("mat-error").textContent).toContain("al menos 2 caracteres");
    expect(api.post).not.toHaveBeenCalled();
    fixture.componentInstance.form.controls.name.setValue("  Estudio Norte  ");
    expect(fixture.componentInstance.form.valid).toBeTrue();
    fixture.destroy();
  });
  it("does not close a destroyed dialog when creation finishes later", async () => {
    let resolve!: (value: { workspace: Workspace }) => void;
    const response = new Promise<{ workspace: Workspace }>((onResolve) => { resolve = onResolve; });
    const api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
    api.post.and.returnValue(response);
    const dialogRef = jasmine.createSpyObj<MatDialogRef<WorkspaceDialogComponent>>("MatDialogRef", ["close"]);
    TestBed.configureTestingModule({
      imports: [WorkspaceDialogComponent],
      providers: [
        FormBuilder,
        { provide: ApiService, useValue: api },
        { provide: MatDialogRef, useValue: dialogRef },
      ],
    });
    const fixture = TestBed.createComponent(WorkspaceDialogComponent);
    const component = fixture.componentInstance;
    component.form.controls.name.setValue("Workspace seguro");

    const saving = component.save();
    fixture.destroy();
    resolve({
      workspace: { id: 1, name: "Workspace seguro", slug: "workspace-seguro", role: "owner", createdAt: "2026-09-05T00:00:00Z" },
    });
    await saving;

    expect(dialogRef.close).not.toHaveBeenCalled();
  });
});
