import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { MatSnackBar } from "@angular/material/snack-bar";
import { AdminReportsComponent } from "./admin-reports.component";
import { ApiService } from "../../core/services/api.service";
import { ActionDialogService } from "../action-dialog.service";
import type { AdminReport } from "../../core/models";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}

const report: AdminReport = {
  id: 7,
  link_id: 12,
  reporter_email: "reporter@example.test",
  reason: "Phishing",
  details: "Detalle del caso",
  status: "open",
  created_at: "2026-08-30T11:00:00Z",
  alias: "campaign",
  destination: "https://example.test",
  link_state: "active",
  workspace_id: 4,
};

describe("AdminReportsComponent", () => {
  let fixture: ComponentFixture<AdminReportsComponent>;
  let component: AdminReportsComponent;
  let api: jasmine.SpyObj<ApiService>;
  let actions: jasmine.SpyObj<ActionDialogService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post"]);
    api.get.and.resolveTo({ reports: [report], total: 1, page: 1, perPage: 25 });
    api.post.and.resolveTo({ ok: true });
    actions = jasmine.createSpyObj<ActionDialogService>("ActionDialogService", ["confirm", "prompt"]);
    actions.confirm.and.resolveTo(true);
    actions.prompt.and.resolveTo("Contenido fraudulento confirmado");

    await TestBed.configureTestingModule({
      imports: [AdminReportsComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ApiService, useValue: api },
        { provide: ActionDialogService, useValue: actions },
        { provide: MatSnackBar, useValue: { open: jasmine.createSpy("open") } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminReportsComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it("loads the open cases with server pagination", () => {
    expect(component.reports.rows()).toEqual([report]);
    expect(api.get).toHaveBeenCalledWith(
      "/api/v1/admin/reports",
      jasmine.objectContaining({ status: "open", page: 1, perPage: 25 }),
      jasmine.any(Function),
      jasmine.objectContaining({ signal: jasmine.any(AbortSignal) }),
    );
  });

  it("blocks a reported link through the atomic moderation endpoint", async () => {
    const changed = spyOn(component.changed, "emit");
    api.post.calls.reset();

    await component.block(report);

    expect(actions.prompt).toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith("/api/v1/admin/reports/7/moderate", {
      action: "block",
      reason: "Contenido fraudulento confirmado",
    });
    // The console, not this queue, re-reads the views a decision invalidates.
    expect(changed).toHaveBeenCalled();
  });

  it("reports a destination block so the console can re-read the list it wrote to", async () => {
    const changed = spyOn(component.changed, "emit");
    const snackbar = TestBed.inject(MatSnackBar) as unknown as { open: jasmine.Spy };
    api.post.and.resolveTo({ ok: true, linksScheduled: 2, linksSweepTruncated: false });

    await component.blockDestination(report, "host");

    expect(api.post).toHaveBeenCalledWith(
      "/api/v1/admin/links/12/block-destination",
      { reason: "Contenido fraudulento confirmado", scope: "host" },
      jasmine.any(Function),
    );
    expect(changed).toHaveBeenCalled();
    // What the sweep did is said in the operator's language, not as a count.
    expect(snackbar.open.calls.mostRecent().args[0]).toContain("2 enlaces ya apuntaban ahí");
  });

  it("keeps the newest page and loading state", async () => {
    const older = deferred<unknown>();
    const newer = deferred<unknown>();
    api.get.and.returnValues(older.promise as never, newer.promise as never);
    component.query.set("older");
    const first = component.reports.load();
    component.query.set("newer");
    const second = component.reports.load();

    older.resolve({ reports: [{ ...report, id: 301 }], total: 1 });
    await first;
    expect(component.reports.loading()).toBeTrue();
    expect(component.reports.rows()[0]?.id).not.toBe(301);

    newer.resolve({ reports: [{ ...report, id: 302 }], total: 2 });
    await second;

    expect(component.reports.rows()[0]?.id).toBe(302);
    expect(component.reports.total()).toBe(2);
    expect(component.reports.loading()).toBeFalse();
  });
});
