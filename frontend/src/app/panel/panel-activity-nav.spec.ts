import { signal } from "@angular/core";
import { TestBed } from "@angular/core/testing";
import { BreakpointObserver } from "@angular/cdk/layout";
import { MatDialog } from "@angular/material/dialog";
import { MatSnackBar } from "@angular/material/snack-bar";
import { Router } from "@angular/router";
import { of } from "rxjs";
import type { AuthUser, Workspace } from "../core/models";
import { AuthService } from "../core/services/auth.service";
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

  beforeEach(() => {
    identity = signal<AuthUser | null>({ ...user });
    list = signal<Workspace[]>([{ ...workspace }]);
    selected = signal<number | null>(1);
    TestBed.configureTestingModule({ providers: [
      { provide: AuthService, useValue: { user: identity } },
      { provide: WorkspaceService, useValue: { list, currentId: selected } },
      { provide: Router, useValue: {} }, { provide: LinkDialogService, useValue: {} },
      { provide: MatDialog, useValue: {} }, { provide: MatSnackBar, useValue: {} },
      { provide: BreakpointObserver, useValue: { observe: () => of({ matches: false, breakpoints: {} }) } },
    ] });
    // Exercise the real navigation projection without creating a second routed
    // panel or launching requests through its children.
    panel = TestBed.runInInjectionContext(() => new PanelComponent());
  });

  for (const role of ["owner", "admin", "editor", "viewer"] as const) {
    it(`projects activity visibility for workspace ${role}`, () => {
      list.set([{ ...workspace, role }]);
      expect(visible()).toBe(role === "owner" || role === "admin");
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
