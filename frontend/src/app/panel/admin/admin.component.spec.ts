import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { By } from "@angular/platform-browser";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { MatSnackBar } from "@angular/material/snack-bar";
import { AdminComponent } from "./admin.component";
import { AdminReportsComponent } from "./admin-reports.component";
import { ApiService } from "../../core/services/api.service";
import { ActionDialogService } from "../action-dialog.service";
import type { AdminOperations, AdminOverview } from "../../core/models";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((onResolve) => { resolve = onResolve; });
  return { promise, resolve };
}

const overview: AdminOverview = {
  users: 8,
  workspaces: 5,
  links: 21,
  clicks: 144,
  openReports: 1,
  blockedLinks: 2,
  domains: 3,
};

const operations: AdminOperations = {
  state: "healthy",
  environment: "production",
  generatedAt: "2026-08-30T12:00:00Z",
  checks: [{ key: "queue", label: "Cola persistente", status: "ok", detail: null }],
  metrics: {
    pendingJobs: 0,
    oldestJobAgeSeconds: null,
    failedJobs: 0,
    webhookDeliveries: { success: 4 },
    oldestPendingWebhookAgeSeconds: null,
    mailOutbox: { sent: 3 },
    oldestPendingMailAgeSeconds: null,
    activeSessions: 2,
    unverifiedUsers: 1,
    domains: { active: 3 },
    oldestDnsCheckAgeSeconds: null,
    oldestTlsProvisioningAgeSeconds: null,
    events60m: {},
    queueHeartbeatAgeSeconds: null,
    schedulerHeartbeatAgeSeconds: null,
    activePrivacyRequests: 0,
    overduePrivacyRequests: 0,
  },
};

describe("AdminComponent", () => {
  let fixture: ComponentFixture<AdminComponent>;
  let component: AdminComponent;
  let api: jasmine.SpyObj<ApiService>;
  let actions: jasmine.SpyObj<ActionDialogService>;

  beforeEach(async () => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["get", "post", "patch"]);
    api.get.and.callFake(<T>(path: string) => {
      if (path.endsWith("/overview")) return Promise.resolve(overview as T);
      if (path.endsWith("/operations")) return Promise.resolve(operations as T);
      if (path.endsWith("/users")) return Promise.resolve({ users: [], total: 0, page: 1, perPage: 25 } as T);
      if (path.endsWith("/domains")) return Promise.resolve({ domains: [], total: 0, page: 1, perPage: 25 } as T);
      return Promise.resolve({ events: [], total: 0, page: 1, perPage: 50 } as T);
    });
    api.post.and.resolveTo({ ok: true });
    api.patch.and.resolveTo({ ok: true });
    actions = jasmine.createSpyObj<ActionDialogService>("ActionDialogService", ["confirm", "prompt"]);
    actions.confirm.and.resolveTo(true);
    actions.prompt.and.resolveTo("Contenido fraudulento confirmado");

    await TestBed.configureTestingModule({
      imports: [AdminComponent],
      providers: [
        provideNoopAnimations(),
        { provide: ApiService, useValue: api },
        { provide: ActionDialogService, useValue: actions },
        { provide: MatSnackBar, useValue: { open: jasmine.createSpy("open") } },
      ],
    }).compileComponents();

    fixture = TestBed.createComponent(AdminComponent);
    component = fixture.componentInstance;
    fixture.detectChanges();
    await fixture.whenStable();
  });

  it("loads every operator data source using server pagination", () => {
    expect(component.overview()).toEqual(overview);
    expect(component.operations()).toEqual(operations);
    expect(api.get).toHaveBeenCalledWith("/api/v1/admin/users", jasmine.objectContaining({ page: 1, perPage: 25 }), jasmine.any(Function), jasmine.objectContaining({ signal: jasmine.any(AbortSignal) }));
    expect(api.get).toHaveBeenCalledWith("/api/v1/admin/audit", jasmine.objectContaining({ page: 1, perPage: 50 }), jasmine.any(Function), jasmine.objectContaining({ signal: jasmine.any(AbortSignal) }));
  });

  it("resets pagination when applying a user filter", async () => {
    component.users.page.set(3);
    api.get.calls.reset();

    component.filterUsers("blocked");
    await fixture.whenStable();

    expect(component.users.page()).toBe(0);
    expect(api.get).toHaveBeenCalledWith("/api/v1/admin/users", jasmine.objectContaining({ status: "blocked", page: 1 }), jasmine.any(Function), jasmine.objectContaining({ signal: jasmine.any(AbortSignal) }));
  });

  it("keeps every administration tab named for assistive technology", () => {
    fixture.detectChanges();
    const tabs = Array.from(fixture.nativeElement.querySelectorAll('[role="tab"]')) as HTMLElement[];

    expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "Usuarios",
      "Recuperación de cuentas",
      "Moderación",
      "Dominios",
      "Auditoría",
      "Privacidad",
      "Sistema",
    ]);
  });

  it("uses correct singular and plural labels for operational counts", () => {
    expect(component.countLabel(1, "denuncia abierta", "denuncias abiertas")).toBe("1 denuncia abierta");
    expect(component.countLabel(0, "trabajo fallido", "trabajos fallidos")).toBe("0 trabajos fallidos");
  });

  it("tells every moderation view to re-read when one of its queues decides something", async () => {
    spyOn(component, "loadOverview").and.resolveTo();
    spyOn(component, "loadOperations").and.resolveTo();
    spyOn(component.audit, "load").and.resolveTo();
    const revision = component.moderationRevision();

    component.onModerationChanged();
    await fixture.whenStable();

    // One revision is what the three queues of the tab listen to, so bumping it
    // is what makes them all re-read; the summary views are re-read too.
    expect(component.moderationRevision()).toBe(revision + 1);
    expect(component.loadOverview).toHaveBeenCalled();
    expect(component.audit.load).toHaveBeenCalled();
  });

  it("wires a queue's decisions back to the console", async () => {
    spyOn(component, "loadOverview").and.resolveTo();
    spyOn(component, "loadOperations").and.resolveTo();
    spyOn(component.audit, "load").and.resolveTo();
    // A tab's content exists once the tab is open, so the queues are reached the
    // way an operator reaches them.
    fixture.detectChanges();
    const tabs = (fixture.nativeElement as HTMLElement).querySelectorAll('[role="tab"]');
    (tabs[2] as HTMLElement).click();
    fixture.detectChanges();
    await fixture.whenStable();
    const queue = fixture.debugElement.query(By.directive(AdminReportsComponent))?.componentInstance as AdminReportsComponent | undefined;
    expect(queue).toBeDefined();
    const revision = component.moderationRevision();

    queue!.changed.emit();
    await fixture.whenStable();

    expect(component.moderationRevision()).toBe(revision + 1);
  });

  const latestListCases = [
    {
      name: "account recoveries",
      select: (value: string) => component.recoveryQuery.set(value),
      load: () => component.recoveries.load(),
      loading: () => component.recoveries.loading(),
      firstResponse: { recoveries: [{ id: 101 }], total: 1 },
      secondResponse: { recoveries: [{ id: 102 }], total: 2 },
      olderId: 101,
      newerId: 102,
      firstId: () => component.recoveries.rows()[0]?.id,
      total: () => component.recoveries.total(),
    },
    {
      name: "users",
      select: (value: string) => component.userQuery.set(value),
      load: () => component.users.load(),
      loading: () => component.users.loading(),
      firstResponse: { users: [{ id: 201 }], total: 1 },
      secondResponse: { users: [{ id: 202 }], total: 2 },
      olderId: 201,
      newerId: 202,
      firstId: () => component.users.rows()[0]?.id,
      total: () => component.users.total(),
    },
    {
      name: "domains",
      select: (value: string) => component.domainQuery.set(value),
      load: () => component.domains.load(),
      loading: () => component.domains.loading(),
      firstResponse: { domains: [{ id: 401 }], total: 1 },
      secondResponse: { domains: [{ id: 402 }], total: 2 },
      olderId: 401,
      newerId: 402,
      firstId: () => component.domains.rows()[0]?.id,
      total: () => component.domains.total(),
    },
    {
      name: "audit events",
      select: (value: string) => component.auditQuery.set(value),
      load: () => component.audit.load(),
      loading: () => component.audit.loading(),
      firstResponse: { events: [{ id: 501 }], total: 1 },
      secondResponse: { events: [{ id: 502 }], total: 2 },
      olderId: 501,
      newerId: 502,
      firstId: () => component.audit.rows()[0]?.id,
      total: () => component.audit.total(),
    },
    {
      name: "mail outbox",
      select: (value: string) => component.mailStatus.set(value === "older" ? "failed" : "sent"),
      load: () => component.mail.load(),
      loading: () => component.mail.loading(),
      firstResponse: { messages: [{ id: 601 }], total: 1 },
      secondResponse: { messages: [{ id: 602 }], total: 2 },
      olderId: 601,
      newerId: 602,
      firstId: () => component.mail.rows()[0]?.id,
      total: () => component.mail.total(),
    },
    {
      name: "privacy requests",
      select: (value: string) => component.privacyStatus.set(value === "older" ? "submitted" : "completed"),
      load: () => component.privacy.load(),
      loading: () => component.privacy.loading(),
      firstResponse: { requests: [{ id: 701 }], total: 1 },
      secondResponse: { requests: [{ id: 702 }], total: 2 },
      olderId: 701,
      newerId: 702,
      firstId: () => component.privacy.rows()[0]?.id,
      total: () => component.privacy.total(),
    },
  ];

  for (const testCase of latestListCases) {
    it(`keeps the newest ${testCase.name} page and loading state`, async () => {
      const older = deferred<unknown>();
      const newer = deferred<unknown>();
      api.get.and.returnValues(older.promise as never, newer.promise as never);
      testCase.select("older");
      const first = testCase.load();
      testCase.select("newer");
      const second = testCase.load();

      older.resolve(testCase.firstResponse);
      await first;
      expect(testCase.loading()).withContext(testCase.name).toBeTrue();
      expect(testCase.firstId()).withContext(testCase.name).not.toBe(testCase.olderId);

      newer.resolve(testCase.secondResponse);
      await second;

      expect(testCase.firstId()).withContext(testCase.name).toBe(testCase.newerId);
      expect(testCase.total()).withContext(testCase.name).toBe(2);
      expect(testCase.loading()).withContext(testCase.name).toBeFalse();
    });
  }

  it("keeps the newest overview and operations snapshots", async () => {
    const olderOverview = deferred<AdminOverview>();
    const newerOverview = deferred<AdminOverview>();
    api.get.and.returnValues(olderOverview.promise as never, newerOverview.promise as never);
    const firstOverview = component.loadOverview();
    const secondOverview = component.loadOverview();

    olderOverview.resolve({ ...overview, users: 80 });
    await firstOverview;
    expect(component.overview()?.users).not.toBe(80);
    newerOverview.resolve({ ...overview, users: 81 });
    await secondOverview;
    expect(component.overview()?.users).toBe(81);

    const olderOperations = deferred<AdminOperations>();
    const newerOperations = deferred<AdminOperations>();
    api.get.and.returnValues(olderOperations.promise as never, newerOperations.promise as never);
    const firstOperations = component.loadOperations();
    const secondOperations = component.loadOperations();

    olderOperations.resolve({ ...operations, generatedAt: "2026-09-05T10:00:00Z" });
    await firstOperations;
    expect(component.operations()?.generatedAt).not.toBe("2026-09-05T10:00:00Z");
    expect(component.operationsLoading()).toBeTrue();
    newerOperations.resolve({ ...operations, generatedAt: "2026-09-05T10:00:01Z" });
    await secondOperations;
    expect(component.operations()?.generatedAt).toBe("2026-09-05T10:00:01Z");
    expect(component.operationsLoading()).toBeFalse();
  });

  it("does not finish a newer full refresh when an older refresh completes", async () => {
    const older = deferred<void>();
    const newer = deferred<void>();
    spyOn(component, "loadOverview").and.returnValues(older.promise, newer.promise);
    spyOn(component, "loadOperations").and.resolveTo();
    spyOn(component.users, "load").and.resolveTo();
    spyOn(component.recoveries, "load").and.resolveTo();
    spyOn(component.domains, "load").and.resolveTo();
    spyOn(component.audit, "load").and.resolveTo();
    spyOn(component.mail, "load").and.resolveTo();
    spyOn(component.privacy, "load").and.resolveTo();

    const first = component.reloadAll();
    const second = component.reloadAll();
    older.resolve();
    await first;

    expect(component.refreshing()).toBeTrue();

    newer.resolve();
    await second;
    expect(component.refreshing()).toBeFalse();
  });

  it("does not update a destroyed administration view", async () => {
    const response = deferred<unknown>();
    api.get.and.returnValue(response.promise as never);
    component.userQuery.set("pending");
    const request = component.users.load();

    fixture.destroy();
    response.resolve({ users: [{ id: 999 }], total: 1 });
    await request;

    expect(component.users.rows()[0]?.id).not.toBe(999);
    expect(component.users.loading()).toBeTrue();
  });

  it("disarms a failed page instead of acting on the one it replaced", () => {
    component.users.rows.set([{
      id: 1,
      email: "operator@example.test",
      name: "Operator",
      is_admin: false,
      email_verified_at: "2026-09-05T10:00:00Z",
      mfa_enabled: true,
      created_at: "2026-09-05T10:00:00Z",
      deleted_at: null,
      workspaces: 1,
      links: 2,
    }]);
    component.users.total.set(1);
    component.users.error.set("No se pudieron cargar los usuarios");
    fixture.detectChanges();

    const element: HTMLElement = fixture.nativeElement;
    const buttons = Array.from(element.querySelectorAll("button")) as HTMLButtonElement[];
    const userButtons = buttons.filter((button) => ["Hacer admin", "Bloquear"].includes(button.textContent?.trim() ?? ""));
    expect(userButtons.length).toBe(2);
    expect(userButtons.every((button) => button.disabled)).toBeTrue();
    // Neither the count nor the pager may describe a page that never arrived.
    expect(element.querySelector("mat-paginator")).toBeNull();
    expect(element.textContent).not.toContain("cuentas coinciden con los filtros");
  });

  it("disables user actions while their rows may be stale", () => {
    component.users.rows.set([{
      id: 1,
      email: "operator@example.test",
      name: "Operator",
      is_admin: false,
      email_verified_at: "2026-09-05T10:00:00Z",
      mfa_enabled: true,
      created_at: "2026-09-05T10:00:00Z",
      deleted_at: null,
      workspaces: 1,
      links: 2,
    }]);
    component.users.loading.set(true);
    fixture.detectChanges();

    const buttons = Array.from(fixture.nativeElement.querySelectorAll("button")) as HTMLButtonElement[];
    const userButtons = buttons.filter((button) => ["Hacer admin", "Bloquear"].includes(button.textContent?.trim() ?? ""));
    expect(userButtons.length).toBe(2);
    expect(userButtons.every((button) => button.disabled)).toBeTrue();
  });
});
