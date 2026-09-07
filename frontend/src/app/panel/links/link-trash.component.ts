import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, viewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatPaginatorModule, type PageEvent } from "@angular/material/paginator";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import type { LinkTrashResponse, TrashLinkDto } from "../../core/models";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { decodeLinkTrashResponse } from "../../core/services/link-response-decoders";
import { LatestRequest } from "../../core/services/latest-request";
import { WorkspaceService } from "../../core/services/workspace.service";
import { ActionDialogService } from "../action-dialog.service";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";

@Component({
  selector: "app-link-trash",
  standalone: true,
  imports: [FormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatPaginatorModule, MatProgressBarModule, MatSnackBarModule, PageHeaderComponent, PanelSkeletonComponent],
  templateUrl: "./link-trash.component.html",
  styleUrl: "./link-trash.component.scss",
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class LinkTrashComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly workspaces = inject(WorkspaceService);
  private readonly snackbar = inject(MatSnackBar);
  private readonly actions = inject(ActionDialogService);
  private readonly requests = new LatestRequest(inject(DestroyRef));

  readonly rows = signal<TrashLinkDto[]>([]);
  readonly total = signal(0);
  readonly retentionDays = signal<number | null>(null);
  readonly page = signal(0);
  readonly pageSize = signal(20);
  readonly q = signal("");
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly actionId = signal<number | null>(null);
  readonly purgeId = signal<number | null>(null);
  readonly password = signal("");
  readonly factorCode = signal("");
  readonly confirmation = signal("");
  readonly mfaEnabled = computed(() => this.auth.user()?.mfaEnabled === true);
  readonly canRestore = computed(() => ["owner", "admin", "editor"].includes(this.workspaces.currentRole() ?? ""));
  readonly canPurge = computed(() => ["owner", "admin"].includes(this.workspaces.currentRole() ?? ""));
  private readonly purgeConfirmationInput = viewChild<ElementRef<HTMLInputElement>>("purgeConfirmation");
  private loadedWorkspaceId: number | null | undefined;

  constructor() {
    effect(() => {
      const workspaceId = this.workspaces.currentId();
      if (workspaceId === this.loadedWorkspaceId) return;
      this.loadedWorkspaceId = workspaceId;
      this.requests.invalidate();
      this.rows.set([]); this.total.set(0); this.retentionDays.set(null); this.page.set(0); this.closePurge();
      if (workspaceId === null) { this.loading.set(false); return; }
      void this.load();
    });
  }

  async load(): Promise<void> {
    const workspaceId = this.workspaces.currentId();
    if (workspaceId === null) return;
    const page = this.page() + 1;
    const perPage = this.pageSize();
    const request = this.requests.begin(`${workspaceId}:${page}:${perPage}:${this.q()}`);
    this.loading.set(true); this.error.set(null);
    try {
      const response = await this.api.get<LinkTrashResponse>("/api/v1/links/trash", { q: this.q(), page, perPage }, (value) => decodeLinkTrashResponse(value, { page, perPage }));
      if (!this.requests.isCurrent(request, `${this.workspaces.currentId()}:${page}:${perPage}:${this.q()}`)) return;
      this.rows.set(response.links); this.total.set(response.total); this.retentionDays.set(response.retentionDays);
    } catch (err) {
      if (!this.requests.isCurrent(request, `${this.workspaces.currentId()}:${page}:${perPage}:${this.q()}`)) return;
      this.rows.set([]); this.total.set(0);
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudo cargar la papelera");
    } finally {
      if (this.requests.isCurrent(request, `${this.workspaces.currentId()}:${page}:${perPage}:${this.q()}`)) this.loading.set(false);
    }
  }

  search(value: string): void { this.q.set(value.trim()); this.page.set(0); void this.load(); }
  paginate(event: PageEvent): void { this.page.set(event.pageIndex); this.pageSize.set(event.pageSize); void this.load(); }

  async restore(row: TrashLinkDto): Promise<void> {
    if (!this.canRestore() || this.actionId() !== null) return;
    this.actionId.set(row.link.id);
    try {
      await this.api.post(`/api/v1/links/${row.link.id}/restore`);
      this.snackbar.open("Enlace restaurado", "Cerrar", { duration: 2500 });
      await this.load();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo restaurar", "Cerrar", { duration: 4500 });
    } finally { this.actionId.set(null); }
  }

  openPurge(row: TrashLinkDto): void {
    if (!this.canPurge()) return;
    this.purgeId.set(row.link.id); this.password.set(""); this.factorCode.set(""); this.confirmation.set("");
    // Move keyboard and screen-reader users into the newly revealed region.
    // The next task lets signal-driven rendering create the input first.
    setTimeout(() => {
      if (this.purgeId() === row.link.id) this.purgeConfirmationInput()?.nativeElement.focus();
    });
  }
  closePurge(): void { this.purgeId.set(null); this.password.set(""); this.factorCode.set(""); this.confirmation.set(""); }

  async purge(row: TrashLinkDto): Promise<void> {
    if (!this.canPurge() || this.actionId() !== null || this.confirmation() !== `ELIMINAR ${row.link.alias}` || !this.password()) return;
    if (this.mfaEnabled() && !this.factorCode().trim()) return;
    const confirmed = await this.actions.confirm({ title: "Borrar definitivamente", message: "Esta acción elimina el enlace y sus datos relacionados de forma irreversible.", confirmLabel: "Borrar definitivamente", destructive: true });
    if (!confirmed) return;
    this.actionId.set(row.link.id);
    try {
      await this.api.post(`/api/v1/links/${row.link.id}/purge`, { password: this.password(), factorCode: this.factorCode().trim(), confirmation: this.confirmation() });
      this.closePurge();
      this.snackbar.open("Enlace borrado definitivamente", "Cerrar", { duration: 3000 });
      await this.load();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo borrar definitivamente", "Cerrar", { duration: 5000 });
    } finally { this.actionId.set(null); }
  }

  formatDate(value: string): string { return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)); }
}
