import { type Type } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { provideNoopAnimations } from "@angular/platform-browser/animations";
import { MatSnackBar } from "@angular/material/snack-bar";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { SessionContextService } from "../../core/services/session-context.service";
import type { AdminAppeal, AdminDestinationEntry, AdminMailOutboxMessage, AdminOperations, AdminOverview, AdminReport, AdminUser, PrivacyRightRequest } from "../../core/models";
import { ActionDialogService } from "../action-dialog.service";
import { AdminComponent } from "./admin.component";
import { AdminReportsComponent } from "./admin-reports.component";
import { AdminAppealsComponent } from "./admin-appeals.component";
import { AdminDestinationsComponent } from "./admin-destinations.component";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
const stamp = "2026-10-07T12:00:00Z";
const overview: AdminOverview = { users: 8, workspaces: 5, links: 21, clicks: 144, openReports: 1, blockedLinks: 2, domains: 3 };
const operations: AdminOperations = {
  state: "healthy", environment: "production", generatedAt: stamp, checks: [],
  metrics: { pendingJobs: 0, oldestJobAgeSeconds: null, failedJobs: 0, webhookDeliveries: {}, oldestPendingWebhookAgeSeconds: null,
    mailOutbox: {}, oldestPendingMailAgeSeconds: null, activeSessions: 2, pendingRegistrations: 0, domains: {}, oldestDnsCheckAgeSeconds: null,
    oldestTlsProvisioningAgeSeconds: null, events60m: {}, queueHeartbeatAgeSeconds: 10, schedulerHeartbeatAgeSeconds: 20, activePrivacyRequests: 0, overduePrivacyRequests: 0 },
};
const user: AdminUser = { id: 11, name: "Ana", email: "ana@example.test", is_admin: false, email_verified_at: stamp, mfa_enabled: true, created_at: stamp, deleted_at: null, workspaces: 1, links: 2 };
const report: AdminReport = { id: 7, link_id: 12, reporter_email: "reporter@example.test", reason: "Phishing", details: null, status: "open", created_at: stamp, alias: "campaign", destination: "https://example.test", link_state: "active", workspace_id: 4 };
const appeal: AdminAppeal = { id: 3, message: "Destino legítimo", status: "open", created_at: stamp, decided_at: null, decision_note: null, alias: "campaign", destination: "https://example.test", link_state: "blocked", workspace_id: 4 };
const entry: AdminDestinationEntry = { id: 3, match_kind: "host", match_value: "example.test", reason: "Phishing", source: "manual", expires_at: null, created_at: stamp };
const mail: AdminMailOutboxMessage = { id: 5, kind: "account_verification", resourceType: "pending_registration", status: "failed", attempts: 3, manualRetryCount: 0, retryable: true, availableAt: stamp, queuedAt: null, lockedAt: null, sentAt: null, failedAt: stamp, lastManualRetryAt: null, lastError: "Fallo ficticio", createdAt: stamp, updatedAt: stamp };
const page = <T>(field: string, rows: T[], perPage = 25) => ({ [field]: rows, total: rows.length, page: 1, perPage });
async function setup<T>(componentType: Type<T>) {
  const api = jasmine.createSpyObj<ApiService>("api", ["get", "post", "patch", "delete"]);
  api.get.and.callFake(<R>(path: string) => Promise.resolve((path.endsWith("/overview") ? overview : path.endsWith("/operations") ? operations :
    path.endsWith("/users") ? page("users", [user]) : path.endsWith("/reports") ? page("reports", [report]) : path.endsWith("/appeals") ? page("appeals", [appeal]) :
    path.endsWith("/destinations") ? page("entries", [entry]) : path.endsWith("/pending-registrations") ? page("registrations", []) :
    path.endsWith("/account-recoveries") ? page("recoveries", []) : path.endsWith("/mail-outbox") ? page("messages", [mail]) :
    path.endsWith("/privacy-requests") ? page("requests", [], 20) : page("events", [], 50)) as R));
  api.post.and.resolveTo({ ok: true, linksScheduled: 2, linksSweepTruncated: false }); api.patch.and.resolveTo({ ok: true }); api.delete.and.resolveTo({ releasedLinks: 2 });
  const actions = jasmine.createSpyObj<ActionDialogService>("actions", ["confirm", "prompt"]); actions.confirm.and.resolveTo(true); actions.prompt.and.resolveTo("Motivo verificado");
  const snack = jasmine.createSpyObj<MatSnackBar>("snack", ["open"]);
  await TestBed.configureTestingModule({ imports: [componentType], providers: [provideNoopAnimations(),
    { provide: ApiService, useValue: api }, { provide: ActionDialogService, useValue: actions },
  ] }).overrideProvider(MatSnackBar, { useValue: snack }).compileComponents();
  const session = TestBed.inject(SessionContextService);
  session.user.set({ id: 1, name: "Operador", email: "operator@example.test", isAdmin: true, emailVerified: true, mfaEnabled: true });
  const fixture = TestBed.createComponent(componentType); fixture.detectChanges(); await fixture.whenStable(); fixture.detectChanges();
  expect(fixture.debugElement.injector.get(MatSnackBar)).toBe(snack);
  api.get.calls.reset();
  return { fixture, component: fixture.componentInstance, api, actions, snack, session };
}

describe("Administration actual UI and context", () => {
  let state: Awaited<ReturnType<typeof setup<AdminComponent>>>;
  beforeEach(async () => { state = await setup(AdminComponent); });
  afterEach(() => state.fixture.destroy());
  it("disarms a confirmation when MFA is removed without changing the user id", async () => {
    const confirmation = deferred<boolean>(); state.actions.confirm.and.returnValue(confirmation.promise);
    const pending = state.component.toggleAdmin(user); state.session.user.update(value => value ? { ...value, mfaEnabled: false } : null);
    confirmation.resolve(true); await pending; expect(state.api.patch).not.toHaveBeenCalled();
  });
  it("does not send commands or re-read queues after the mounted account loses admin access", async () => {
    state.session.user.update(value => value ? { ...value, isAdmin: false } : null);
    state.fixture.detectChanges(); await state.fixture.whenStable();
    await state.component.toggleBlock(user); await state.component.users.load();
    expect(state.api.patch).not.toHaveBeenCalled(); expect(state.api.get).not.toHaveBeenCalled();
    expect(state.component.users.rows()).toEqual([]);
  });
  it("does not dispatch a privacy response from another session", async () => {
    const request: PrivacyRightRequest = { id: 4, type: "access", status: "submitted", identityVerifiedAt: stamp, acknowledgedAt: null,
      dueAt: stamp, extendedUntil: null, extensionReasonCode: null, completedAt: null, cancelledAt: null, createdAt: stamp, updatedAt: stamp, overdue: false, messages: [] };
    await state.component.privacy.load(); state.api.get.calls.reset();
    const prompt = deferred<string | null>(); state.actions.prompt.and.returnValue(prompt.promise);
    const pending = state.component.completePrivacy(request); expect(state.actions.prompt).toHaveBeenCalledTimes(1); state.session.advance(); prompt.resolve("Respuesta completa para el expediente"); await pending;
    expect(state.api.post).not.toHaveBeenCalled();
  });
  it("drops the operations snapshot when the session changes before effects run", async () => {
    const response = deferred<AdminOperations>(); state.api.get.and.returnValue(response.promise);
    const pending = state.component.loadOperations(); state.session.advance(); response.resolve({ ...operations, generatedAt: "2099-01-01T12:00:00Z" }); await pending;
    expect(state.component.operations()?.generatedAt).not.toBe("2099-01-01T12:00:00Z");
  });
  it("disarms user commands against a failed page even if called directly", async () => {
    state.component.users.error.set("No se pudo confirmar la página"); await state.component.toggleBlock(user);
    expect(state.actions.confirm).not.toHaveBeenCalled(); expect(state.api.patch).not.toHaveBeenCalled();
  });
  it("does not describe an unconfirmed page with an old count and pager", async () => {
    const response = deferred<unknown>(); state.api.get.and.returnValue(response.promise);
    const pending = state.component.users.load(); state.fixture.detectChanges();
    const element = state.fixture.nativeElement as HTMLElement;
    expect(element.querySelector('[queue-summary]')?.textContent).not.toContain("cuenta coincide");
    expect(element.querySelector("mat-paginator")).toBeNull();
    response.resolve(page("users", [user])); await pending;
  });
  it("still admits a confirmed mail retry and refreshes its affected views", async () => {
    await state.component.mail.load(); state.api.get.calls.reset();
    await state.component.retryMail(mail);
    expect(state.api.post).toHaveBeenCalledWith("/api/v1/admin/mail-outbox/5/retry", {});
    expect(state.snack.open).toHaveBeenCalledWith("Correo admitido de nuevo en la cola", "Cerrar", jasmine.anything());
    expect(state.api.get.calls.allArgs().map(args => args[0])).toEqual(jasmine.arrayContaining(["/api/v1/admin/mail-outbox", "/api/v1/admin/operations", "/api/v1/admin/audit"]));
    expect(state.component.actionKey()).toBeNull();
  });
  it("does not dispatch a confirmation after the session changes", async () => {
    const confirmation = deferred<boolean>(); state.actions.confirm.and.returnValue(confirmation.promise);
    const pending = state.component.toggleAdmin(user); state.session.advance(); confirmation.resolve(true); await pending;
    expect(state.api.patch).not.toHaveBeenCalled();
  });
  it("does not dispatch a confirmation from a destroyed console", async () => {
    const confirmation = deferred<boolean>(); state.actions.confirm.and.returnValue(confirmation.promise);
    const pending = state.component.toggleBlock(user); state.fixture.destroy(); confirmation.resolve(true); await pending;
    expect(state.api.patch).not.toHaveBeenCalled();
  });
  it("does not publish an old user change to a new session", async () => {
    const response = deferred<unknown>(); state.api.patch.and.returnValue(response.promise);
    const pending = state.component.toggleBlock(user); await Promise.resolve(); expect(state.api.patch).toHaveBeenCalledTimes(1);
    state.session.advance(); response.resolve({ ok: true }); await pending;
    expect(state.snack.open).not.toHaveBeenCalled(); expect(state.api.get).not.toHaveBeenCalled();
  });
  it("rechecks exclusion after the mail retry confirmation", async () => {
    await state.component.mail.load(); state.api.get.calls.reset();
    const confirmation = deferred<boolean>(); state.actions.confirm.and.returnValue(confirmation.promise);
    const retry = state.component.retryMail(mail); expect(state.actions.confirm).toHaveBeenCalledTimes(1);
    state.actions.confirm.and.resolveTo(true); const response = deferred<unknown>(); state.api.patch.and.returnValue(response.promise);
    const block = state.component.toggleBlock(user); await Promise.resolve(); expect(state.api.patch).toHaveBeenCalledTimes(1);
    confirmation.resolve(true); await retry; expect(state.api.post).not.toHaveBeenCalled();
    response.resolve({ ok: true }); await block;
  });
  it("drops an overview response when the session changes before an effect runs", async () => {
    const response = deferred<AdminOverview>(); state.api.get.and.returnValue(response.promise);
    const read = state.component.loadOverview(); state.session.advance(); response.resolve({ ...overview, users: 999 }); await read;
    expect(state.component.overview()?.users).not.toBe(999);
  });
  it("drops a user page when the session changes before another read starts", async () => {
    const response = deferred<unknown>(); state.api.get.and.returnValue(response.promise);
    const read = state.component.users.load(); state.session.advance(); response.resolve(page("users", [{ ...user, id: 999 }])); await read;
    expect(state.component.users.rows()[0]?.id).not.toBe(999);
  });
  it("allows a new session operation and does not release it from an old finally", async () => {
    const first = deferred<unknown>(), second = deferred<unknown>(); state.api.patch.and.returnValues(first.promise, second.promise);
    const old = state.component.toggleBlock(user); await Promise.resolve();
    state.session.advance(); state.fixture.detectChanges(); await state.fixture.whenStable();
    expect(state.component.actionKey()).toBeNull();
    const current = state.component.toggleAdmin({ ...user, id: 12 }); await Promise.resolve();
    expect(state.api.patch).toHaveBeenCalledTimes(2);
    first.resolve({ ok: true }); await old; expect(state.component.actionKey()).not.toBeNull();
    second.resolve({ ok: true }); await current; expect(state.component.actionKey()).toBeNull();
  });
  it("keeps the console available when only the overview fails", async () => {
    state.component.overview.set(null); state.api.get.and.rejectWith(new ApiRequestError("Resumen no disponible", 503));
    await state.component.loadOverview(); state.fixture.detectChanges();
    expect(state.fixture.nativeElement.querySelector('[role="tab"]')).not.toBeNull();
  });
  it("does not invent zero failed jobs when operations have never loaded", () => {
    state.component.operations.set(null); state.component.operationsError.set("Lectura no disponible"); state.fixture.detectChanges();
    const strip = state.fixture.nativeElement.querySelector(".command-strip");
    expect(strip.textContent).not.toContain("0 trabajos fallidos");
    expect(strip.textContent).toContain("Sin confirmar");
  });
  it("does not show a healthy current state after an operations refresh failed", async () => {
    state.api.get.and.rejectWith(new ApiRequestError("Lectura no disponible", 503)); await state.component.loadOperations(); state.fixture.detectChanges();
    expect(state.fixture.nativeElement.querySelector(".command-state.state-healthy")).toBeNull();
    expect(state.fixture.nativeElement.querySelector(".command-strip").textContent).toContain("Sin confirmar");
  });
  it("names missing worker and scheduler pulses as missing signals", async () => {
    state.component.operations.set({ ...operations, metrics: { ...operations.metrics, queueHeartbeatAgeSeconds: null, schedulerHeartbeatAgeSeconds: null } });
    const tabs = state.fixture.nativeElement.querySelectorAll('[role="tab"]'); (tabs[7] as HTMLElement).click();
    state.fixture.detectChanges(); await state.fixture.whenStable(); state.fixture.detectChanges();
    await state.fixture.whenStable(); state.fixture.detectChanges();
    const cells = [...state.fixture.nativeElement.querySelectorAll(".system-overview > div")] as HTMLElement[];
    expect(state.component.activeTab()).withContext(state.fixture.nativeElement.textContent).toBe(7);
    for (const label of ["Worker", "Scheduler"]) expect(cells.find(c => c.textContent?.includes(label))?.textContent).withContext(state.fixture.nativeElement.textContent).toContain("Sin señal");
  });
});

for (const test of [
  { name: "reports", type: AdminReportsComponent, decide: (c: AdminReportsComponent) => c.dismiss(report), queue: (c: AdminReportsComponent) => c.reports, verb: "post" },
  { name: "appeals", type: AdminAppealsComponent, decide: (c: AdminAppealsComponent) => c.resolve(appeal, "restore"), queue: (c: AdminAppealsComponent) => c.appeals, verb: "post" },
  { name: "destinations", type: AdminDestinationsComponent, decide: (c: AdminDestinationsComponent) => c.withdraw(entry), queue: (c: AdminDestinationsComponent) => c.entries, verb: "delete" },
] as const) {
  describe("Moderation context: " + test.name, () => {
    let state: Awaited<ReturnType<typeof setup<AdminReportsComponent | AdminAppealsComponent | AdminDestinationsComponent>>>;
    const decide = () => test.decide(state.component as never);
    beforeEach(async () => { state = await setup(test.type as Type<AdminReportsComponent | AdminAppealsComponent | AdminDestinationsComponent>); });
    afterEach(() => state.fixture.destroy());
    it("does not dispatch after a session changed while confirming", async () => {
      const confirmation = deferred<boolean>(), prompt = deferred<string | null>(); state.actions.confirm.and.returnValue(confirmation.promise); state.actions.prompt.and.returnValue(prompt.promise);
      const pending = decide(); state.session.advance(); confirmation.resolve(true); prompt.resolve("Motivo verificado"); await pending;
      expect(state.api[test.verb]).not.toHaveBeenCalled();
    });
    it("does not dispatch after the view was destroyed while confirming", async () => {
      const confirmation = deferred<boolean>(), prompt = deferred<string | null>(); state.actions.confirm.and.returnValue(confirmation.promise); state.actions.prompt.and.returnValue(prompt.promise);
      const pending = decide(); state.fixture.destroy(); confirmation.resolve(true); prompt.resolve("Motivo verificado"); await pending;
      expect(state.api[test.verb]).not.toHaveBeenCalled();
    });
    it("does not emit or show success from a destroyed view", async () => {
      const response = deferred<unknown>(); state.api[test.verb].and.returnValue(response.promise);
      const changed = spyOn(state.component.changed, "emit"); const pending = decide(); await Promise.resolve();
      expect(state.api[test.verb]).toHaveBeenCalledTimes(1); state.fixture.destroy(); response.resolve({ ok: true, releasedLinks: 2 }); await pending;
      expect(changed).not.toHaveBeenCalled(); expect(state.snack.open).not.toHaveBeenCalled();
    });
    it("does not publish or release a newer decision from a prior session", async () => {
      const first = deferred<unknown>(), second = deferred<unknown>(); state.api[test.verb].and.returnValues(first.promise, second.promise);
      const changed = spyOn(state.component.changed, "emit"); const old = decide(); await Promise.resolve();
      expect(state.api[test.verb]).toHaveBeenCalledTimes(1);
      state.session.advance(); state.fixture.detectChanges(); await state.fixture.whenStable();
      const current = decide(); await Promise.resolve(); expect(state.api[test.verb]).toHaveBeenCalledTimes(2);
      first.resolve({ ok: true, releasedLinks: 2 }); await old;
      expect(state.component.busy()).toBeTrue(); expect(changed).not.toHaveBeenCalled(); expect(state.snack.open).not.toHaveBeenCalled();
      second.resolve({ ok: true, releasedLinks: 2 }); await current;
      expect(state.component.busy()).toBeFalse(); expect(changed).toHaveBeenCalledTimes(1); expect(state.snack.open).toHaveBeenCalledTimes(1);
    });
    it("does not publish a session-superseded page before an effect runs", async () => {
      const response = deferred<unknown>(); state.api.get.and.returnValue(response.promise);
      const queue = test.queue(state.component as never); const pending = queue.load(); state.session.advance();
      response.resolve(page(test.name === "destinations" ? "entries" : test.name, [{ ...(test.name === "reports" ? report : test.name === "appeals" ? appeal : entry), id: 999 }])); await pending;
      expect(queue.rows()[0]?.id).not.toBe(999);
    });
  });
}

describe("Queue live filter identity through the actual reports component", () => {
  let state: Awaited<ReturnType<typeof setup<AdminReportsComponent>>>;
  beforeEach(async () => { state = await setup(AdminReportsComponent); }); afterEach(() => state.fixture.destroy());
  it("does not publish a response for a filter that changed without starting another request", async () => {
    const response = deferred<unknown>(); state.api.get.and.returnValue(response.promise);
    const read = state.component.reports.load(); state.component.query.set("another-query"); response.resolve(page("reports", [{ ...report, id: 999 }])); await read;
    expect(state.component.reports.rows()[0]?.id).not.toBe(999);
  });
});
