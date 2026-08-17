import { Component, computed, inject, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { CommonModule } from "@angular/common";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { LinkDialogService } from "../links/link-dialog.service";
import { ChartsComponent } from "../analytics/charts.component";
import type { AnalyticsOverview, LinksResponse, LinkDto } from "../../core/models";

@Component({
  selector: "app-dashboard",
  standalone: true,
  imports: [
    CommonModule,
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule,
    ChartsComponent,
  ],
  templateUrl: "./dashboard.component.html",
  styleUrl: "./dashboard.component.scss",
})
export class DashboardComponent {
  private api = inject(ApiService);
  readonly router = inject(Router);
  private snackbar = inject(MatSnackBar);
  private linkDialog = inject(LinkDialogService);
  private auth = inject(AuthService);
  private workspaces = inject(WorkspaceService);

  readonly user = this.auth.user;
  readonly workspaceName = computed(() => this.workspaces.list().find((w) => w.id === this.workspaces.currentId())?.name);
  readonly overview = signal<AnalyticsOverview | null>(null);
  readonly recent = signal<LinkDto[]>([]);
  readonly loading = signal(true);

  readonly firstName = computed(() => (this.user()?.name ?? "").split(/\s+/)[0] ?? "");

  constructor() {
    void this.load();
  }

  async load(): Promise<void> {
    this.loading.set(true);
    try {
      const [a, links] = await Promise.all([
        this.api.get<AnalyticsOverview>("/api/v1/analytics/overview", { period: "30d" }),
        this.api.get<LinksResponse>("/api/v1/links", { sort: "created_at_desc", perPage: 5 }),
      ]);
      this.overview.set(a);
      this.recent.set(links.links);
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudieron cargar los datos", "Cerrar", { duration: 3000 });
    } finally {
      this.loading.set(false);
    }
  }

  newLink(): void {
    this.linkDialog.openCreate().subscribe((created) => {
      if (created) void this.router.navigate(["/app/links", created.id]);
    });
  }

  copy(url: string): void {
    void navigator.clipboard.writeText(url).then(
      () => this.snackbar.open("Enlace copiado", "Cerrar", { duration: 2000 }),
      () => this.snackbar.open("No se pudo copiar", "Cerrar", { duration: 2500 }),
    );
  }

  /** Short URL without the scheme, for display. */
  displayUrl(url: string): string {
    return url.replace(/^https?:\/\//, "");
  }
}
