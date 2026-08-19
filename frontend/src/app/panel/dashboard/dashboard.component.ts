import { Component, computed, effect, inject, signal, ChangeDetectionStrategy } from "@angular/core";
import { Router, RouterLink } from "@angular/router";

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
    RouterLink,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    MatSnackBarModule,
    ChartsComponent
],
  templateUrl: "./dashboard.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
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
  readonly error = signal<string | null>(null);

  readonly firstName = computed(() => (this.user()?.name ?? "").split(/\s+/)[0] ?? "");

  private loadedWorkspaceId: number | null | undefined;

  constructor() {
    effect(() => {
      const workspaceId = this.workspaces.currentId();
      if (workspaceId === this.loadedWorkspaceId) return;
      this.loadedWorkspaceId = workspaceId;
      if (workspaceId === null) {
        this.loading.set(false);
        return;
      }
      void this.load();
    });
  }

  async load(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const [a, links] = await Promise.all([
        this.api.get<AnalyticsOverview>("/api/v1/analytics/overview", { period: "30d" }),
        this.api.get<LinksResponse>("/api/v1/links", { sort: "created_at_desc", perPage: 5 }),
      ]);
      this.overview.set(a);
      this.recent.set(links.links);
    } catch (err) {
      const message = err instanceof ApiRequestError ? err.message : "No se pudieron cargar los datos";
      this.error.set(message);
      this.snackbar.open(message, "Cerrar", { duration: 3500 });
    } finally {
      this.loading.set(false);
    }
  }

  retry(): void {
    void this.load();
  }

  openLink(id: number): void {
    void this.router.navigate(["/app/links", id]);
  }

  openLinkFromKeyboard(event: KeyboardEvent, id: number): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    this.openLink(id);
  }

  newLink(): void {
    this.linkDialog.openCreate().subscribe((created) => {
      if (created) void this.router.navigate(["/app/links", created.id]);
    });
  }

  copy(url: string): void {
    const write = navigator.clipboard?.writeText(url);
    if (!write) {
      this.snackbar.open("El navegador no permite copiar automáticamente", "Cerrar", { duration: 2500 });
      return;
    }
    void write.then(
      () => this.snackbar.open("Enlace copiado", "Cerrar", { duration: 2000 }),
      () => this.snackbar.open("No se pudo copiar", "Cerrar", { duration: 2500 }),
    );
  }

  /** Short URL without the scheme, for display. */
  displayUrl(url: string): string {
    return url.replace(/^https?:\/\//, "");
  }

  /** Percentage a country value represents of the total clicks (for bars). */
  geoPct(value: number, o: AnalyticsOverview): number {
    const total = o.countries.reduce((s, c) => s + c.value, 0);
    return total > 0 ? Math.round((value / total) * 100) : 0;
  }

  /** Regional emoji flag for a 2-letter country code. */
  flag(code: string): string {
    if (!/^[A-Za-z]{2}$/.test(code)) return "🌐";
    const upper = code.toUpperCase();
    return String.fromCodePoint(...[...upper].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));
  }

  /** Friendly country name for a 2-letter code (fallback: the code itself). */
  countryName(code: string): string {
    if (!/^[A-Za-z]{2}$/.test(code)) return code;
    try {
      return new Intl.DisplayNames(["es"], { type: "region" }).of(code.toUpperCase()) ?? code;
    } catch {
      return code;
    }
  }
}
