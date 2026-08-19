import { Component, computed, inject, signal, ChangeDetectionStrategy } from "@angular/core";
import { toSignal } from "@angular/core/rxjs-interop";
import { BreakpointObserver } from "@angular/cdk/layout";
import { map } from "rxjs";
import { RouterOutlet, RouterLink, RouterLinkActive, Router } from "@angular/router";
import { MatSidenavModule } from "@angular/material/sidenav";
import { MatToolbarModule } from "@angular/material/toolbar";
import { MatListModule } from "@angular/material/list";
import { MatIconModule } from "@angular/material/icon";
import { MatButtonModule } from "@angular/material/button";
import { MatMenuModule } from "@angular/material/menu";
import { MatSelectModule } from "@angular/material/select";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatTooltipModule } from "@angular/material/tooltip";
import { MatDividerModule } from "@angular/material/divider";
import { MatDialog } from "@angular/material/dialog";

import { AuthService } from "../core/services/auth.service";
import { WorkspaceService } from "../core/services/workspace.service";
import { LinkDialogService } from "./links/link-dialog.service";
import { WorkspaceDialogComponent, type WorkspaceDialogResult } from "./workspace-dialog.component";

interface NavItem {
  path: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
}

interface NavGroup {
  label: string;
  items: NavItem[];
}

@Component({
  selector: "app-panel",
  standalone: true,
  imports: [
    RouterOutlet,
    RouterLink,
    RouterLinkActive,
    MatSidenavModule,
    MatToolbarModule,
    MatListModule,
    MatIconModule,
    MatButtonModule,
    MatMenuModule,
    MatSelectModule,
    MatFormFieldModule,
    MatTooltipModule,
    MatDividerModule
],
  templateUrl: "./panel.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./panel.component.scss",
})
export class PanelComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private dialog = inject(LinkDialogService);
  private materialDialog = inject(MatDialog);
  private breakpoint = inject(BreakpointObserver);

  readonly workspaces = inject(WorkspaceService);
  readonly user = this.auth.user;
  readonly isAdmin = computed(() => this.user()?.isAdmin === true);
  readonly mobileOpen = signal(false);
  readonly isMobile = toSignal(this.breakpoint.observe("(max-width: 720px)").pipe(map((state) => state.matches)), { initialValue: false });

  readonly initials = computed(() => {
    const name = this.user()?.name ?? "?";
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("");
  });

  readonly nav: NavGroup[] = [
    {
      label: "Trabajo",
      items: [
        { path: "/app/dashboard", label: "Panel", icon: "space_dashboard" },
        { path: "/app/links", label: "Enlaces", icon: "link" },
        { path: "/app/analytics", label: "Analítica", icon: "query_stats" },
        { path: "/app/domains", label: "Dominios", icon: "language" },
      ],
    },
    {
      label: "Integraciones",
      items: [
        { path: "/app/tokens", label: "Tokens API", icon: "key" },
        { path: "/app/webhooks", label: "Webhooks", icon: "webhook" },
      ],
    },
    {
      label: "Cuenta",
      items: [
        { path: "/app/team", label: "Equipo", icon: "group" },
        { path: "/app/settings", label: "Ajustes", icon: "settings" },
      ],
    },
    {
      label: "Sistema",
      items: [{ path: "/app/admin", label: "Admin", icon: "admin_panel_settings", adminOnly: true }],
    },
  ];

  readonly visibleNav = computed(() =>
    this.nav
      .map((g) => ({ ...g, items: g.items.filter((n) => !n.adminOnly || this.isAdmin()) }))
      .filter((g) => g.items.length > 0),
  );

  onWorkspaceChange(id: number): void {
    this.workspaces.select(id);
  }

  newLink(): void {
    this.dialog.openCreate().subscribe((created) => {
      if (created) void this.router.navigate(["/app/links", created.id]);
    });
  }

  createWorkspace(): void {
    this.materialDialog.open(WorkspaceDialogComponent, {
      width: "min(480px, 92vw)",
      maxWidth: "92vw",
      autoFocus: "first-tabbable",
      ariaLabel: "Crear workspace",
    }).afterClosed().subscribe(async (result: WorkspaceDialogResult | undefined) => {
      if (!result) return;
      await this.auth.refreshWorkspaces();
      this.workspaces.select(result.workspace.id);
    });
  }

  logout(): void {
    // AuthService clears the local identity synchronously and finishes the
    // server revocation in the background; navigation must not wait on a
    // potentially slow network request.
    void this.auth.logout();
    void this.router.navigate(["/"]);
  }
}
