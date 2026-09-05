import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { MatSnackBar } from "@angular/material/snack-bar";
import { AdminComponent } from "./admin.component";
import { ApiService } from "../../core/services/api.service";
import { ActionDialogService } from "../action-dialog.service";
import type { AdminOperations, AdminOverview, AdminReport } from "../../core/models";

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
    expect(api.get).toHaveBeenCalledWith("/api/v1/admin/users", jasmine.objectContaining({ page: 1, perPage: 25 }));
    expect(api.get).toHaveBeenCalledWith("/api/v1/admin/audit", jasmine.objectContaining({ page: 1, perPage: 50 }));
  });

  it("resets pagination when applying a user filter", async () => {
    component.usersPage.set(3);
    api.get.calls.reset();

    component.filterUsers("blocked");
    await fixture.whenStable();

    expect(component.usersPage()).toBe(0);
    expect(api.get).toHaveBeenCalledWith("/api/v1/admin/users", jasmine.objectContaining({ status: "blocked", page: 1 }));
  });

  it("keeps every administration tab named for assistive technology", () => {
    fixture.detectChanges();
    const tabs = Array.from(fixture.nativeElement.querySelectorAll('[role="tab"]')) as HTMLElement[];

    expect(tabs.map((tab) => tab.getAttribute("aria-label"))).toEqual([
      "Usuarios",
      "Moderación",
      "Dominios",
      "Auditoría",
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
});
