import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { ActivatedRoute, provideRouter, Router } from "@angular/router";
import { RouterTestingHarness } from "@angular/router/testing";
import { MatSnackBar } from "@angular/material/snack-bar";
import { skip, Subject } from "rxjs";
import type { AuthUser, LinkDto, Workspace } from "../../core/models";
import { ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { ActionDialogService } from "../action-dialog.service";
import { LinkDialogService } from "./link-dialog.service";
import { LinkDetailComponent } from "./link-detail.component";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}
function link(id: number): LinkDto {
  return {
    id, alias: `link-${id}`, destination: "https://example.test/target", fallbackDestination: null,
    state: "active", clickCount: 0, maxClicks: null, singleUse: false, usedAt: null, scheduledAt: null, expiresAt: null,
    notes: null, passwordProtected: false, utm: { source: null, medium: null, campaign: null, term: null, content: null },
    domainId: null, domain: null, collectionId: null, collection: null, tags: [],
    createdAt: "2026-10-10T10:00:00Z", updatedAt: "2026-10-10T10:00:00Z", version: 1, shortUrl: `https://uvh.test/link-${id}`,
  };
}
type Transition = "route" | "route ABA" | "workspace ABA" | "session" | "account" | "role" | "destroy";

describe("Link decision ownership", () => {
  let harness: RouterTestingHarness;
  let component: LinkDetailComponent;
  let api: jasmine.SpyObj<ApiService>;
  let actions: jasmine.SpyObj<ActionDialogService>;
  let snack: jasmine.SpyObj<MatSnackBar>;
  let editor: Subject<LinkDto | undefined>;
  const selected = signal<number | null>(1);
  const selectionGeneration = signal(0);
  const sessionGeneration = signal(0);
  const role = signal<Workspace["role"]>("owner");
  const identity = signal<AuthUser | null>(null);

  beforeEach(async () => {
    selected.set(1); selectionGeneration.set(0); sessionGeneration.set(0); role.set("owner");
    identity.set({ id: 10, name: "Ana", email: "ana@example.test", isAdmin: false, emailVerified: true, mfaEnabled: false });
    api = jasmine.createSpyObj<ApiService>("api", ["get", "post", "delete"]);
    api.get.and.callFake(<T>(path: string) => Promise.resolve((/\/links\/\d+$/.test(path)
      ? { link: link(Number(path.split("/").pop())), rules: [], appeal: null, blockReason: null }
      : path.endsWith("activity") ? { events: [], truncated: false } : null) as T));
    api.post.and.resolveTo({ ok: true }); api.delete.and.resolveTo({ ok: true });
    actions = jasmine.createSpyObj<ActionDialogService>("actions", ["confirm", "prompt"]);
    snack = jasmine.createSpyObj<MatSnackBar>("snack", ["open"]);
    editor = new Subject<LinkDto | undefined>();
    await TestBed.configureTestingModule({ providers: [
      provideRouter([{ path: "links/:id", component: LinkDetailComponent }, { path: "app/links", component: LinkDetailComponent }]),
      { provide: ApiService, useValue: api }, { provide: ActionDialogService, useValue: actions },
      { provide: MatSnackBar, useValue: snack },
      { provide: LinkDialogService, useValue: { openEdit: () => editor.asObservable() } },
      { provide: AuthService, useValue: { user: identity, sessionGeneration } },
      { provide: WorkspaceService, useValue: { currentId: selected, selectionGeneration, currentRole: role } },
    ] }).overrideComponent(LinkDetailComponent, { set: { template: "" } })
      .overrideProvider(MatSnackBar, { useValue: snack }).compileComponents();
    harness = await RouterTestingHarness.create();
    component = await harness.navigateByUrl("/links/1", LinkDetailComponent);
    await harness.fixture.whenStable();
    const resolvedSnack = harness.routeDebugElement!.injector.get(MatSnackBar);
    if (!jasmine.isSpy(resolvedSnack.open)) spyOn(resolvedSnack, "open").and.stub();
    snack = resolvedSnack as jasmine.SpyObj<MatSnackBar>;
    expect(component.link()?.id).toBe(1);
    api.get.calls.reset();
  });
  afterEach(() => { editor.complete(); harness.fixture.destroy(); });

  async function transition(change: Transition): Promise<void> {
    if (change === "route" || change === "route ABA") {
      expect(await harness.navigateByUrl("/links/2", LinkDetailComponent)).toBe(component);
      if (change === "route ABA") await harness.navigateByUrl("/links/1", LinkDetailComponent);
    } else if (change === "workspace ABA") {
      selected.set(2); selectionGeneration.update(value => value + 1);
      selected.set(1); selectionGeneration.update(value => value + 1);
    } else if (change === "session") sessionGeneration.update(value => value + 1);
    else if (change === "account") identity.set({ ...identity()!, id: 11 });
    else if (change === "role") role.set("viewer");
    else harness.fixture.destroy();
  }

  for (const action of ["delete", "appeal"] as const) {
    for (const change of ["route", "route ABA", "workspace ABA", "session", "account", "role", "destroy"] as const) {
      it(`does not dispatch a ${action} decision after ${change}`, async () => {
        const confirmation = deferred<boolean>(); const prompt = deferred<string | null>();
        actions.confirm.and.returnValue(confirmation.promise); actions.prompt.and.returnValue(prompt.promise);
        const pending = action === "delete" ? component.remove() : component.requestReview();
        if (action === "delete") expect(actions.confirm.calls.mostRecent().args[0].message).toContain("https://uvh.test/link-1");
        await transition(change);
        api.get.calls.reset(); confirmation.resolve(true); prompt.resolve("Revisar el enlace original"); await pending;
        expect(api.delete).not.toHaveBeenCalled(); expect(api.post).not.toHaveBeenCalled();
        expect(snack.open).not.toHaveBeenCalled();
      });
    }
    it(`dispatches an unchanged ${action} decision once to its captured link`, async () => {
      const navigation = spyOn(TestBed.inject(Router), "navigate").and.resolveTo(true);
      actions.confirm.and.resolveTo(true); actions.prompt.and.resolveTo("  Comentario  ");
      if (action === "delete") {
        await component.remove(); expect(api.delete).toHaveBeenCalledOnceWith("/api/v1/links/1");
        expect(navigation).toHaveBeenCalledOnceWith(["/app/links"]);
      } else {
        await component.requestReview(); expect(api.post).toHaveBeenCalledOnceWith("/api/v1/links/1/appeal", { message: "Comentario" });
      }
      expect(component.actionBusy()).toBeFalse(); expect(snack.open).toHaveBeenCalledTimes(1);
    });
  }

  for (const change of ["route", "destroy"] as const) {
    it(`ignores a submitted write's late completion after ${change}`, async () => {
      const response = deferred<{ ok: true }>(); api.post.and.returnValue(response.promise);
      const pending = component.setState("paused");
      expect(api.post).toHaveBeenCalledOnceWith("/api/v1/links/1/state", { state: "paused" });
      await transition(change); api.get.calls.reset(); response.resolve({ ok: true }); await pending;
      expect(snack.open).not.toHaveBeenCalled(); expect(api.get).not.toHaveBeenCalled();
      expect(component.actionBusy()).toBeFalse();
    });
  }

  it("does not reload a newer link from the editor's late result", async () => {
    component.edit(); await transition("route"); api.get.calls.reset();
    editor.next(link(1));
    expect(api.get).not.toHaveBeenCalled();
  });

  it("rejects a stale visible row before the new route's effect clears it", async () => {
    const route = harness.routeDebugElement!.injector.get(ActivatedRoute);
    let pending: Promise<void> | undefined;
    const listener = route.paramMap.pipe(skip(1)).subscribe(() => { pending = component.setState("paused"); });
    try {
      await harness.navigateByUrl("/links/2", LinkDetailComponent); await pending;
      expect(api.post).not.toHaveBeenCalled();
    } finally { listener.unsubscribe(); }
  });
});
