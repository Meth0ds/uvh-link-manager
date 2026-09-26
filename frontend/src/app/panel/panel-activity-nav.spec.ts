import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BreakpointObserver } from "@angular/cdk/layout";
import { MatDialog } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import { Router } from "@angular/router";
import { Subject, of } from "rxjs";
import type { AuthUser, Workspace } from "../core/models";
import { AuthService } from "../core/services/auth.service";
import { NotificationService } from "../core/services/notification.service";
import { WorkspaceService } from "../core/services/workspace.service";
import { LinkDialogService } from "./links/link-dialog.service";
import { PanelComponent } from "./panel.component";

describe("Panel activity navigation", () => {
  const user: AuthUser = { id: 10, email: "fixture@example.test", name: "Fixture", emailVerified: true, mfaEnabled: false, isAdmin: false };
  const workspace: Workspace = { id: 1, name: "Fixture", slug: "fixture", role: "owner", createdAt: "2026-09-05T12:00:00Z" };
  let identity = signal<AuthUser | null>(user);
  let list = signal<Workspace[]>([workspace]);
  let selected = signal<number | null>(1);
  let panel: PanelComponent;
  const visible = () => panel.visibleNav().flatMap((group) => group.items).some((item) => item.path === "/app/activity");
  const usageVisible = () => panel.visibleNav().flatMap((group) => group.items).some((item) => item.path === "/app/usage");

  beforeEach(() => {
    identity = signal<AuthUser | null>({ ...user });
    list = signal<Workspace[]>([{ ...workspace }]);
    selected = signal<number | null>(1);
    TestBed.configureTestingModule({ providers: [
      { provide: AuthService, useValue: { user: identity } },
      { provide: WorkspaceService, useValue: { list, currentId: selected } },
      // The panel derives its breadcrumb from the router stream, so the stub
      // has to be a router-shaped object, not `{}`: an empty one failed on
      // `undefined.pipe`, which is what this suite spent its time reporting
      // instead of the navigation projection it exists to check.
      { provide: Router, useValue: {
        events: new Subject<unknown>(), url: "/app/links", navigate: () => Promise.resolve(true),
      } },
      { provide: LinkDialogService, useValue: {} },
      { provide: MatDialog, useValue: {} }, { provide: MatSnackBar, useValue: {} },
      { provide: BreakpointObserver, useValue: { observe: () => of({ matches: false, breakpoints: {} }) } },
      // La campana del panel consulta el contador de no leídas al crearse y en
      // cada navegación; aquí no se prueba la campana, sólo no debe estorbar.
      { provide: NotificationService, useValue: { unread: signal(0), refreshUnread: () => Promise.resolve(0) } },
    ] });
    // Exercise the real navigation projection without creating a second routed
    // panel or launching requests through its children.
    panel = TestBed.runInInjectionContext(() => new PanelComponent());
  });

  for (const role of ["owner", "admin", "editor", "viewer"] as const) {
    it(`projects activity visibility for workspace ${role}`, () => {
      list.set([{ ...workspace, role }]);
      expect(visible()).toBe(role === "owner" || role === "admin");
      expect(usageVisible()).toBeTrue();
    });
  }

  it("hides activity immediately when membership or verification is lost", () => {
    expect(visible()).toBeTrue();
    selected.set(2);
    expect(visible()).toBeFalse();
    selected.set(1);
    identity.set({ ...user, emailVerified: false });
    expect(visible()).toBeFalse();
    identity.set(null);
    expect(visible()).toBeFalse();
  });

  it("does not substitute platform administration for workspace membership", () => {
    identity.set({ ...user, isAdmin: true });
    list.set([{ ...workspace, role: "viewer" }]);
    expect(visible()).toBeFalse();
    expect(panel.visibleNav().flatMap((group) => group.items).some((item) => item.path === "/app/admin")).toBeTrue();
  });
});
