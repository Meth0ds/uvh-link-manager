import { Component, computed, DestroyRef, effect, inject, signal, ChangeDetectionStrategy } from "@angular/core";
import { DatePipe } from "@angular/common";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";

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
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatTooltipModule } from "@angular/material/tooltip";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { MatDialog } from "@angular/material/dialog";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { LinkDialogService } from "./link-dialog.service";
import { QrDialogComponent } from "./qr-dialog.component";
import { ActionDialogService } from "../action-dialog.service";
import { PendingLinkIntentService } from "../../core/services/pending-link-intent.service";
import type { BulkAction, CollectionDto, LinksResponse, LinkDto, LinkState } from "../../core/models";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";
import { LatestRequest } from "../../core/services/latest-request";
import { OwnedMutations } from "../../core/services/owned-mutations";
import { targetWorkspace } from "../../core/services/workspace-target";
import { decodeLinksResponse } from "../../core/services/link-response-decoders";
import { decodeBulkActionResponse, decodeCollectionsResponse } from "../../core/services/scale-response-decoders";
import { downloadBlob } from "../../core/services/browser-download";
import { linkStateLabel } from "../../core/link-state-label";
import { TagsDialogComponent } from "./tags-dialog.component";
import { CollectionsDialogComponent } from "./collections-dialog.component";
import { CsvImportDialogComponent } from "./csv-import-dialog.component";

type StateFilter = "" | LinkState;

@Component({
  selector: "app-links",
  standalone: true,
  imports: [
    RouterLink,
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
    MatCheckboxModule,
    MatTooltipModule,
    MatSnackBarModule,
    MatProgressBarModule,
    DatePipe,
    PageHeaderComponent,
    PanelSkeletonComponent,
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
  private intents = inject(PendingLinkIntentService);
  private readonly requests = new LatestRequest(inject(DestroyRef));

  readonly links = signal<LinkDto[]>([]);
  readonly total = signal(0);
  readonly loading = signal(false);
  readonly error = signal<string | null>(null);
  /** La única mutación en vuelo y su dueño; ver `OwnedMutations`. */
  private readonly mutations = new OwnedMutations();
  readonly actionId = this.mutations.value;

  /** Selección de la página visible; los ids viajan a la acción masiva. */
  readonly selected = signal<ReadonlySet<number>>(new Set());
  /** Panel inline de la barra masiva: etiquetar, quitar etiqueta o mover. */
  readonly bulkPanel = signal<"none" | "tag" | "untag" | "move">("none");
  bulkTagsInput = "";
  readonly bulkCollectionId = signal<number | null>(null);
  readonly collections = signal<CollectionDto[]>([]);
  readonly exporting = signal(false);
  /**
   * Clave de idempotencia de la última acción masiva y su firma. Se reutiliza
   * cuando un intento quedó sin respuesta (red o 5xx): el reintento debe
   * reproducir la respuesta original, nunca aplicar el efecto dos veces. Una
   * respuesta definitiva del servidor la descarta.
   */
  private lastBulk: { signature: string; key: string } | null = null;

  readonly q = signal("");
  readonly state = signal<StateFilter>("");
  readonly tag = signal("");
  readonly sort = signal("created_at_desc");
  readonly page = signal(0);
  readonly pageSizeOptions = [20, 50, 100];
  readonly pageSize = signal(20);
  private readonly legacyDestination = this.route.snapshot.queryParamMap.get("destination")?.trim() ?? "";
  private pendingClaimInFlight = false;
  private pendingDialogOpen = false;
  private pendingAutoHandled = false;

  readonly canWrite = computed(() => {
    const role = this.workspaces.currentRole();
    return role === "owner" || role === "admin" || role === "editor";
  });
  readonly pendingLink = this.intents.pending;

  readonly stateLabel = linkStateLabel;

  private loadedWorkspaceId: number | null | undefined;

  constructor() {
    if (this.legacyDestination) {
      void this.router.navigate([], {
        relativeTo: this.route,
        queryParams: { destination: null },
        queryParamsHandling: "merge",
        replaceUrl: true,
      });
      void this.captureLegacyDestination(this.legacyDestination);
    }
    effect(() => {
      const workspaceId = this.workspaces.currentId();
      if (workspaceId === this.loadedWorkspaceId) return;
      this.loadedWorkspaceId = workspaceId;
      this.requests.invalidate();
      // Link titles and destinations are workspace-confidential; clear them
      // synchronously instead of waiting for the next HTTP response.
      this.links.set([]);
      this.total.set(0);
      // Pagination is scoped to a workspace. Reusing a high page from the
      // previous tenant can make a populated smaller workspace appear empty.
      this.page.set(0);
      this.error.set(null);
      // Una mutación en vuelo pertenece al workspace que dejó la pantalla; su
      // `finally` no va a liberar este hueco, así que lo libera el contexto.
      this.mutations.reset();
      this.pendingAutoHandled = false;
      if (workspaceId === null) {
        this.loading.set(false);
        return;
      }
      void this.reload();
    });
  }

  async reload(): Promise<void> {
    const workspaceId = this.workspaces.currentId();
    if (workspaceId === null) {
      this.requests.invalidate();
      this.links.set([]);
      this.total.set(0);
      this.loading.set(false);
      return;
    }
    const request = this.requests.begin(workspaceId);
    // La selección pertenece a la página visible: un cambio de filas no puede
    // arrastrar ids que ya no están delante del usuario.
    this.clearSelection();
    const page = this.page() + 1;
    const perPage = this.pageSize();
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.get<LinksResponse>("/api/v1/links", {
        q: this.q(),
        state: this.state(),
        tag: this.tag(),
        sort: this.sort(),
        page,
        perPage,
      }, (value) => decodeLinksResponse(value, { page, perPage }), { signal: request.signal });
      if (!this.requests.isCurrent(request, this.workspaces.currentId())) return;
      this.links.set(res.links);
      this.total.set(res.total);
      void this.openPendingLink();
    } catch (err) {
      if (!this.requests.isCurrent(request, this.workspaces.currentId())) return;
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar los enlaces");
    } finally {
      if (this.requests.isCurrent(request, this.workspaces.currentId())) this.loading.set(false);
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

  /**
   * The tag chips are the tag filter: pressing the chip of a tag that is
   * already filtering is how you undo it. The signal they write has always
   * been sent to the API (and documented there); nothing used to write it.
   */
  toggleTag(name: string): void {
    this.tag.set(this.tag() === name ? "" : name);
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

  toggleSelected(id: number): void {
    this.selected.update((current) => {
      const next = new Set(current);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  allOnPage(): boolean {
    const links = this.links();
    return links.length > 0 && links.every((link) => this.selected().has(link.id));
  }

  toggleSelectPage(checked: boolean): void {
    this.selected.update((current) => {
      const next = new Set(current);
      for (const link of this.links()) {
        if (checked) next.add(link.id);
        else next.delete(link.id);
      }
      return next;
    });
  }

  clearSelection(): void {
    this.selected.set(new Set());
    this.bulkPanel.set("none");
    this.bulkTagsInput = "";
  }

  openBulkPanel(mode: "tag" | "untag" | "move"): void {
    this.bulkPanel.set(this.bulkPanel() === mode ? "none" : mode);
    if (this.bulkPanel() === "move") void this.loadCollections();
  }

  applyBulkTags(): Promise<void> {
    const tags = [...new Set(this.bulkTagsInput.split(/[;,\n]/).map((tag) => tag.trim()).filter((tag) => tag !== ""))];
    if (!tags.length) return Promise.resolve();
    return this.runBulk(this.bulkPanel() === "untag" ? "untag" : "tag", { tags });
  }

  applyBulkMove(): Promise<void> {
    return this.runBulk("move", { collectionId: this.bulkCollectionId() });
  }

  bulkState(action: "pause" | "activate" | "archive"): Promise<void> {
    return this.runBulk(action);
  }

  async bulkTrash(): Promise<void> {
    const count = this.selected().size;
    const confirmed = await this.actions.confirm({
      title: "Eliminar enlaces seleccionados",
      message: `¿Quieres eliminar ${count} ${count === 1 ? "enlace" : "enlaces"}? Podrás restaurarlos desde la papelera.`,
      confirmLabel: "Eliminar enlaces",
      destructive: true,
    });
    if (!confirmed) return;
    await this.runBulk("trash");
  }

  /**
   * Aplica una acción a toda la selección o a ninguna, con una clave de
   * idempotencia por intención: un reintento sin respuesta reproduce la
   * respuesta original en vez de duplicar el efecto.
   */
  private async runBulk(action: BulkAction, extra: Record<string, unknown> = {}): Promise<void> {
    if (this.actionId() !== null) return;
    const target = targetWorkspace(this.workspaces);
    if (target.workspaceId === null) return;
    const ids = [...this.selected()].sort((a, b) => a - b);
    if (!ids.length) return;
    const signature = JSON.stringify({ action, ids, ...extra });
    const key = this.lastBulk?.signature === signature ? this.lastBulk.key : crypto.randomUUID();
    this.lastBulk = { signature, key };
    const op = this.mutations.begin(0);
    try {
      await this.api.post("/api/v1/links/bulk", { action, linkIds: ids, ...extra }, decodeBulkActionResponse, { "Idempotency-Key": key });
      if (!target.isCurrent() || !this.mutations.isCurrent(op)) return;
      this.lastBulk = null;
      this.clearSelection();
      this.snackbar.open("Acción aplicada", "Cerrar", { duration: 2500 });
      void this.reload();
    } catch (err) {
      if (!target.isCurrent() || !this.mutations.isCurrent(op)) return;
      // Una respuesta del servidor es definitiva: se descarta la clave y un
      // nuevo intento es una nueva intención. Sin respuesta (red o 5xx) se
      // conserva para que el reintento reproduzca en vez de aplicar dos veces.
      if (err instanceof ApiRequestError && err.status > 0 && err.status < 500) this.lastBulk = null;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo aplicar la acción", "Cerrar", { duration: 3500 });
    } finally {
      this.mutations.settle(op);
    }
  }

  async exportCsv(): Promise<void> {
    if (this.exporting()) return;
    this.exporting.set(true);
    try {
      const blob = await this.api.getBlob("/api/v1/links/export.csv");
      const stamp = new Date().toISOString().slice(0, 10);
      if (!downloadBlob(blob, `uvh-links-${stamp}.csv`)) {
        this.snackbar.open("No se pudo iniciar la descarga", "Cerrar", { duration: 3000 });
        return;
      }
      this.snackbar.open("Export CSV descargado", "Cerrar", { duration: 2500 });
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo exportar el CSV", "Cerrar", { duration: 3500 });
    } finally {
      this.exporting.set(false);
    }
  }

  importCsv(): void {
    this.dialog.open(CsvImportDialogComponent, { width: "min(720px, 94vw)", maxWidth: "94vw" })
      .afterClosed()
      .subscribe((imported: unknown) => {
        if (typeof imported === "number" && imported > 0) void this.reload();
      });
  }

  openTags(): void {
    this.dialog.open(TagsDialogComponent, { width: "min(680px, 94vw)", maxWidth: "94vw" })
      .afterClosed()
      .subscribe((changed: unknown) => {
        if (changed === true) void this.reload();
      });
  }

  openCollections(): void {
    this.dialog.open(CollectionsDialogComponent, { width: "min(680px, 94vw)", maxWidth: "94vw" })
      .afterClosed()
      .subscribe((changed: unknown) => {
        if (changed === true) void this.reload();
      });
  }

  private async loadCollections(): Promise<void> {
    try {
      const res = await this.api.get("/api/v1/collections", undefined, decodeCollectionsResponse);
      this.collections.set(res.collections);
    } catch {
      // El selector queda vacío y se puede reintentar abriéndolo de nuevo:
      // mejor vacío que una lista a medias.
    }
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

  resumePendingLink(): void {
    void this.openPendingLink(true);
  }

  async discardPendingLink(): Promise<void> {
    const confirmed = await this.actions.confirm({
      title: "Descartar URL guardada",
      message: "La URL dejará de estar disponible para crear un enlace más tarde.",
      confirmLabel: "Descartar URL",
      destructive: true,
    });
    if (!confirmed) return;
    void this.intents.complete();
    this.snackbar.open("URL guardada descartada", "Cerrar", { duration: 2500 });
  }

  edit(link: LinkDto): void {
    this.linkDialog.openEdit(link).subscribe((updated) => {
      if (updated) void this.reload();
    });
  }

  async setState(link: LinkDto, state: "active" | "paused" | "archived"): Promise<void> {
    if (this.actionId()) return;
    // The listed row was read from one workspace. Its id is only meaningful
    // there, so the mutation must not be sent after the header changed.
    const target = targetWorkspace(this.workspaces);
    if (target.workspaceId === null) return;
    const action = this.mutations.begin(link.id);
    try {
      await this.api.post(`/api/v1/links/${link.id}/state`, { state });
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open("Estado actualizado", "Cerrar", { duration: 2000 });
      void this.reload();
    } catch (err) {
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 3000 });
    } finally {
      this.mutations.settle(action);
    }
  }

  async remove(link: LinkDto): Promise<void> {
    // Bind the decision to the workspace that listed the link: answering the
    // dialog after switching tenants must not delete from the new one.
    const target = targetWorkspace(this.workspaces);
    const confirmed = await this.actions.confirm({
      title: "Eliminar enlace",
      message: `¿Quieres eliminar ${link.shortUrl}? Podrás restaurarlo desde una integración, pero dejará de estar disponible ahora.`,
      confirmLabel: "Eliminar enlace",
      destructive: true,
    });
    if (!confirmed || this.actionId() || !target.isCurrent()) return;
    const action = this.mutations.begin(link.id);
    try {
      await this.api.delete(`/api/v1/links/${link.id}`);
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open("Enlace eliminado", "Cerrar", { duration: 2000 });
      void this.reload();
    } catch (err) {
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 3000 });
    } finally {
      // Only the operation that still owns the slot may clear it: a stale
      // `remove` landing late must not re-enable the rows of a newer action.
      this.mutations.settle(action);
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

  private async captureLegacyDestination(destination: string): Promise<void> {
    try {
      const receipt = await this.intents.create(destination);
      this.intents.capture(receipt.intent, receipt.expiresAt);
      await this.openPendingLink();
    } catch (err) {
      this.snackbar.open(
        err instanceof ApiRequestError ? err.message : "No se pudo guardar la URL para continuar",
        "Cerrar",
        { duration: 3500 },
      );
    }
  }

  private async openPendingLink(force = false): Promise<void> {
    if (!this.canWrite() || this.pendingClaimInFlight || this.pendingDialogOpen || (!force && this.pendingAutoHandled)) return;
    if (!this.pendingLink()) return;

    this.pendingAutoHandled = true;
    this.pendingClaimInFlight = true;
    try {
      const pending = await this.intents.claim();
      if (!pending) return;
      this.pendingDialogOpen = true;
      this.linkDialog.openCreate(pending.destination).subscribe((created) => {
        this.pendingDialogOpen = false;
        if (!created) return;
        void this.intents.complete();
        void this.router.navigate(["/app/links", created.id]);
      });
    } catch (err) {
      this.snackbar.open(
        err instanceof ApiRequestError ? err.message : "No se pudo recuperar la URL guardada",
        "Cerrar",
        { duration: 3500 },
      );
    } finally {
      this.pendingClaimInFlight = false;
    }
  }
}
