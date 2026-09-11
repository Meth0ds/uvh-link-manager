import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { MatSnackBar } from "@angular/material/snack-bar";
import { AdminComponent } from "./admin.component";
import { ApiService } from "../../core/services/api.service";
import { ActionDialogService } from "../action-dialog.service";
import type { AdminOperations, AdminOverview, AdminReport } from "../../core/models";

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
      if (path.endsWith("/reports")) return Promise.resolve({ reports: [report], total: 1, page: 1, perPage: 25 } as T);
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
    expect(component.reports()).toEqual([report]);
    expect(api.get).toHaveBeenCalledWith("/api/v1/admin/users", jasmine.objectContaining({ page: 1, perPage: 25 }), jasmine.any(Function), jasmine.objectContaining({ signal: jasmine.any(AbortSignal) }));
    expect(api.get).toHaveBeenCalledWith("/api/v1/admin/audit", jasmine.objectContaining({ page: 1, perPage: 50 }), jasmine.any(Function), jasmine.objectContaining({ signal: jasmine.any(AbortSignal) }));
  });

  it("resets pagination when applying a user filter", async () => {
    component.usersPage.set(3);
    api.get.calls.reset();

    component.filterUsers("blocked");
    await fixture.whenStable();

    expect(component.usersPage()).toBe(0);
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

  it("blocks a reported link through the atomic moderation endpoint", async () => {
    api.post.calls.reset();

    await component.blockLink(report);

    expect(actions.prompt).toHaveBeenCalled();
    expect(api.post).toHaveBeenCalledWith("/api/v1/admin/reports/7/moderate", {
      action: "block",
      reason: "Contenido fraudulento confirmado",
    });
  });

  const latestListCases = [
    {
      name: "account recoveries",
      select: (value: string) => component.recoveryQuery.set(value),
      load: () => component.loadRecoveries(),
      loading: () => component.recoveriesLoading(),
      firstResponse: { recoveries: [{ id: 101 }], total: 1 },
      secondResponse: { recoveries: [{ id: 102 }], total: 2 },
      olderId: 101,
      newerId: 102,
      firstId: () => component.recoveries()[0]?.id,
      total: () => component.recoveriesTotal(),
    },
    {
      name: "users",
      select: (value: string) => component.userQuery.set(value),
      load: () => component.loadUsers(),
      loading: () => component.usersLoading(),
      firstResponse: { users: [{ id: 201 }], total: 1 },
      secondResponse: { users: [{ id: 202 }], total: 2 },
      olderId: 201,
      newerId: 202,
      firstId: () => component.users()[0]?.id,
      total: () => component.usersTotal(),
    },
    {
      name: "reports",
      select: (value: string) => component.reportQuery.set(value),
      load: () => component.loadReports(),
      loading: () => component.reportsLoading(),
      firstResponse: { reports: [{ ...report, id: 301 }], total: 1 },
      secondResponse: { reports: [{ ...report, id: 302 }], total: 2 },
      olderId: 301,
      newerId: 302,
      firstId: () => component.reports()[0]?.id,
      total: () => component.reportsTotal(),
    },
    {
      name: "domains",
      select: (value: string) => component.domainQuery.set(value),
      load: () => component.loadDomains(),
      loading: () => component.domainsLoading(),
      firstResponse: { domains: [{ id: 401 }], total: 1 },
      secondResponse: { domains: [{ id: 402 }], total: 2 },
      olderId: 401,
      newerId: 402,
      firstId: () => component.domains()[0]?.id,
      total: () => component.domainsTotal(),
    },
    {
      name: "audit events",
      select: (value: string) => component.auditQuery.set(value),
      load: () => component.loadAudit(),
      loading: () => component.auditLoading(),
      firstResponse: { events: [{ id: 501 }], total: 1 },
      secondResponse: { events: [{ id: 502 }], total: 2 },
      olderId: 501,
      newerId: 502,
      firstId: () => component.events()[0]?.id,
      total: () => component.auditTotal(),
    },
    {
      name: "mail outbox",
      select: (value: string) => component.mailStatus.set(value === "older" ? "failed" : "sent"),
      load: () => component.loadMailOutbox(),
      loading: () => component.mailLoading(),
      firstResponse: { messages: [{ id: 601 }], total: 1 },
      secondResponse: { messages: [{ id: 602 }], total: 2 },
      olderId: 601,
      newerId: 602,
      firstId: () => component.mailMessages()[0]?.id,
      total: () => component.mailTotal(),
    },
    {
      name: "privacy requests",
      select: (value: string) => component.privacyStatus.set(value === "older" ? "submitted" : "completed"),
      load: () => component.loadPrivacyRequests(),
      loading: () => component.privacyLoading(),
      firstResponse: { requests: [{ id: 701 }], total: 1 },
      secondResponse: { requests: [{ id: 702 }], total: 2 },
      olderId: 701,
      newerId: 702,
      firstId: () => component.privacyRequests()[0]?.id,
      total: () => component.privacyTotal(),
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
    spyOn(component, "loadUsers").and.resolveTo();
    spyOn(component, "loadRecoveries").and.resolveTo();
    spyOn(component, "loadReports").and.resolveTo();
    spyOn(component, "loadDomains").and.resolveTo();
    spyOn(component, "loadAudit").and.resolveTo();
    spyOn(component, "loadMailOutbox").and.resolveTo();
    spyOn(component, "loadPrivacyRequests").and.resolveTo();

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
    const request = component.loadUsers();

    fixture.destroy();
    response.resolve({ users: [{ id: 999 }], total: 1 });
    await request;

    expect(component.users()[0]?.id).not.toBe(999);
    expect(component.usersLoading()).toBeTrue();
  });

  it("disables user actions while their rows may be stale", () => {
    component.users.set([{
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
    component.usersLoading.set(true);
    fixture.detectChanges();

    const buttons = Array.from(fixture.nativeElement.querySelectorAll("button")) as HTMLButtonElement[];
    const userButtons = buttons.filter((button) => ["Hacer admin", "Bloquear"].includes(button.textContent?.trim() ?? ""));
    expect(userButtons.length).toBe(2);
    expect(userButtons.every((button) => button.disabled)).toBeTrue();
  });
});
