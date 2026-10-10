import { signal } from "@angular/core";
import { TestBed, type ComponentFixture } from "@angular/core/testing";
import { MatSnackBar } from "@angular/material/snack-bar";
import { ActivatedRoute, convertToParamMap, provideRouter, Router } from "@angular/router";
import { of, Subject } from "rxjs";
import { ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { PendingLinkIntentService, type ClaimedLinkIntent } from "../../core/services/pending-link-intent.service";
import { SessionContextService } from "../../core/services/session-context.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { LinkDto, Workspace } from "../../core/models";
import { LinkDialogService } from "./link-dialog.service";
import { LinksComponent } from "./links.component";

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
const drain = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe("Pending link editor context", () => {
  let fixture: ComponentFixture<LinksComponent>;
  let workspaces: WorkspaceService;
  let intents: jasmine.SpyObj<PendingLinkIntentService>;
  let dialogs: jasmine.SpyObj<LinkDialogService>;
  let snackbar: jasmine.SpyObj<MatSnackBar>;
  let claim: ReturnType<typeof deferred<ClaimedLinkIntent | null>>;
  let result: Subject<LinkDto | null>;
  let navigate: jasmine.Spy;
  let stored: string | null;
  const destination = "https://example.com/saved";

  beforeEach(async () => {
    stored = localStorage.getItem("uvh.workspaceId"); localStorage.removeItem("uvh.workspaceId");
    claim = deferred<ClaimedLinkIntent | null>(); result = new Subject();
    intents = jasmine.createSpyObj<PendingLinkIntentService>("intents", ["claim", "complete"], {
      pending: signal({ expiresAt: "2027-01-01T00:00:00Z" }),
    });
    intents.claim.and.returnValue(claim.promise); intents.complete.and.resolveTo();
    dialogs = jasmine.createSpyObj<LinkDialogService>("dialogs", ["openCreate"]);
    dialogs.openCreate.and.returnValue(result);
    snackbar = jasmine.createSpyObj<MatSnackBar>("snackbar", ["open"]);
    const api = jasmine.createSpyObj<ApiService>("api", ["get"]);
    api.get.and.callFake(((path: string) => Promise.resolve(path === "/api/v1/domains"
      ? { domains: [] } : { links: [], total: 0, page: 1, perPage: 20 })) as typeof api.get);
    await TestBed.configureTestingModule({ imports: [LinksComponent], providers: [
      provideRouter([]), WorkspaceService, SessionContextService,
      { provide: ActivatedRoute, useValue: { snapshot: { queryParamMap: convertToParamMap({}) }, queryParamMap: of(convertToParamMap({})) } },
      { provide: ApiService, useValue: api }, { provide: PendingLinkIntentService, useValue: intents },
      { provide: AuthService, useFactory: () => {
        const session = TestBed.inject(SessionContextService);
        return { sessionGeneration: session.generation };
      } },
      { provide: LinkDialogService, useValue: dialogs }, { provide: MatSnackBar, useValue: snackbar },
    ] }).overrideComponent(LinksComponent, { set: { template: "", imports: [] } }).compileComponents();
    workspaces = TestBed.inject(WorkspaceService);
    workspaces.setList([{ id: 1, role: "owner" }, { id: 2, role: "owner" }] as Workspace[]);
    navigate = spyOn(TestBed.inject(Router), "navigate").and.resolveTo(true);
    fixture = TestBed.createComponent(LinksComponent); fixture.detectChanges(); await drain();
    expect(intents.claim).toHaveBeenCalledTimes(1);
  });
  afterEach(() => {
    fixture.destroy(); TestBed.resetTestingModule();
    if (stored === null) localStorage.removeItem("uvh.workspaceId"); else localStorage.setItem("uvh.workspaceId", stored);
  });
  for (const transition of ["A-B-A", "session", "destroy"] as const) {
    for (const outcome of ["resolve", "reject"] as const) {
      it(`does not open or report an old claim ${outcome} after ${transition}`, async () => {
        if (transition === "A-B-A") { workspaces.select(2); workspaces.select(1); }
        if (transition === "session") TestBed.inject(SessionContextService).advance();
        if (transition === "destroy") fixture.destroy();
        if (outcome === "resolve") claim.resolve({ destination, expiresAt: "2027-01-01T00:00:00Z" });
        else claim.reject(new Error("old claim failed"));
        await drain();
        expect(dialogs.openCreate).not.toHaveBeenCalled();
        expect(snackbar.open).not.toHaveBeenCalled();
        expect(intents.complete).not.toHaveBeenCalled();
      });
    }
  }
  it("passes the pending destination and view owner, preserves intent on cancel and allows resume", async () => {
    claim.resolve({ destination, expiresAt: "2027-01-01T00:00:00Z" }); await drain();
    const args = dialogs.openCreate.calls.mostRecent().args;
    expect(args[0]).toBe(destination);
    expect(args[1]).toBeDefined();
    expect(args[1]?.destroyed).toBeFalse();
    const destroyed = jasmine.createSpy("ownerDestroyed");
    args[1]?.onDestroy(destroyed);
    result.next(null); result.complete();
    expect(intents.complete).not.toHaveBeenCalled();
    result = new Subject(); dialogs.openCreate.and.returnValue(result);
    fixture.componentInstance.resumePendingLink(); await drain();
    expect(dialogs.openCreate).toHaveBeenCalledTimes(2);
    result.next({ id: 42 } as LinkDto); result.complete();
    expect(intents.complete).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledOnceWith(["/app/links", 42]);
    fixture.destroy();
    expect(destroyed).toHaveBeenCalledTimes(1);
    expect(args[1]?.destroyed).toBeTrue();
  });
  it("does not consume or navigate for an old dialog result", async () => {
    claim.resolve({ destination, expiresAt: "2027-01-01T00:00:00Z" }); await drain();
    TestBed.inject(SessionContextService).advance();
    result.next({ id: 42 } as LinkDto); result.complete();
    expect(intents.complete).not.toHaveBeenCalled();
    expect(navigate).not.toHaveBeenCalled();
  });
});
