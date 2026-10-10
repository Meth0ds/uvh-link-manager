import { Location } from "@angular/common";
import { signal, type WritableSignal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute, Router } from "@angular/router";

import { ApiRequestError, ApiService } from "../core/services/api.service";
import { AuthService } from "../core/services/auth.service";
import { PendingInvitationService } from "../core/services/pending-invitation.service";
import { InvitationAcceptComponent } from "./invitation-accept.component";

interface Deferred<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((onResolve, onReject) => {
    resolve = onResolve;
    reject = onReject;
  });
  return { promise, resolve, reject };
}

/** Let the park confirmation and the session checks settle. */
const settle = (): Promise<void> => new Promise((resolve) => setTimeout(resolve, 0));

describe("InvitationAcceptComponent async safety", () => {
  const tokenA = "a".repeat(43);
  let fixture: ComponentFixture<InvitationAcceptComponent> | undefined;
  let component: InvitationAcceptComponent;
  let api: jasmine.SpyObj<ApiService>;
  let auth: jasmine.SpyObj<AuthService>;
  let router: jasmine.SpyObj<Router>;
  let loaded: WritableSignal<boolean>;
  let authenticated: WritableSignal<boolean>;
  let generation: number;
  let parked: WritableSignal<boolean>;
  let revision: WritableSignal<number>;
  let persistent: WritableSignal<boolean | null>;
  let routeFragment: string | null;
  let invitations: {
    pending: WritableSignal<boolean>;
    revision: WritableSignal<number>;
    persistent: WritableSignal<boolean | null>;
    expiresAt: WritableSignal<string | null>;
    capture: jasmine.Spy;
    confirmed: jasmine.Spy;
    refresh: jasmine.Spy;
    forget: jasmine.Spy;
    hide: jasmine.Spy;
  };

  beforeEach(() => {
    api = jasmine.createSpyObj<ApiService>("ApiService", ["post"]);
    api.post.and.resolveTo({ workspaceId: 9 } as never);
    auth = jasmine.createSpyObj<AuthService>("AuthService", [
      "init", "logout", "refreshWorkspaces", "sessionGeneration",
    ]);
    loaded = signal(true);
    authenticated = signal(true);
    generation = 1;
    Object.assign(auth, { loaded, authenticated });
    auth.init.and.resolveTo();
    auth.logout.and.resolveTo();
    auth.refreshWorkspaces.and.resolveTo(true);
    auth.sessionGeneration.and.callFake(() => generation);
    router = jasmine.createSpyObj<Router>("Router", ["navigate"]);
    router.navigate.and.resolveTo(true);
    parked = signal(false);
    routeFragment = `token=${tokenA}`;
    revision = signal(0);
    persistent = signal<boolean | null>(null);
    invitations = {
      pending: parked,
      revision,
      persistent,
      expiresAt: signal(null),
      capture: jasmine.createSpy("capture").and.callFake(() => {
        parked.set(true);
        revision.update((value) => value + 1);
        persistent.set(true);
        return true;
      }),
      confirmed: jasmine.createSpy("confirmed").and.callFake(async () => parked()),
      refresh: jasmine.createSpy("refresh").and.callFake(async () => undefined),
      forget: jasmine.createSpy("forget").and.callFake(async () => {
        parked.set(false);
        revision.update((value) => value + 1);
      }),
      hide: jasmine.createSpy("hide").and.callFake(() => {
        parked.set(false);
        revision.update((value) => value + 1);
      }),
    };

    TestBed.configureTestingModule({
      imports: [InvitationAcceptComponent],
      providers: [
        { provide: ApiService, useValue: api },
        { provide: AuthService, useValue: auth },
        { provide: Router, useValue: router },
        { provide: Location, useValue: { replaceState: jasmine.createSpy("replaceState") } },
        { provide: PendingInvitationService, useValue: invitations },
        {
          provide: ActivatedRoute,
          useValue: {
            snapshot: {
              get fragment() { return routeFragment; },
              queryParamMap: { get: () => null, has: () => false },
            },
          },
        },
      ],
    });
  });

  afterEach(() => {
    if (fixture && !fixture.componentRef.hostView.destroyed) fixture.destroy();
  });

  async function create(): Promise<InvitationAcceptComponent> {
    fixture = TestBed.createComponent(InvitationAcceptComponent);
    component = fixture.componentInstance;
    await settle();
    return component;
  }

  it("parks the bearer from the fragment and offers the decision once it landed", async () => {
    await create();

    expect(invitations.capture).toHaveBeenCalledOnceWith(tokenA, null);
    expect(component.ready()).toBeTrue();
    expect(component.busy()).toBeFalse();
  });

  it("does not substitute an older parked invitation for an explicitly invalid link", async () => {
    parked.set(true);
    routeFragment = "token=preview-only";
    await create();

    expect(invitations.capture).not.toHaveBeenCalled();
    expect(invitations.refresh).not.toHaveBeenCalled();
    expect(component.ready()).toBeFalse();
    expect(component.invalidIncoming).toBeTrue();
    expect(component.message()).toContain("no es válido o ha caducado");
    expect(invitations.forget).not.toHaveBeenCalled();
  });

  it("does not substitute an older invitation when a new park refuses an expired link", async () => {
    parked.set(true);
    routeFragment = `token=${tokenA}&expiresAt=2020-01-01T00%3A00%3A00Z`;
    invitations.capture.and.returnValue(false);
    await create();

    expect(invitations.capture).toHaveBeenCalledOnceWith(tokenA, "2020-01-01T00:00:00Z");
    expect(invitations.refresh).not.toHaveBeenCalled();
    expect(component.ready()).toBeFalse();
    expect(component.invalidIncoming).toBeTrue();
  });

  it("continues a parked invitation after an ordinary login round trip with no bearer", async () => {
    parked.set(true);
    routeFragment = null;
    await create();

    expect(invitations.refresh).toHaveBeenCalled();
    expect(component.ready()).toBeTrue();
    expect(component.invalidIncoming).toBeFalse();
  });

  it("offers nothing until the server has actually taken the park", async () => {
    const confirmation = deferred<boolean>();
    invitations.confirmed.and.returnValue(confirmation.promise);
    fixture = TestBed.createComponent(InvitationAcceptComponent);
    component = fixture.componentInstance;
    await settle();

    expect(component.ready()).toBeFalse();
    await component.accept();
    expect(api.post).not.toHaveBeenCalled();

    confirmation.resolve(true);
    await settle();
    expect(component.ready()).toBeTrue();
  });

  it("says the invitation could not be kept when the server refuses the park", async () => {
    invitations.confirmed.and.resolveTo(false);
    await create();

    expect(component.ready()).toBeFalse();
    expect(component.done()).toBeTrue();
    expect(component.message()).toContain("No hemos podido guardar la invitación");
  });

  it("sends no bearer of its own: the server reads the cookie it set", async () => {
    await create();

    await component.accept();

    expect(api.post).toHaveBeenCalledWith("/api/v1/workspaces/invitations/accept", {});
    expect(invitations.hide).toHaveBeenCalled();
    expect(component.ok()).toBeTrue();
  });

  it("shows a recoverable error when session initialization fails", async () => {
    loaded.set(false);
    auth.init.and.rejectWith(new Error("offline"));
    await create();

    expect(component.busy()).toBeFalse();
    expect(component.done()).toBeTrue();
    expect(component.message()).toContain("No se pudo comprobar la sesión");
  });

  it("finishes initialization when adopting the initial identity advances the session generation", async () => {
    loaded.set(false);
    authenticated.set(false);
    auth.init.and.callFake(async () => {
      generation += 1;
      loaded.set(true);
      authenticated.set(true);
    });
    await create();

    expect(component.busy()).toBeFalse();
    expect(component.ready()).toBeTrue();
    expect(api.post).not.toHaveBeenCalled();
    await component.accept();
    expect(api.post).toHaveBeenCalledOnceWith("/api/v1/workspaces/invitations/accept", {});
    expect(component.ok()).toBeTrue();
  });

  it("does not offer a replaced invitation after initial session loading finishes", async () => {
    loaded.set(false);
    const initialization = deferred<void>();
    auth.init.and.returnValue(initialization.promise);
    await create();
    expect(auth.init).toHaveBeenCalled();
    revision.update((value) => value + 1);
    generation += 1;
    loaded.set(true);
    initialization.resolve();
    await settle();

    expect(component.ready()).toBeFalse();
    await component.accept();
    expect(api.post).not.toHaveBeenCalled();
    expect(invitations.hide).not.toHaveBeenCalled();
    expect(invitations.forget).not.toHaveBeenCalled();
  });

  it("does not mistake an absorbed session transport failure for an anonymous session", async () => {
    loaded.set(false);
    authenticated.set(false);
    await create();
    expect(component.needsLogin()).toBeFalse();
    expect(component.ready()).toBeFalse();
    expect(component.message()).toContain("No se pudo comprobar la sesión");
    await component.accept();
    expect(api.post).not.toHaveBeenCalled();
    expect(invitations.forget).not.toHaveBeenCalled();
  });

  it("retries an unknown session without spending or discarding the invitation", async () => {
    loaded.set(false);
    authenticated.set(false);
    await create();
    expect(component.sessionUnavailable()).toBeTrue();
    auth.init.and.callFake(async () => { loaded.set(true); authenticated.set(true); });
    await component.retrySession();
    expect(component.sessionUnavailable()).toBeFalse();
    expect(component.ready()).toBeTrue();
    expect(component.needsLogin()).toBeFalse();
    expect(api.post).not.toHaveBeenCalled();
    expect(invitations.forget).not.toHaveBeenCalled();
  });

  it("only offers login after retry definitively establishes an anonymous session", async () => {
    loaded.set(false);
    authenticated.set(false);
    await create();
    auth.init.and.callFake(async () => { loaded.set(true); });
    await component.retrySession();
    expect(component.sessionUnavailable()).toBeFalse();
    expect(component.needsLogin()).toBeTrue();
    expect(component.ready()).toBeFalse();
    expect(api.post).not.toHaveBeenCalled();
  });

  it("does not clear a newer invitation when an older acceptance finishes", async () => {
    const response = deferred<{ workspaceId: number }>();
    api.post.and.returnValue(response.promise);
    await create();

    const accepting = component.accept();
    // Another park took this browser's place while the request was in flight.
    revision.update((value) => value + 1);
    response.resolve({ workspaceId: 9 });
    await accepting;

    expect(invitations.hide).not.toHaveBeenCalled();
    expect(component.ok()).toBeFalse();
  });

  it("ignores acceptance UI updates after the authenticated session changes", async () => {
    const response = deferred<{ workspaceId: number }>();
    api.post.and.returnValue(response.promise);
    await create();

    const accepting = component.accept();
    generation = 2;
    response.resolve({ workspaceId: 9 });
    await accepting;

    expect(invitations.hide).not.toHaveBeenCalled();
    expect(auth.refreshWorkspaces).not.toHaveBeenCalled();
  });

  for (const action of ["accept", "reject"] as const) {
    it(`does not submit ${action} after the session changes during park confirmation`, async () => {
      await create();
      const confirmation = deferred<boolean>();
      invitations.confirmed.and.returnValue(confirmation.promise);
      const operation = component[action]();
      generation = 2;
      confirmation.resolve(true);
      await operation;
      expect(api.post).not.toHaveBeenCalled();
      expect(invitations.hide).not.toHaveBeenCalled();
    });

    it(`ignores a late ${action} failure from a different session`, async () => {
      const response = deferred<{ workspaceId: number }>();
      api.post.and.returnValue(response.promise);
      await create();
      const operation = component[action]();
      await settle();
      const message = component.message();
      generation = 2;
      response.reject(new ApiRequestError("Old session invitation invalid", 400));
      await operation;
      expect(component.message()).toBe(message);
      expect(invitations.hide).not.toHaveBeenCalled();
    });
  }

  it("keeps acceptance confirmed when the workspace refresh cannot complete", async () => {
    auth.refreshWorkspaces.and.resolveTo(false);
    await create();

    await component.accept();

    expect(invitations.hide).toHaveBeenCalled();
    expect(component.ok()).toBeTrue();
    expect(component.message()).toContain("La invitación se ha aceptado");
  });

  it("drops the parked invitation when the server answers that it is unusable", async () => {
    api.post.and.rejectWith(new ApiRequestError("Invitación inválida, cancelada o caducada", 400));
    await create();

    await component.accept();

    // The server cleared the cookie with that answer, so the panel must stop
    // offering the same dead end on the next visit.
    expect(invitations.hide).toHaveBeenCalled();
    expect(component.ok()).toBeFalse();
    expect(component.message()).toContain("Invitación inválida");
  });

  it("does not navigate after a destroyed switch-account view finishes logout", async () => {
    const response = deferred<void>();
    auth.logout.and.returnValue(response.promise);
    await create();
    component.ready.set(false);
    component.done.set(true);
    component.busy.set(false);

    const switching = component.switchAccount();
    fixture!.destroy();
    response.resolve();
    await switching;

    expect(router.navigate).not.toHaveBeenCalled();
  });
});
