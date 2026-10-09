import { TestBed } from "@angular/core/testing";
import { MAT_DIALOG_DATA, MatDialog, MatDialogRef } from "@angular/material/dialog";
import { Subject } from "rxjs";
import { ActionDialogService } from "./action-dialog.service";
import { ActionDialogComponent } from "./action-dialog.component";

describe("Action dialog private draft recovery", () => {
  it("prefills a multiline draft without submitting it and still validates the length", () => {
    const ref = jasmine.createSpyObj("dialog", ["close"]);
    TestBed.configureTestingModule({ providers: [
      { provide: MatDialogRef, useValue: ref },
      { provide: MAT_DIALOG_DATA, useValue: { title: "Resolver", message: "Respuesta", confirmLabel: "Registrar", inputLabel: "Motivo",
        inputValue: "Primera línea.\nSegunda línea.", inputMultiline: true, inputRequired: true, inputMinLength: 10, inputMaxLength: 2000 } },
    ] });
    const component = TestBed.runInInjectionContext(() => new ActionDialogComponent());
    expect(component.value).toBe("Primera línea.\nSegunda línea."); expect(ref.close).not.toHaveBeenCalled();
    component.value = "corta"; component.submit(); expect(ref.close).not.toHaveBeenCalled();
    component.value = "  Primera línea.\nSegunda línea.  "; component.submit();
    expect(ref.close).toHaveBeenCalledOnceWith("Primera línea.\nSegunda línea.");
  });
  it("closes a private prompt when its lifetime ends and refuses an already aborted prompt", async () => {
    const closed = new Subject<null>();
    const ref = { afterClosed: () => closed, close: jasmine.createSpy("close").and.callFake(() => { closed.next(null); closed.complete(); }) };
    const dialog = jasmine.createSpyObj("dialog", ["open"]); dialog.open.and.returnValue(ref);
    TestBed.configureTestingModule({ providers: [{ provide: MatDialog, useValue: dialog }] });
    const service = TestBed.inject(ActionDialogService), controller = new AbortController();
    const options = { title: "Resolver", message: "Motivo", confirmLabel: "Registrar", inputLabel: "Respuesta" };
    const pending = service.prompt(options, { signal: controller.signal }); controller.abort();
    expect(await pending).toBeNull(); expect(ref.close).toHaveBeenCalledOnceWith(null);
    expect(await service.prompt(options, { signal: controller.signal })).toBeNull(); expect(dialog.open).toHaveBeenCalledTimes(1);
  });

});
