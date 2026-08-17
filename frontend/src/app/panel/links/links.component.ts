import { Component, computed, inject, signal } from "@angular/core";
import { Router } from "@angular/router";
import { CommonModule } from "@angular/common";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSelectModule } from "@angular/material/select";
import { MatMenuModule } from "@angular/material/menu";
import { MatDividerModule } from "@angular/material/divider";
import { MatPaginatorModule, PageEvent } from "@angular/material/paginator";
import { MatChipsModule } from "@angular/material/chips";
import { MatTooltipModule } from "@angular/material/tooltip";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { MatDialog } from "@angular/material/dialog";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { LinkDialogService } from "./link-dialog.service";
import { QrDialogComponent } from "./qr-dialog.component";
import type { LinksResponse, LinkDto, LinkState } from "../../core/models";

type StateFilter = "" | LinkState;

const STATE_LABEL: Record<LinkState, string> = {
  scheduled: "Programado",
  active: "Activo",
  paused: "En pausa",
  expired: "Caducado",
  blocked: "Bloqueado",
  archived: "Archivado",
  deleted: "Eliminado",
};

@Component({
  selector: "app-links",
  standalone: true,
  imports: [
    CommonModule,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatSelectModule,
    MatMenuModule,
    MatDividerModule,
    MatPaginatorModule,
    MatChipsModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatProgressBarModule,
  ],
  templateUrl: "./links.component.html",
  styleUrl: "./links.component.scss",
})
export class LinksComponent {
  private api = inject(ApiService);
  readonly router = inject(Router);
  private dialog = inject(MatDialog);
  private snackbar = inject(MatSnackBar);
  private linkDialog = inject(LinkDialogService);
  private workspaces = inject(WorkspaceService);

  readonly links = signal<LinkDto[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);

  readonly q = signal("");
  readonly state = signal<StateFilter>("");
  readonly tag = signal("");
  readonly sort = signal("created_at_desc");
  readonly page = signal(0);
  readonly pageSize = signal(20);

  readonly canWrite = computed(() => {
    const role = this.workspaces.currentRole();
    return role === "owner" || role === "admin" || role === "editor";
  });

  readonly stateLabel = (s: LinkState) => STATE_LABEL[s];

  constructor() {
    void this.reload();
  }

  async reload(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.get<LinksResponse>("/api/v1/links", {
        q: this.q(),
        state: this.state(),
        tag: this.tag(),
        sort: this.sort(),
        page: this.page() + 1,
        perPage: this.pageSize(),
      });
      this.links.set(res.links);
      this.total.set(res.total);
    } catch (err) {
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar los enlaces");
    } finally {
      this.loading.set(false);
    }
  }

  onSearch(value: string): void {
    this.q.set(value);
    this.page.set(0);
    void this.reload();
  }

  onState(value: StateFilter): void {
    this.state.set(value);
    this.page.set(0);
    void this.reload();
  }

  onTag(value: string): void {
    this.tag.set(value);
    this.page.set(0);
    void this.reload();
  }

  onSort(value: string): void {
    this.sort.set(value);
    this.page.set(0);
    void this.reload();
  }

  onPage(e: PageEvent): void {
    this.page.set(e.pageIndex);
    this.pageSize.set(e.pageSize);
    void this.reload();
  }

  copy(url: string): void {
    void navigator.clipboard.writeText(url).then(
      () => this.snackbar.open("Enlace copiado", "Cerrar", { duration: 2000 }),
      () => this.snackbar.open("No se pudo copiar", "Cerrar", { duration: 2500 }),
    );
  }

  showQr(url: string): void {
    this.dialog.open(QrDialogComponent, { data: url, width: "auto" });
  }

  create(): void {
    this.linkDialog.openCreate().subscribe((created) => {
      if (created) void this.router.navigate(["/app/links", created.id]);
    });
  }

  edit(link: LinkDto): void {
    this.linkDialog.openEdit(link).subscribe((updated) => {
      if (updated) void this.reload();
    });
  }

  async setState(link: LinkDto, state: "active" | "paused" | "archived"): Promise<void> {
    try {
      await this.api.post(`/api/v1/links/${link.id}/state`, { state });
      this.snackbar.open("Estado actualizado", "Cerrar", { duration: 2000 });
      void this.reload();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 3000 });
    }
  }

  async remove(link: LinkDto): Promise<void> {
    if (!confirm(`¿Eliminar el enlace ${link.shortUrl}?`)) return;
    try {
      await this.api.delete(`/api/v1/links/${link.id}`);
      this.snackbar.open("Enlace eliminado", "Cerrar", { duration: 2000 });
      void this.reload();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 3000 });
    }
  }

  trackByLink(_i: number, l: LinkDto): number {
    return l.id;
  }

  /** Short URL without the scheme, for display. */
  displayUrl(url: string): string {
    return url.replace(/^https?:\/\//, "");
  }
}
