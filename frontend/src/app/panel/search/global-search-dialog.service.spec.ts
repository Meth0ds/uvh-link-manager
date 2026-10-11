import { DestroyRef, signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { MatDialog } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import { Router } from "@angular/router";
import { BreakpointObserver } from "@angular/cdk/layout";
import { of, Subject } from "rxjs";
import { GlobalSearchDialogService } from "./global-search-dialog.service";
import { GlobalSearchService } from "../../core/services/global-search.service";
import { ApiService } from "../../core/services/api.service";
import { LinkDialogService } from "../links/link-dialog.service";
import type { SearchSelection } from "./global-search-dialog.component";

describe("Global search dialog action safety", () => {
  let service: GlobalSearchDialogService, owner: DestroyRef;
  let context: ReturnType<typeof signal<string>>, closed: Subject<SearchSelection | undefined>;
  let open: jasmine.Spy, get: jasmine.Spy, navigate: jasmine.Spy, navigateByUrl: jasmine.Spy;
  let openDialogs: unknown[];
  beforeEach(() => {
    context = signal("workspace-a"); closed = new Subject<SearchSelection | undefined>(); openDialogs = [];
    open = jasmine.createSpy("open").and.returnValue({ updateSize: jasmine.createSpy("updateSize"), updatePosition: jasmine.createSpy("updatePosition"), backdropClick: () => new Subject(), afterClosed: () => closed, close: () => closed.next(undefined) });
    get = jasmine.createSpy("get"); navigate = jasmine.createSpy("navigate").and.resolveTo(true); navigateByUrl = jasmine.createSpy("navigateByUrl").and.resolveTo(true);
    TestBed.configureTestingModule({ providers: [
      { provide: MatDialog, useValue: { open, openDialogs } }, { provide: MatSnackBar, useValue: { open: jasmine.createSpy("snackbar") } },
      { provide: Router, useValue: { navigate, navigateByUrl } }, { provide: ApiService, useValue: { get } },
      { provide: LinkDialogService, useValue: { openCreate: jasmine.createSpy("create").and.returnValue(of(null)) } },
      { provide: BreakpointObserver, useValue: { isMatched: () => false, observe: () => of({ matches: false }) } },
      { provide: GlobalSearchService, useValue: { context, canCreate: () => false, auth: { user: () => ({ emailVerified: true }) },
        navigation: () => [{ items: [{ path: "/app/links" }] }], workspaces: { currentId: () => 1, list: () => [{ id: 1 }], select: jasmine.createSpy("select") } } },
    ] });
    service = TestBed.inject(GlobalSearchDialogService); owner = TestBed.inject(DestroyRef);
  });
  it("opens one instance and does not open above an existing modal", async () => {
    await Promise.all([service.open(owner), service.open(owner)]); expect(open).toHaveBeenCalledTimes(1);
    closed.next(undefined); openDialogs.push({}); await service.open(owner); expect(open).toHaveBeenCalledTimes(1);
  });
  it("rejects old selections, unauthorized creation and arbitrary navigation URLs", async () => {
    await service.open(owner); context.set("workspace-b");
    closed.next({ context: "workspace-a", action: { kind: "navigate", path: "/app/links" } });
    expect(navigateByUrl).not.toHaveBeenCalled();
    await service.open(owner); closed.next({ context: "workspace-b", action: { kind: "navigate", path: "https://evil.test/" } });
    expect(navigateByUrl).not.toHaveBeenCalled();
    await service.open(owner); closed.next({ context: "workspace-b", action: { kind: "create" } });
    expect(TestBed.inject(LinkDialogService).openCreate).not.toHaveBeenCalled();
  });
  it("revalidates a QR link and ignores a response after workspace changes", async () => {
    let resolve!: (value: unknown) => void; get.and.returnValue(new Promise(done => resolve = done));
    await service.open(owner); closed.next({ context: "workspace-a", action: { kind: "qr", id: 7 } });
    expect(get).toHaveBeenCalledWith("/api/v1/links/7", undefined, jasmine.any(Function), jasmine.objectContaining({ signal: jasmine.any(AbortSignal) }));
    context.set("workspace-b"); TestBed.tick();
    resolve({ link: { id: 7, shortUrl: "https://uvh.test/old" } }); await Promise.resolve(); await Promise.resolve();
    expect(open).toHaveBeenCalledTimes(1);
    expect((get.calls.mostRecent().args[3] as { signal: AbortSignal }).signal.aborted).toBeTrue();
  });
  it("cancels an earlier QR selection when a new search opens", async () => {
    let resolve!: (value: unknown) => void; get.and.returnValue(new Promise(done => resolve = done));
    await service.open(owner); closed.next({ context: "workspace-a", action: { kind: "qr", id: 7 } });
    const signal = (get.calls.mostRecent().args[3] as { signal: AbortSignal }).signal;
    expect(signal.aborted).toBeFalse();
    await service.open(owner); expect(signal.aborted).toBeTrue();
    resolve({ link: { id: 7, shortUrl: "https://uvh.test/old" } }); await Promise.resolve(); await Promise.resolve();
    expect(open).toHaveBeenCalledTimes(2);
  });
  it("keeps the mobile dialog above the keyboard and removes viewport listeners on close", async () => {
    const viewport = Object.assign(new EventTarget(), { height: 420, offsetTop: 0 });
    spyOnProperty(window, "visualViewport", "get").and.returnValue(viewport as unknown as VisualViewport);
    const breakpoint = TestBed.inject(BreakpointObserver);
    spyOn(breakpoint, "isMatched").and.callFake(query => query === "(max-width: 600px)");
    spyOn(breakpoint, "observe").and.returnValue(of({ matches: true, breakpoints: {} }));
    await service.open(owner);
    const ref = open.calls.mostRecent().returnValue as { updateSize: jasmine.Spy; updatePosition: jasmine.Spy };
    viewport.height = 360; viewport.offsetTop = 20; viewport.dispatchEvent(new Event("resize"));
    expect(ref.updateSize).toHaveBeenCalledWith("100vw", "360px");
    expect(ref.updatePosition).toHaveBeenCalledWith({ top: "20px", left: "0" });
    closed.next(undefined); const calls = ref.updateSize.calls.count(); viewport.dispatchEvent(new Event("resize"));
    expect(ref.updateSize.calls.count()).toBe(calls);
  });
});
