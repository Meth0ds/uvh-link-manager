import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { MatSnackBar } from "@angular/material/snack-bar";
import { AdminAppealsComponent } from "./admin-appeals.component";
import { ApiService } from "../../core/services/api.service";
import { ActionDialogService } from "../action-dialog.service";
import type { AdminAppeal } from "../../core/models";

const appeal: AdminAppeal = {
  id: 3,
  message: "El bloqueo fue automático y el destino es legítimo.",
  status: "open",
  created_at: "2026-08-30T11:00:00Z",
  decided_at: null,
  decision_note: null,
  alias: "campaign",
  destination: "https://example.test",
  link_state: "blocked",
  workspace_id: 4,
};

describe("AdminAppealsComponent", () => {
  let fixture: ComponentFixture<AdminAppealsComponent>;
  let component: AdminAppealsComponent;
  let api: jasmine.SpyObj<ApiService>;
  let actions: jasmine.SpyObj<ActionDialogService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post"]);
    api.get.and.resolveTo({ appeals: [appeal], total: 1, page: 1, perPage: 25 });
    api.post.and.resolveTo({ ok: true });
    actions = jasmine.createSpyObj<ActionDialogService>("ActionDialogService", ["confirm", "prompt"]);
    actions.confirm.and.resolveTo(true);
    actions.prompt.and.resolveTo("Se mantiene el bloqueo");

    await TestBed.configureTestingModule({
      imports: [AdminAppealsComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ApiService, useValue: api },
        { provide: ActionDialogService, useValue: actions },
        { provide: MatSnackBar, useValue: { open: jasmine.createSpy("open") } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminAppealsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it("opens on the cases still waiting for a verdict", () => {
    expect(component.appeals.rows()).toEqual([appeal]);
    expect(api.get).toHaveBeenCalledWith(
      "/api/v1/admin/appeals",
      jasmine.objectContaining({ status: "open", page: 1, perPage: 25 }),
      jasmine.any(Function),
      jasmine.objectContaining({ signal: jasmine.any(AbortSignal) }),
    );
  });

  it("resets pagination when the filter changes", async () => {
    component.appeals.page.set(3);
    api.get.calls.reset();

    component.filter("upheld");
    await fixture.whenStable();

    expect(component.appeals.page()).toBe(0);
    expect(api.get).toHaveBeenCalledWith(
      "/api/v1/admin/appeals",
      jasmine.objectContaining({ status: "upheld", page: 1 }),
      jasmine.any(Function),
      jasmine.any(Object),
    );
  });

  it("records the verdict with its note and hands the refresh to the console", async () => {
    const changed = spyOn(component.changed, "emit");
    api.post.calls.reset();

    await component.resolve(appeal, "uphold");

    expect(api.post).toHaveBeenCalledWith("/api/v1/admin/appeals/3/decision", {
      decision: "uphold",
      note: "Se mantiene el bloqueo",
    });
    expect(changed).toHaveBeenCalled();
  });

  it("does nothing when the operator cancels the dialog", async () => {
    actions.prompt.and.resolveTo(null);
    api.post.calls.reset();

    await component.resolve(appeal, "restore");

    expect(api.post).not.toHaveBeenCalled();
  });
});
