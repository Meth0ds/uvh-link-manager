import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { provideRouter } from "@angular/router";
import { MatSnackBar } from "@angular/material/snack-bar";
import { LinkTrashComponent } from "./link-trash.component";
import { ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { ActionDialogService } from "../action-dialog.service";
import type { TrashLinkDto } from "../../core/models";

/** Sólo lo que las dos acciones leen de la fila: id y alias. */
function row(id: number): TrashLinkDto {
  return {
    link: { id, alias: `alias-${id}` },
    previousState: "active",
    deletedAt: "2026-09-20T10:00:00Z",
    purgeAt: "2026-09-27T10:00:00Z",
  } as unknown as TrashLinkDto;
}

/**
 * La papelera es donde el patrón anterior dejó de ser seguro: su `finally` no
 * limpiaba el flag cuando el workspace había cambiado, y como las dos acciones
 * empiezan con `if (actionId() !== null) return`, el workspace nuevo se quedaba
 * con la papelera muerta —sin restaurar ni borrar nada— hasta remontar la ruta.
 */
describe("LinkTrashComponent in-flight ownership", () => {
  let fixture: ComponentFixture<LinkTrashComponent>;
  let component: LinkTrashComponent;
  let api: jasmine.SpyObj<ApiService>;
  let actions: jasmine.SpyObj<ActionDialogService>;
  const workspaceId = signal<number | null>(1);
  const role = signal("owner");

  beforeEach(async () => {
    workspaceId.set(1);
    role.set("owner");
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post"]);
    // Un read fallido no afecta a lo que estas pruebas fijan, y evita tener que
    // fabricar un payload completo para el decodificador estricto de la papelera.
    api.get.and.rejectWith(new Error("offline"));
    api.post.and.resolveTo(undefined);
    actions = jasmine.createSpyObj<ActionDialogService>("ActionDialogService", ["confirm", "prompt"]);
    actions.confirm.and.resolveTo(true);

    await TestBed.configureTestingModule({
      imports: [LinkTrashComponent],
      providers: [
        provideNoopAnimations(),
        provideRouter([]),
        { provide: ApiService, useValue: api },
        { provide: WorkspaceService, useValue: { currentId: workspaceId, currentRole: role } },
        { provide: AuthService, useValue: { user: signal(null) } },
        { provide: ActionDialogService, useValue: actions },
        { provide: MatSnackBar, useValue: { open: jasmine.createSpy("open") } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(LinkTrashComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  afterEach(() => fixture.destroy());

  it("keeps the new workspace's rows usable after a switch abandons an action", async () => {
    // La operación nunca llega: mientras está en vuelo, la guarda bloquea todo.
    api.post.and.returnValue(new Promise<void>(() => {}));
    void component.restore(row(7));
    await fixture.whenStable();
    expect(component.actionId()).toBe(7);

    // El contexto cambia: su `finally` no libera este hueco (ya no es current),
    // así que lo libera el contexto. Sin eso, las dos acciones de la papelera
    // salían por la guarda para siempre.
    workspaceId.set(2);
    fixture.detectChanges();
    await fixture.whenStable();
    expect(component.actionId()).toBeNull();

    // Y el workspace nuevo puede trabajar de verdad: restaurar…
    api.post.and.resolveTo(undefined);
    await component.restore(row(9));
    expect(api.post).toHaveBeenCalledWith("/api/v1/links/9/restore");

    // …y borrar definitivamente.
    component.purgeId.set(11);
    component.password.set("tiovivo-cobrizo-astilla-42");
    component.confirmation.set("ELIMINAR alias-11");
    await component.purge(row(11));
    expect(actions.confirm).toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith("/api/v1/links/11/purge", jasmine.objectContaining({ password: "tiovivo-cobrizo-astilla-42" }));
  });

  it("does not let a stale action free the slot of a newer one on the same row", async () => {
    // A -> B -> A con la misma fila: la primera operación no puede reabrir las
    // filas de la segunda por terminar tarde (esto es lo que la identidad de
    // contexto no podía ver).
    let releaseFirst: () => void = () => {};
    api.post.and.returnValue(new Promise<void>((resolve) => { releaseFirst = resolve; }));
    void component.restore(row(7));
    await fixture.whenStable();
    expect(component.actionId()).toBe(7);

    workspaceId.set(2);
    fixture.detectChanges();
    await fixture.whenStable();
    workspaceId.set(1);
    fixture.detectChanges();
    await fixture.whenStable();

    // La operación nueva sobre la misma fila es la dueña del hueco. También
    // queda en vuelo: lo que se mide es de quién es el hueco, no si terminó.
    let releaseSecond: () => void = () => {};
    api.post.and.returnValue(new Promise<void>((resolve) => { releaseSecond = resolve; }));
    void component.restore(row(7));
    await fixture.whenStable();
    expect(component.actionId()).toBe(7);

    // La vieja termina tarde y no lo libera.
    releaseFirst();
    await fixture.whenStable();
    expect(component.actionId()).toBe(7);

    // Y la dueña sí lo libera cuando termina.
    releaseSecond();
    await fixture.whenStable();
    expect(component.actionId()).toBeNull();
  });
});
