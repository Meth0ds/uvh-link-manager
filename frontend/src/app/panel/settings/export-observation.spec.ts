import { TestBed, fakeAsync, flushMicrotasks, tick } from "@angular/core/testing";
import type { ComponentFixture } from "@angular/core/testing";
import { provideHttpClient, withInterceptors } from "@angular/common/http";
import { HttpTestingController, provideHttpClientTesting } from "@angular/common/http/testing";
import type { TestRequest } from "@angular/common/http/testing";
import { Router, ActivatedRoute } from "@angular/router";
import { Location } from "@angular/common";
import { MatSnackBar } from "@angular/material/snack-bar";
import { MatDialog } from "@angular/material/dialog";
import { Subject } from "rxjs";
import type { AuthUser, DataExportStatus } from "../../core/models";
import { AuthService } from "../../core/services/auth.service";
import { apiInterceptor } from "../../core/interceptors/api.interceptor";
import { ActionDialogService } from "../action-dialog.service";
import { SettingsComponent } from "./settings.component";
import { DataExportDialogComponent } from "./data-export-dialog.component";
import type { DataExportDialogResult } from "./data-export-dialog.component";

const endpoint = "/api/v1/auth/data-export";
const user = (id = 1): AuthUser => ({ id, email: `account${id}@example.test`, name: `Account ${id}`, isAdmin: false, emailVerified: true, mfaEnabled: false });
const exported = (status: DataExportStatus["status"]): DataExportStatus => ({ id: 1, status, failureReason: null, stage: status === "processing" ? "collecting" : null, downloadExpiresAt: status === "ready" ? "2099-10-04T00:00:00Z" : null, createdAt: "2026-10-04T00:00:00Z", readyAt: status === "ready" ? "2026-10-04T00:01:00Z" : null, downloadedAt: null });

describe("Export observation with real account transport", () => {
  let fixture: ComponentFixture<SettingsComponent>;
  let auth: AuthService;
  let http: HttpTestingController;
  let snack: jasmine.SpyObj<MatSnackBar>;
  let dialogs: jasmine.SpyObj<MatDialog>;
  beforeEach(() => {
    spyOnProperty(document, "cookie", "get").and.returnValue("uvh_csrf=fixture");
    spyOnProperty(document, "hidden", "get").and.returnValue(false);
    snack = jasmine.createSpyObj("MatSnackBar", ["open"]);
    dialogs = jasmine.createSpyObj("MatDialog", ["open"]);
    TestBed.configureTestingModule({ providers: [
      provideHttpClient(withInterceptors([apiInterceptor])), provideHttpClientTesting(),
      { provide: Router, useValue: { navigate: jasmine.createSpy().and.resolveTo(true), navigateByUrl: jasmine.createSpy().and.resolveTo(true) } },
      { provide: ActivatedRoute, useValue: { snapshot: { data: {} } } },
      { provide: Location, useValue: { replaceState: jasmine.createSpy() } },
      { provide: MatSnackBar, useValue: snack },
      { provide: ActionDialogService, useValue: { confirm: jasmine.createSpy().and.resolveTo(true) } },
    ] });
    TestBed.overrideComponent(SettingsComponent, { add: { providers: [{ provide: MatSnackBar, useValue: snack }, { provide: MatDialog, useValue: dialogs }] } });
    auth = TestBed.inject(AuthService); http = TestBed.inject(HttpTestingController);
  });
  afterEach(() => { fixture?.destroy(); http.verify(); });
  function sideReads(): void {
    http.expectOne("/api/v1/auth/sessions").flush({ sessions: [], truncated: false });
    http.expectOne("/api/v1/auth/data-export/history").flush({ exports: [] });
    http.expectOne("/api/v1/auth/account-deletion").flush({ canDelete: true, isPlatformAdmin: false, ownedWorkspaces: [], blockingPrivacyRequests: [], request: null });
    http.expectOne((r) => r.url === "/api/v1/auth/privacy-requests").flush({ requests: [], total: 0, page: 1, perPage: 5 });
    http.expectOne("/api/v1/notifications/preferences").flush({ preferences: [] });
  }
  function start(): TestRequest {
    auth.user.set(user()); auth.loaded.set(true);
    fixture = TestBed.createComponent(SettingsComponent); fixture.detectChanges();
    sideReads();
    return http.expectOne(endpoint);
  }
  function render(): HTMLElement { flushMicrotasks(); fixture.detectChanges(); return fixture.nativeElement.querySelector(".data-card") as HTMLElement; }
  function mount(status: DataExportStatus | null = null): SettingsComponent { start().flush({ export: status }); render(); snack.open.calls.reset(); return fixture.componentInstance; }
  function noCommands(): void { http.expectNone((r) => r.method === "POST"); }
  function fail(request: TestRequest, mode: "503" | "502" | "network"): void {
    if (mode === "network") request.error(new ProgressEvent("error"));
    else if (mode === "502") request.flush({ export: {} });
    else request.flush({ error: "Fixture temporarily unavailable" }, { status: 503, statusText: "Unavailable" });
  }
  for (const mode of ["503", "502", "network"] as const) {
    it(`does not present an initial ${mode} failure as an absent export`, fakeAsync(() => {
      fail(start(), mode);
      const card = render();
      expect(card.querySelector('.export-observation-error')).not.toBeNull();
      expect(card.textContent).not.toContain("Solicitar mi archivo");
      expect(card.textContent).toContain("Actualizar estado");
      expect(fixture.componentInstance.exportShowsRequestEntry()).toBeFalse();
      expect(fixture.componentInstance.exportLoading()).toBeFalse();
      noCommands(); fixture.destroy();
    }));
  }
  it("presents a request entry only after a validated absence response", fakeAsync(() => {
    mount();
    const card = render();
    expect(card.querySelector('.export-observation-error')).toBeNull();
    expect(card.textContent).toContain("Solicitar mi archivo");
    noCommands(); fixture.destroy();
  }));
  for (const status of ["processing", "ready"] as const) {
    for (const silent of [false, true]) {
      it(`keeps a known ${status} snapshot but marks a failed ${silent ? "silent" : "visible"} read as stale`, fakeAsync(() => {
        const snapshot = exported(status);
        const component = mount(snapshot);
        void component.loadExportStatus(false, silent);
        fail(http.expectOne(endpoint), "503");
        const card = render();
        expect(component.exportStatus()).toEqual(snapshot);
        expect(card.querySelector('.export-observation-error')).not.toBeNull();
        expect(card.textContent).toContain("último estado conocido");
        expect(card.textContent).not.toContain("Solicitar mi archivo");
        const commandButtons = [...card.querySelectorAll<HTMLButtonElement>('button')].filter((button) => /Descargar archivo|Cancelar exportación/.test(button.textContent ?? ""));
        expect(commandButtons.length).toBeGreaterThan(0);
        expect(commandButtons.every((button) => button.disabled)).toBeTrue();
        expect(snack.open).not.toHaveBeenCalled();
        noCommands(); fixture.destroy();
      }));
    }
  }
  it("recovers an absent export through GET without replaying a command", fakeAsync(() => {
    fail(start(), "503"); render();
    const component = fixture.componentInstance;
    void component.loadExportStatus(false);
    http.expectOne(endpoint).flush({ export: null });
    const card = render();
    expect(card.querySelector('.export-observation-error')).toBeNull();
    expect(card.textContent).toContain("Solicitar mi archivo");
    noCommands(); fixture.destroy();
  }));
  it("continues processing backoff after a silent error and recovers on the next valid observation", fakeAsync(() => {
    const component = mount(exported("processing"));
    tick(3_000); fail(http.expectOne(endpoint), "503"); render();
    expect(component.exportStatus()?.status).toBe("processing");
    expect(render().querySelector('.export-observation-error')).not.toBeNull();
    tick(4_999); http.expectNone(endpoint);
    tick(1); http.expectOne(endpoint).flush({ export: exported("downloaded") });
    render(); http.expectOne("/api/v1/auth/data-export/history").flush({ exports: [] }); render();
    expect(component.exportStatus()?.status).toBe("downloaded");
    expect(render().querySelector('.export-observation-error')).toBeNull();
    tick(120_000); http.expectNone(endpoint);
    expect(snack.open).not.toHaveBeenCalled(); noCommands(); fixture.destroy();
  }));
  it("preserves a confirmed cancellation when its observation fails", fakeAsync(() => {
    const component = mount(exported("processing"));
    void component.cancelDataExport(); flushMicrotasks();
    http.expectOne(endpoint + "/cancel").flush({ ok: true }); flushMicrotasks();
    fail(http.expectOne(endpoint), "503");
    http.expectOne("/api/v1/auth/data-export/history").flush({ exports: [] });
    const card = render();
    expect(snack.open.calls.allArgs().map((args) => args[0])).toContain("Exportación cancelada");
    expect(card.querySelector('.export-observation-error')).not.toBeNull();
    expect(card.textContent).not.toContain("Solicitar mi archivo");
    expect(component.exportBusy()).toBeFalse();
    noCommands(); fixture.destroy();
  }));
  for (const purpose of ["request", "download"] as const) {
    it(`keeps a confirmed ${purpose} dialog outcome separate from its failed observation`, fakeAsync(() => {
      const component = mount(purpose === "download" ? exported("ready") : null);
      const closed = new Subject<DataExportDialogResult>();
      dialogs.open.and.returnValue({ afterClosed: () => closed, close: jasmine.createSpy() } as never);
      component.openDataExportDialog(purpose);
      expect(dialogs.open).toHaveBeenCalledWith(DataExportDialogComponent, jasmine.objectContaining({ data: { purpose } }));
      closed.next(true); closed.complete(); flushMicrotasks();
      fail(http.expectOne(endpoint), "503");
      http.expectOne("/api/v1/auth/data-export/history").flush({ exports: [] });
      const card = render();
      expect(snack.open.calls.allArgs().map((args) => args[0])).toContain(purpose === "download" ? "Archivo descargado" : "Solicitud de exportación iniciada");
      expect(card.querySelector('.export-observation-error')).not.toBeNull();
      expect(card.textContent).not.toContain("Solicitar mi archivo");
      noCommands(); fixture.destroy();
    }));
  }
  for (const status of [null, exported("ready")]) {
    it(`recovers ${status ? "a ready snapshot" : "absence"} through the visible retry and transfers focus`, fakeAsync(() => {
      fail(start(), "503"); const card = render();
      const retry = card.querySelector<HTMLButtonElement>('.export-retry')!;
      retry.focus(); retry.click(); render();
      const read = http.expectOne(endpoint);
      expect(read.request.method).toBe("GET");
      expect(fixture.componentInstance.exportRefreshing()).toBeTrue();
      expect(retry.getAttribute("aria-disabled")).toBe("true");
      expect(document.activeElement).toBe(retry);
      read.flush({ export: status }); render();
      if (status) { http.expectOne(endpoint + "/history").flush({ exports: [] }); render(); }
      expect(fixture.componentInstance.exportRefreshing()).toBeFalse();
      expect(render().querySelector('.export-observation-error')).toBeNull();
      expect(document.activeElement?.id).toBe("export-heading");
      noCommands(); fixture.destroy();
    }));
  }
  it("keeps focus and the notice on retry failure and suppresses repeated activation", fakeAsync(() => {
    fail(start(), "503"); const card = render();
    const component = fixture.componentInstance;
    const retry = card.querySelector<HTMLButtonElement>('.export-retry')!;
    retry.focus(); retry.click(); render();
    retry.click(); void component.retryExportStatus();
    const requests = http.match(endpoint);
    expect(requests.length).toBe(1);
    fail(requests[0], "network"); render();
    expect(document.activeElement).toBe(retry);
    expect(retry.getAttribute("aria-disabled")).toBeNull();
    expect(retry.textContent).toContain("Actualizar estado");
    expect(component.exportRefreshing()).toBeFalse();
    noCommands(); fixture.destroy();
  }));
  it("pauses processing polls and foreground probes while a manual read is pending", fakeAsync(() => {
    const component = mount(exported("processing"));
    void component.loadExportStatus(false, true); fail(http.expectOne(endpoint), "503"); render();
    void component.retryExportStatus(); const manual = http.expectOne(endpoint);
    window.dispatchEvent(new Event("focus"));
    document.dispatchEvent(new Event("visibilitychange"));
    // Hold below ApiService's 20s timeout: a timed-out manual read is no
    // longer pending and must allow polling to resume.
    tick(10_000); http.expectNone(endpoint);
    expect(manual.cancelled).toBeFalse();
    manual.flush({ export: exported("processing") }); render();
    tick(7_999); http.expectNone(endpoint);
    tick(1); http.expectOne(endpoint).flush({ export: exported("downloaded") }); render();
    http.expectOne(endpoint + "/history").flush({ exports: [] }); render();
    expect(component.exportError()).toBeNull(); noCommands(); fixture.destroy();
  }));
  it("does not let the old ready expiry timer cancel a manual recovery", fakeAsync(() => {
    const snapshot = { ...exported("ready"), downloadExpiresAt: new Date(Date.now() + 1_000).toISOString() };
    const component = mount(snapshot);
    void component.loadExportStatus(false, true); fail(http.expectOne(endpoint), "503"); render();
    void component.retryExportStatus(); const manual = http.expectOne(endpoint);
    tick(1_000);
    expect(manual.cancelled).toBeFalse();
    http.expectNone(endpoint);
    // Settle the current observation even on the pre-fix path, so this
    // control records timer cancellation rather than leftover HTTP artifacts.
    if (!manual.cancelled) manual.flush({ export: exported("expired") });
    for (const unexpected of http.match(endpoint)) unexpected.flush({ export: exported("expired") });
    render();
    for (const history of http.match(endpoint + "/history")) history.flush({ exports: [] });
    render(); noCommands(); fixture.destroy();
  }));
  it("aborts a pending recovery and discards its feedback when Settings is destroyed", fakeAsync(() => {
    fail(start(), "503"); render(); snack.open.calls.reset();
    const component = fixture.componentInstance;
    void component.retryExportStatus(); const read = http.expectOne(endpoint);
    fixture.destroy(); flushMicrotasks();
    expect(read.cancelled).toBeTrue();
    expect(component.exportError()).toBeNull();
    expect(component.exportRefreshing()).toBeFalse();
    expect(snack.open).not.toHaveBeenCalled(); noCommands();
  }));
  it("clears an outgoing notice and aborts its recovery before another account's data loads", fakeAsync(() => {
    fail(start(), "503"); render(); snack.open.calls.reset();
    const component = fixture.componentInstance;
    void component.retryExportStatus(); const old = http.expectOne(endpoint);
    auth.sessionExpired(); fixture.detectChanges();
    expect(old.cancelled).toBeTrue();
    expect(component.exportError()).toBeNull();
    expect(component.exportRefreshing()).toBeFalse();
    void auth.me();
    const identity = http.expectOne("/api/v1/auth/me");
    expect(identity.request.headers.has("X-Uvh-Account-Id")).toBeFalse();
    identity.flush({ user: user(2) }); flushMicrotasks();
    http.expectOne("/api/v1/workspaces").flush({ workspaces: [] }); fixture.detectChanges();
    sideReads(); http.expectOne(endpoint).flush({ export: { ...exported("cancelled"), id: 2 } }); render();
    expect(component.exportStatus()?.id).toBe(2);
    expect(component.exportError()).toBeNull();
    expect(component.exportRefreshing()).toBeFalse();
    expect(render().querySelector('.export-observation-error')).toBeNull();
    expect(snack.open).not.toHaveBeenCalled(); noCommands(); fixture.destroy();
  }));
  it("supersedes an older observation without letting cancellation overwrite valid absence", fakeAsync(() => {
    const component = mount();
    void component.loadExportStatus(false); const old = http.expectOne(endpoint);
    void component.loadExportStatus(false); const latest = http.expectOne(endpoint);
    expect(old.cancelled).toBeTrue();
    latest.flush({ export: null }); render();
    expect(component.exportError()).toBeNull();
    expect(component.exportLoading()).toBeFalse();
    expect(component.exportShowsRequestEntry()).toBeTrue();
    noCommands(); fixture.destroy();
  }));
  it("guards request, download and cancel handlers while the export state is unconfirmed", fakeAsync(() => {
    const component = mount(exported("ready"));
    void component.loadExportStatus(false); fail(http.expectOne(endpoint), "503"); render();
    component.openDataExportDialog(); component.openDataExportDialog("download");
    void component.cancelDataExport(); flushMicrotasks();
    expect(dialogs.open).not.toHaveBeenCalled();
    expect(TestBed.inject(ActionDialogService).confirm).not.toHaveBeenCalled();
    noCommands(); fixture.destroy();
  }));
  it("does not cancel after a pending confirmation outlives a failed state observation", fakeAsync(() => {
    const component = mount(exported("processing"));
    let answer!: (value: boolean) => void;
    (TestBed.inject(ActionDialogService).confirm as jasmine.Spy).and.returnValue(new Promise<boolean>((resolve) => { answer = resolve; }));
    void component.cancelDataExport();
    void component.loadExportStatus(false, true); fail(http.expectOne(endpoint), "503"); render();
    answer(true); flushMicrotasks();
    const commands = http.match((r) => r.method === "POST");
    expect(commands.length).toBe(0);
    for (const command of commands) command.flush({ error: "Fixture refusal" }, { status: 409, statusText: "Conflict" });
    render(); noCommands(); fixture.destroy();
  }));
  it("keeps a downloaded file's unconfirmed receipt outcome when its follow-up GET fails", fakeAsync(() => {
    const component = mount(exported("ready"));
    const closed = new Subject<DataExportDialogResult>();
    dialogs.open.and.returnValue({ afterClosed: () => closed, close: jasmine.createSpy() } as never);
    component.openDataExportDialog("download");
    closed.next("unconfirmed"); closed.complete(); flushMicrotasks();
    fail(http.expectOne(endpoint), "503");
    http.expectOne(endpoint + "/history").flush({ exports: [] }); render();
    expect(snack.open.calls.allArgs().map((args) => String(args[0])).some((message) => message.includes("No pudimos confirmar la recepción"))).toBeTrue();
    expect(render().querySelector('.export-observation-error')).not.toBeNull();
    noCommands(); fixture.destroy();
  }));


  it("does not publish a terminal export carrying live progress or enable commands", fakeAsync(() => {
    start().flush({ export: { ...exported("ready"), stage: "encrypting" } });
    const card = render();
    const component = fixture.componentInstance;
    expect(component.exportStatus()).toBeNull();
    expect(component.exportError()).not.toBeNull();
    expect(card.querySelector('.export-observation-error')).not.toBeNull();
    expect(card.textContent).not.toContain("Solicitar mi archivo");
    component.openDataExportDialog("download");
    expect(dialogs.open).not.toHaveBeenCalled();
    noCommands(); fixture.destroy();
  }));
  it("keeps the last ready snapshot when a live export carries an impossible failure reason", fakeAsync(() => {
    const snapshot = exported("ready");
    const component = mount(snapshot);
    void component.loadExportStatus(false, true);
    http.expectOne(endpoint).flush({ export: { ...exported("processing"), failureReason: "stalled" } });
    const card = render();
    expect(component.exportStatus()).toEqual(snapshot);
    expect(component.exportError()).not.toBeNull();
    expect(card.querySelector('.export-observation-error')).not.toBeNull();
    expect(snack.open).not.toHaveBeenCalled();
    noCommands(); fixture.destroy();
  }));
  it("recovers a contradictory status through one GET without repeating its operation", fakeAsync(() => {
    start().flush({ export: { ...exported("ready"), stage: "encoding" } }); render();
    const component = fixture.componentInstance;
    void component.retryExportStatus();
    http.expectOne(endpoint).flush({ export: { ...exported("processing"), stage: null } });
    render();
    for (const history of http.match(endpoint + "/history")) history.flush({ exports: [] });
    render();
    expect(component.exportStatus()?.status).toBe("processing");
    expect(component.exportStatus()?.stage).toBeNull();
    expect(component.exportError()).toBeNull();
    expect(component.exportRefreshing()).toBeFalse();
    expect(render().querySelector('.export-observation-error')).toBeNull();
    noCommands(); fixture.destroy();
  }));
  it("discards a decoded contradiction that settles after Settings is destroyed", fakeAsync(() => {
    const component = mount(exported("ready"));
    void component.loadExportStatus(false, true);
    http.expectOne(endpoint).flush({ export: { ...exported("processing"), failureReason: "stalled" } });
    fixture.destroy(); flushMicrotasks();
    expect(component.exportStatus()).toBeNull();
    expect(component.exportError()).toBeNull();
    expect(component.exportLoading()).toBeFalse();
    expect(snack.open).not.toHaveBeenCalled();
    noCommands();
  }));

});
