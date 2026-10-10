import { Component, DestroyRef, type Type } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { MatDialog } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import { NavigationStart, Router } from "@angular/router";
import { firstValueFrom, of, Subject } from "rxjs";
import type { LinkDto, Workspace } from "../../core/models";
import { SessionContextService } from "../../core/services/session-context.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { LinkDialogComponent } from "./link-dialog.component";
import { LINK_EDITOR_LOADER, LinkDialogService } from "./link-dialog.service";

@Component({ template: "" })
class EditorMarker {}
const editor = EditorMarker as unknown as Type<LinkDialogComponent>;
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function ownerRef() {
  const callbacks = new Set<() => void>();
  const owner = {
    destroyed: false,
    onDestroy(callback: () => void) { callbacks.add(callback); return () => { callbacks.delete(callback); }; },
  };
  return { owner: owner as DestroyRef, callbacks, destroy: () => {
    owner.destroyed = true;
    for (const callback of [...callbacks]) callback();
  } };
}
const drain = () => new Promise<void>(resolve => setTimeout(resolve, 0));

describe("LinkDialogService lazy editor ownership", () => {
  const link = { id: 42, alias: "operativa" } as LinkDto;
  let dialog: jasmine.SpyObj<MatDialog>;
  let snackbar: jasmine.SpyObj<MatSnackBar>;
  let loader: jasmine.Spy<() => Promise<Type<LinkDialogComponent>>>;
  let service: LinkDialogService;
  let workspaces: WorkspaceService;
  let navigation: Subject<NavigationStart>;
  let stored: string | null;
  let result: Subject<LinkDto | undefined>;
  let close: jasmine.Spy;

  beforeEach(() => {
    stored = localStorage.getItem("uvh.workspaceId");
    localStorage.removeItem("uvh.workspaceId");
    dialog = jasmine.createSpyObj<MatDialog>("MatDialog", ["open"]);
    snackbar = jasmine.createSpyObj<MatSnackBar>("MatSnackBar", ["open"]);
    loader = jasmine.createSpy("loadEditor").and.resolveTo(editor);
    navigation = new Subject();
    result = new Subject();
    close = jasmine.createSpy("close");
    dialog.open.and.returnValue({ afterClosed: () => result, close } as never);
    TestBed.configureTestingModule({ providers: [
      LinkDialogService, WorkspaceService, SessionContextService,
      { provide: MatDialog, useValue: dialog }, { provide: MatSnackBar, useValue: snackbar },
      { provide: Router, useValue: { events: navigation } },
      { provide: LINK_EDITOR_LOADER, useValue: loader },
    ] });
    workspaces = TestBed.inject(WorkspaceService);
    workspaces.setList([{ id: 1, role: "owner" }, { id: 2, role: "owner" }] as Workspace[]);
    service = TestBed.inject(LinkDialogService);
  });
  afterEach(() => {
    TestBed.resetTestingModule();
    if (stored === null) localStorage.removeItem("uvh.workspaceId");
    else localStorage.setItem("uvh.workspaceId", stored);
  });

  it("returns the created link itself so consumers can navigate with its id", async () => {
    dialog.open.and.returnValue({ afterClosed: () => of(link) } as never);
    const created = await firstValueFrom(service.openCreate("https://example.com"));
    expect(created).toBe(link);
    expect(created?.id).toBe(42);
    expect(dialog.open).toHaveBeenCalledOnceWith(editor, {
      data: { mode: "create", initialDestination: "https://example.com" },
      width: "1000px", height: "min(860px, calc(100dvh - 24px))",
      maxWidth: "calc(100vw - 24px)", maxHeight: "calc(100dvh - 24px)", disableClose: true, autoFocus: false,
    });
  });
  it("normalizes a cancelled dialog to null", async () => {
    dialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);
    await expectAsync(firstValueFrom(service.openCreate())).toBeResolvedTo(null);
  });
  it("does not load the editor before an opening is subscribed", async () => {
    const opening = service.openCreate();
    await drain();
    expect(loader).not.toHaveBeenCalled();
    expect(dialog.open).not.toHaveBeenCalled();
    const sub = opening.subscribe();
    await drain();
    expect(loader).toHaveBeenCalledTimes(1);
    sub.unsubscribe();
    expect(close).toHaveBeenCalledTimes(1);
  });
  it("preserves the edit DTO and default create destination across reopenings", async () => {
    dialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);
    await firstValueFrom(service.openEdit(link));
    expect(dialog.open.calls.mostRecent().args[1]?.data).toEqual({ mode: "edit", link });
    await firstValueFrom(service.openCreate());
    expect(dialog.open.calls.mostRecent().args[1]?.data).toEqual({ mode: "create", initialDestination: "" });
    expect(loader).toHaveBeenCalledTimes(1);
    expect(dialog.open).toHaveBeenCalledTimes(2);
  });
  it("shares only module loading between overlapping requests", async () => {
    const pending = deferred<Type<LinkDialogComponent>>();
    loader.and.returnValue(pending.promise);
    dialog.open.and.returnValue({ afterClosed: () => of(undefined) } as never);
    const create = firstValueFrom(service.openCreate("https://example.com"));
    const edit = firstValueFrom(service.openEdit(link));
    await drain();
    expect(loader).toHaveBeenCalledTimes(1);
    expect(dialog.open).not.toHaveBeenCalled();
    pending.resolve(editor);
    await Promise.all([create, edit]);
    expect(dialog.open).toHaveBeenCalledTimes(2);
    expect(dialog.open.calls.allArgs().map(args => args[1]?.data)).toEqual([
      { mode: "create", initialDestination: "https://example.com" }, { mode: "edit", link },
    ]);
  });

  for (const transition of ["workspace", "A-B-A", "session", "identity", "role", "navigation", "destroy"] as const) {
    for (const completion of ["resolve", "reject"] as const) {
      it(`does not open or report an old ${completion} after ${transition}`, async () => {
        const pending = deferred<Type<LinkDialogComponent>>();
        loader.and.returnValue(pending.promise);
        const lifetime = ownerRef();
        const opening = firstValueFrom(service.openCreate("", lifetime.owner));
        await drain();
        if (transition === "workspace") workspaces.select(2);
        if (transition === "A-B-A") { workspaces.select(2); workspaces.select(1); }
        if (transition === "session") TestBed.inject(SessionContextService).advance();
        if (transition === "identity") TestBed.inject(SessionContextService).user.set({ id: 99 } as never);
        if (transition === "role") workspaces.list.update(rows => rows.map(row => ({ ...row, role: "viewer" })));
        if (transition === "navigation") navigation.next(new NavigationStart(1, "/app/domains"));
        if (transition === "destroy") lifetime.destroy();
        // Completion is intentionally delivered before an effect flush.
        if (completion === "resolve") pending.resolve(editor);
        else pending.reject(new Error("old network failure"));
        await expectAsync(opening).toBeResolvedTo(null);
        await drain();
        expect(dialog.open).not.toHaveBeenCalled();
        expect(snackbar.open).not.toHaveBeenCalled();
        expect(lifetime.callbacks.size).toBe(0);
        expect(navigation.observed).toBeFalse();
      });
    }
  }
  it("cancels promptly on a reactive context transition even while the loader is unresolved", async () => {
    const pending = deferred<Type<LinkDialogComponent>>();
    loader.and.returnValue(pending.promise);
    const values: (LinkDto | null)[] = [];
    const sub = service.openCreate().subscribe(value => values.push(value));
    await drain();
    workspaces.select(2); workspaces.select(1);
    TestBed.tick();
    expect(values).toEqual([null]);
    expect(sub.closed).toBeTrue();
    pending.resolve(editor);
    await drain();
    expect(dialog.open).not.toHaveBeenCalled();
  });
  it("does not load for an already destroyed owner or a stale unsubscribed request", async () => {
    const lifetime = ownerRef(); lifetime.destroy();
    await expectAsync(firstValueFrom(service.openCreate("", lifetime.owner))).toBeResolvedTo(null);
    const stale = service.openCreate(); workspaces.select(2);
    await expectAsync(firstValueFrom(stale)).toBeResolvedTo(null);
    expect(loader).not.toHaveBeenCalled();
  });
  it("releases listeners when unsubscribed before loading finishes", async () => {
    const pending = deferred<Type<LinkDialogComponent>>();
    loader.and.returnValue(pending.promise);
    const lifetime = ownerRef();
    const next = jasmine.createSpy("next");
    const sub = service.openCreate("", lifetime.owner).subscribe(next);
    await drain(); sub.unsubscribe();
    expect(lifetime.callbacks.size).toBe(0);
    expect(navigation.observed).toBeFalse();
    pending.resolve(editor); await drain();
    expect(next).not.toHaveBeenCalled();
    expect(dialog.open).not.toHaveBeenCalled();
  });
  it("reports a current loading failure once and permits a fresh attempt", async () => {
    loader.and.rejectWith(new Error("chunk unavailable"));
    await expectAsync(firstValueFrom(service.openCreate())).toBeResolvedTo(null);
    expect(snackbar.open).toHaveBeenCalledOnceWith("No se pudo abrir el editor. Vuelve a intentarlo.", "Cerrar", { duration: 5000 });
    loader.and.resolveTo(editor);
    dialog.open.and.returnValue({ afterClosed: () => of(link) } as never);
    await expectAsync(firstValueFrom(service.openCreate())).toBeResolvedTo(link);
    expect(loader).toHaveBeenCalledTimes(2);
  });
  it("closes a live dialog and suppresses its later result when its owner is destroyed", async () => {
    const lifetime = ownerRef();
    const opening = firstValueFrom(service.openEdit(link, lifetime.owner));
    await drain();
    lifetime.destroy();
    await expectAsync(opening).toBeResolvedTo(null);
    result.next(link); result.complete();
    expect(close).toHaveBeenCalledTimes(1);
    expect(lifetime.callbacks.size).toBe(0);
  });
  it("discards a closed result if the session changes before reactive effects run", async () => {
    const opening = firstValueFrom(service.openEdit(link));
    await drain();
    TestBed.inject(SessionContextService).advance();
    result.next(link); result.complete();
    await expectAsync(opening).toBeResolvedTo(null);
  });
});
