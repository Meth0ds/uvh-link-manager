import { Component, computed, ElementRef, inject, signal, ChangeDetectionStrategy, viewChild } from "@angular/core";
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
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";

import { AuthService } from "../core/services/auth.service";
import { WorkspaceService } from "../core/services/workspace.service";
import { LinkDialogService } from "./links/link-dialog.service";
import { WorkspaceDialogComponent, type WorkspaceDialogResult } from "./workspace-dialog.component";
import { PublicThemeToggleComponent } from "../core/public-theme-toggle.component";

interface NavItem {
  path: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
  workspaceAdminOnly?: boolean;
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
    MatDividerModule,
    MatSnackBarModule,
    PublicThemeToggleComponent,
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
  private snackbar = inject(MatSnackBar);

  readonly workspaces = inject(WorkspaceService);
  readonly user = this.auth.user;
  readonly isAdmin = computed(() => this.user()?.isAdmin === true);
  readonly workspaceName = computed(() => this.workspaces.list().find((workspace) => workspace.id === this.workspaces.currentId())?.name ?? "Sin workspace");
  readonly mobileOpen = signal(false);
  readonly logoutBusy = signal(false);
  readonly isMobile = toSignal(this.breakpoint.observe("(max-width: 720px)").pipe(map((state) => state.matches)), { initialValue: false });
  readonly panelContent = viewChild.required<ElementRef<HTMLElement>>("panelContent");

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
        { path: "/app/getting-started", label: "Primeros pasos", icon: "checklist" },
        { path: "/app/links", label: "Enlaces", icon: "link" },
        { path: "/app/analytics", label: "Analítica", icon: "query_stats" },
        { path: "/app/usage", label: "Uso y límites", icon: "data_usage" },
        { path: "/app/activity", label: "Actividad", icon: "history", workspaceAdminOnly: true },
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
        { path: "/app/security", label: "Centro de seguridad", icon: "security" },
        { path: "/app/settings", label: "Ajustes", icon: "settings" },
      ],
    },
    {
      label: "Sistema",
      items: [{ path: "/app/admin", label: "Admin", icon: "admin_panel_settings", adminOnly: true }],
    },
  ];

  readonly visibleNav = computed(() => {
    // Platform administration does not grant another tenant's activity.
    const role = this.workspaces.list().find((w) => w.id === this.workspaces.currentId())?.role;
    const workspaceAdmin = this.user()?.emailVerified === true && (role === "owner" || role === "admin");
    return this.nav
      .map((g) => ({ ...g, items: g.items.filter((n) => (!n.adminOnly || this.isAdmin())
        && (!n.workspaceAdminOnly || workspaceAdmin)) }))
      .filter((g) => g.items.length > 0);
  });

  onWorkspaceChange(id: number): void {
    this.workspaces.select(id);
  }

  skipToContent(event: Event): void {
    // Angular's document-level link handling can resolve a bare fragment
    // against the application base and leave the current child route. Keep the
    // skip link on this page and move focus to the explicit main landmark.
    event.preventDefault();
    this.panelContent().nativeElement.focus();
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

  async logout(): Promise<void> {
    if (this.logoutBusy()) return;
    this.logoutBusy.set(true);
    try {
      await this.auth.logout();
      await this.router.navigate(["/"]);
    } catch {
      this.snackbar.open("No se pudo confirmar el cierre de sesión. Tu acceso sigue abierto; vuelve a intentarlo.", "Cerrar", { duration: 6000 });
    } finally {
      this.logoutBusy.set(false);
    }
  }
}
