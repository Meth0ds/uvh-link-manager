import { Location } from "@angular/common";
import { signal, type WritableSignal } from "@angular/core";
import { ComponentFixture, TestBed } from "@angular/core/testing";
import { ActivatedRoute, Router } from "@angular/router";

import { ApiService } from "../core/services/api.service";
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

describe("InvitationAcceptComponent async safety", () => {
  const tokenA = "a".repeat(43);
  const tokenB = "b".repeat(43);
  let fixture: ComponentFixture<InvitationAcceptComponent> | undefined;
  let component: InvitationAcceptComponent;
  let api: jasmine.SpyObj<ApiService>;
  let auth: jasmine.SpyObj<AuthService>;
  let router: jasmine.SpyObj<Router>;
  let loaded: WritableSignal<boolean>;
  let authenticated: WritableSignal<boolean>;
  let generation: number;
  let currentToken: string;
  let invitations: {
    persistent: WritableSignal<boolean>;
    capture: jasmine.Spy;
    token: jasmine.Spy;
    clear: jasmine.Spy;
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
    currentToken = tokenA;
    invitations = {
      persistent: signal(true),
      capture: jasmine.createSpy("capture").and.callFake((token: string) => { currentToken = token; }),
      token: jasmine.createSpy("token").and.callFake(() => currentToken),
      clear: jasmine.createSpy("clear").and.callFake(() => { currentToken = ""; }),
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
              fragment: `token=${tokenA}`,
              queryParamMap: { get: () => null },
            },
          },
        },
      ],
    });
  });

  afterEach(() => {
    if (fixture && !fixture.componentRef.hostView.destroyed) fixture.destroy();
  });

  function create(): InvitationAcceptComponent {
    fixture = TestBed.createComponent(InvitationAcceptComponent);
    component = fixture.componentInstance;
    return component;
  }

  it("shows a recoverable error when session initialization fails", async () => {
    loaded.set(false);
    auth.init.and.rejectWith(new Error("offline"));
    create();
    await Promise.resolve();
    await Promise.resolve();

    expect(component.busy()).toBeFalse();
    expect(component.done()).toBeTrue();
    expect(component.message()).toContain("No se pudo comprobar la sesión");
  });

  it("does not clear a newer invitation when an older acceptance finishes", async () => {
    const response = deferred<{ workspaceId: number }>();
    api.post.and.returnValue(response.promise);
    create();

    const accepting = component.accept();
    currentToken = tokenB;
    response.resolve({ workspaceId: 9 });
    await accepting;

    expect(invitations.clear).not.toHaveBeenCalled();
    expect(component.ok()).toBeFalse();
  });

  it("ignores acceptance UI updates after the authenticated session changes", async () => {
    const response = deferred<{ workspaceId: number }>();
    api.post.and.returnValue(response.promise);
    create();

    const accepting = component.accept();
    generation = 2;
    response.resolve({ workspaceId: 9 });
    await accepting;

    expect(invitations.clear).not.toHaveBeenCalled();
    expect(auth.refreshWorkspaces).not.toHaveBeenCalled();
  });

  it("keeps acceptance confirmed when the workspace refresh cannot complete", async () => {
    auth.refreshWorkspaces.and.resolveTo(false);
    create();

    await component.accept();

    expect(invitations.clear).toHaveBeenCalled();
    expect(component.ok()).toBeTrue();
    expect(component.message()).toContain("La invitación se ha aceptado");
  });

  it("does not navigate after a destroyed switch-account view finishes logout", async () => {
    const response = deferred<void>();
    auth.logout.and.returnValue(response.promise);
    create();
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
