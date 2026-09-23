import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { MatSnackBar } from "@angular/material/snack-bar";
import { AdminDestinationsComponent } from "./admin-destinations.component";
import { ApiService } from "../../core/services/api.service";
import { ActionDialogService } from "../action-dialog.service";
import type { AdminDestinationEntry } from "../../core/models";

const entry: AdminDestinationEntry = {
  id: 3,
  match_kind: "host",
  match_value: "malicioso.example",
  reason: "Contenido fraudulento confirmado",
  source: "manual",
  expires_at: null,
  created_at: "2026-08-30T11:00:00Z",
};

describe("AdminDestinationsComponent", () => {
  let fixture: ComponentFixture<AdminDestinationsComponent>;
  let component: AdminDestinationsComponent;
  let api: jasmine.SpyObj<ApiService>;
  let actions: jasmine.SpyObj<ActionDialogService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "delete"]);
    api.get.and.resolveTo({ entries: [entry], total: 1, page: 1, perPage: 25 });
    api.delete.and.resolveTo({ releasedLinks: 2 });
    actions = jasmine.createSpyObj<ActionDialogService>("ActionDialogService", ["confirm", "prompt"]);
    actions.confirm.and.resolveTo(true);

    await TestBed.configureTestingModule({
      imports: [AdminDestinationsComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ApiService, useValue: api },
        { provide: ActionDialogService, useValue: actions },
        { provide: MatSnackBar, useValue: { open: jasmine.createSpy("open") } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminDestinationsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it("loads the blocked destinations", () => {
    expect(component.entries.rows()).toEqual([entry]);
    expect(api.get).toHaveBeenCalledWith(
      "/api/v1/admin/destinations",
      jasmine.objectContaining({ page: 1, perPage: 25 }),
      jasmine.any(Function),
      jasmine.objectContaining({ signal: jasmine.any(AbortSignal) }),
    );
  });

  it("withdraws an entry and reports the links it released", async () => {
    const changed = spyOn(component.changed, "emit");
    const snackbar = TestBed.inject(MatSnackBar) as unknown as { open: jasmine.Spy };

    await component.withdraw(entry);

    expect(actions.confirm).toHaveBeenCalled();
    expect(api.delete).toHaveBeenCalledWith("/api/v1/admin/destinations/3", undefined, jasmine.any(Function));
    expect(changed).toHaveBeenCalled();
    // What the withdrawal did is said in the operator's language, not as data.
    expect(snackbar.open.calls.mostRecent().args[0]).toContain("2 enlaces recuperan su estado");
  });

  it("disables the withdrawal while the page on screen may be stale", () => {
    component.entries.loading.set(true);
    fixture.detectChanges();
    let button = fixture.nativeElement.querySelector("button.danger-button") as HTMLButtonElement;
    expect(button.disabled).toBeTrue();

    // A failed read is just as stale as one still arriving: the rows visible
    // are context, not the answer to the current question.
    component.entries.loading.set(false);
    component.entries.error.set("No se pudieron cargar los destinos bloqueados");
    fixture.detectChanges();
    button = fixture.nativeElement.querySelector("button.danger-button") as HTMLButtonElement;
    expect(button.disabled).toBeTrue();
  });

  it("never decides against rows a failed read left behind", async () => {
    component.entries.error.set("No se pudieron cargar los destinos bloqueados");
    fixture.detectChanges();

    await component.withdraw(entry);

    expect(actions.confirm).not.toHaveBeenCalled();
    expect(api.delete).not.toHaveBeenCalled();
  });
});
