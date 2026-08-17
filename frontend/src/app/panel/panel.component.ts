import { Component, computed, inject, signal } from "@angular/core";
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
import { CommonModule } from "@angular/common";
import { AuthService } from "../core/services/auth.service";
import { WorkspaceService } from "../core/services/workspace.service";
import { LinkDialogService } from "./links/link-dialog.service";

interface NavItem {
  path: string;
  label: string;
  icon: string;
  adminOnly?: boolean;
}

@Component({
  selector: "app-panel",
  standalone: true,
  imports: [
    CommonModule,
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
  ],
  templateUrl: "./panel.component.html",
  styleUrl: "./panel.component.scss",
})
export class PanelComponent {
  private auth = inject(AuthService);
  private router = inject(Router);
  private dialog = inject(LinkDialogService);

  readonly workspaces = inject(WorkspaceService);
  readonly user = this.auth.user;
  readonly isAdmin = computed(() => this.user()?.isAdmin === true);
  readonly mobileOpen = signal(false);

  readonly initials = computed(() => {
    const name = this.user()?.name ?? "?";
    return name
      .split(/\s+/)
      .slice(0, 2)
      .map((p) => p[0]?.toUpperCase() ?? "")
      .join("");
  });

  readonly nav: NavItem[] = [
    { path: "/app/dashboard", label: "Panel", icon: "space_dashboard" },
    { path: "/app/links", label: "Enlaces", icon: "link" },
    { path: "/app/analytics", label: "Analítica", icon: "query_stats" },
    { path: "/app/domains", label: "Dominios", icon: "language" },
    { path: "/app/tokens", label: "Tokens API", icon: "key" },
    { path: "/app/webhooks", label: "Webhooks", icon: "webhook" },
    { path: "/app/team", label: "Equipo", icon: "group" },
    { path: "/app/settings", label: "Ajustes", icon: "settings" },
    { path: "/app/admin", label: "Admin", icon: "admin_panel_settings", adminOnly: true },
  ];

  readonly visibleNav = computed(() => this.nav.filter((n) => !n.adminOnly || this.isAdmin()));

  onWorkspaceChange(id: number): void {
    this.workspaces.select(id);
  }

  newLink(): void {
    this.dialog.openCreate().subscribe((created) => {
      if (created) this.router.navigate(["/app/links", created.id]);
    });
  }

  async logout(): Promise<void> {
    await this.auth.logout();
    this.router.navigate(["/"]);
  }
}
