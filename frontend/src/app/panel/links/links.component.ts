import { Component, computed, effect, inject, signal, ChangeDetectionStrategy } from "@angular/core";
import { ActivatedRoute, Router } from "@angular/router";

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
import { ActionDialogService } from "../action-dialog.service";
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
    MatProgressBarModule
],
  templateUrl: "./links.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./links.component.scss",
})
export class LinksComponent {
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  readonly router = inject(Router);
  private dialog = inject(MatDialog);
  private snackbar = inject(MatSnackBar);
  private linkDialog = inject(LinkDialogService);
  private workspaces = inject(WorkspaceService);
  private actions = inject(ActionDialogService);

  readonly links = signal<LinkDto[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  readonly actionId = signal<number | null>(null);

  readonly q = signal("");
  readonly state = signal<StateFilter>("");
  readonly tag = signal("");
  readonly sort = signal("created_at_desc");
  readonly page = signal(0);
  readonly pageSize = signal(20);
  private readonly initialDestination = this.route.snapshot.queryParamMap.get("destination")?.trim() ?? "";
  private initialDialogOpened = false;

  readonly canWrite = computed(() => {
    const role = this.workspaces.currentRole();
    return role === "owner" || role === "admin" || role === "editor";
  });

  readonly stateLabel = (s: LinkState) => STATE_LABEL[s];

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
      void this.reload();
    });
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
      if (this.initialDestination && !this.initialDialogOpened && this.canWrite()) {
        this.initialDialogOpened = true;
        this.router.navigate([], { relativeTo: this.route, queryParams: {}, replaceUrl: true });
        this.linkDialog.openCreate(this.initialDestination).subscribe((created) => {
          if (created) void this.router.navigate(["/app/links", created.id]);
        });
      }
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
    if (this.actionId()) return;
    this.actionId.set(link.id);
    try {
      await this.api.post(`/api/v1/links/${link.id}/state`, { state });
      this.snackbar.open("Estado actualizado", "Cerrar", { duration: 2000 });
      void this.reload();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 3000 });
    } finally {
      this.actionId.set(null);
    }
  }

  async remove(link: LinkDto): Promise<void> {
    const confirmed = await this.actions.confirm({
      title: "Eliminar enlace",
      message: `¿Quieres eliminar ${link.shortUrl}? Podrás restaurarlo desde una integración, pero dejará de estar disponible ahora.`,
      confirmLabel: "Eliminar enlace",
      destructive: true,
    });
    if (!confirmed || this.actionId()) return;
    this.actionId.set(link.id);
    try {
      await this.api.delete(`/api/v1/links/${link.id}`);
      this.snackbar.open("Enlace eliminado", "Cerrar", { duration: 2000 });
      void this.reload();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 3000 });
    } finally {
      this.actionId.set(null);
    }
  }

  openLink(id: number): void {
    void this.router.navigate(["/app/links", id]);
  }

  openLinkFromKeyboard(event: KeyboardEvent, id: number): void {
    if (event.key !== "Enter" && event.key !== " ") return;
    event.preventDefault();
    this.openLink(id);
  }

  trackByLink(_i: number, l: LinkDto): number {
    return l.id;
  }

  /** Short URL without the scheme, for display. */
  displayUrl(url: string): string {
    return url.replace(/^https?:\/\//, "");
  }
}
