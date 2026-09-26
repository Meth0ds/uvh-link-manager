import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { provideRouter } from "@angular/router";
import { MatSnackBar } from "@angular/material/snack-bar";
import { LinksComponent } from "./links.component";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { ActionDialogService } from "../action-dialog.service";
import type { LinkDto } from "../../core/models";

function row(id: number): LinkDto {
  return { id, alias: `alias-${id}`, shortUrl: `https://uvh.test/alias-${id}`, tags: [], state: "active" } as unknown as LinkDto;
}

/**
 * La clave de idempotencia de una acción masiva identifica la INTENCIÓN: debe
 * sobrevivir a un reintento sin respuesta (red caída, 5xx) para que el servidor
 * reproduzca la respuesta original en vez de aplicar el efecto dos veces, y
 * debe descartarse cuando el servidor respondió, porque un nuevo clic es una
 * nueva intención.
 */
describe("LinksComponent bulk idempotency", () => {
  let fixture: ComponentFixture<LinksComponent>;
  let component: LinksComponent;
  let api: jasmine.SpyObj<ApiService>;

  function keyAt(callIndex: number): string {
    const headers = api.post.calls.argsFor(callIndex)[3] as Record<string, string>;
    return headers["Idempotency-Key"];
  }

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "delete"]);
    api.get.and.rejectWith(new Error("offline"));
    api.post.and.rejectWith(new ApiRequestError("No se pudo conectar con el servidor", 0));

    await TestBed.configureTestingModule({
      imports: [LinksComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: WorkspaceService, useValue: { currentId: signal(1), currentRole: signal("owner") } },
        { provide: ActionDialogService, useValue: jasmine.createSpyObj("ActionDialogService", ["confirm", "prompt"]) },
        { provide: MatSnackBar, useValue: { open: jasmine.createSpy("open") } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LinksComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it("sends the selection with one key and reuses it only while the outcome is unknown", async () => {
    component.toggleSelected(1);
    component.toggleSelected(2);

    // Sin respuesta: el mismo clic reintentado sigue siendo la misma intención.
    await component.bulkState("pause");
    const first = keyAt(0);
    expect(first).toBeTruthy();
    expect(api.post.calls.argsFor(0)[1]).toEqual({ action: "pause", linkIds: [1, 2] });
    await component.bulkState("pause");
    expect(keyAt(1)).toBe(first);

    // El servidor respondió (y negó): la intención queda cerrada.
    api.post.and.rejectWith(new ApiRequestError("Un enlace bloqueado solo puede eliminarlo un administrador", 403));
    await component.bulkState("pause");
    expect(keyAt(2)).toBe(first);
    api.post.and.rejectWith(new ApiRequestError("No se pudo conectar con el servidor", 0));
    await component.bulkState("pause");
    expect(keyAt(3)).not.toBe(first);
  });

  it("treats a different selection or action as a different intention", async () => {
    component.toggleSelected(1);
    await component.bulkState("pause");
    component.toggleSelected(2);
    await component.bulkState("pause");
    expect(keyAt(1)).not.toBe(keyAt(0));

    await component.bulkState("archive");
    expect(keyAt(2)).not.toBe(keyAt(1));
  });

  it("clears the selection after the action lands and refuses to run empty", async () => {
    api.post.and.resolveTo({ ok: true, action: "trash", applied: 2 });
    component.toggleSelected(1);
    component.toggleSelected(2);
    await component.bulkState("pause");
    expect(component.selected().size).toBe(0);

    // Sin selección no hay intención que sellar.
    const before = api.post.calls.count();
    await component.bulkState("pause");
    expect(api.post.calls.count()).toBe(before);
  });

  it("selects and unselects the whole visible page", () => {
    component.links.set([row(1), row(2), row(3)]);
    component.toggleSelectPage(true);
    expect([...component.selected()]).toEqual([1, 2, 3]);
    expect(component.allOnPage()).toBeTrue();
    component.toggleSelected(2);
    expect(component.allOnPage()).toBeFalse();
    component.toggleSelectPage(false);
    expect(component.selected().size).toBe(0);
  });
});
