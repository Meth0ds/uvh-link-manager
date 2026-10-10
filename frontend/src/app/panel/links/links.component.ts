import { Component, computed, DestroyRef, effect, inject, signal, ChangeDetectionStrategy } from "@angular/core";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
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
import { QrLibraryService } from "../../core/services/qr-library.service";
import { QrDialogComponent } from "./qr-dialog.component";
import { ActionDialogService } from "../action-dialog.service";
import { PendingLinkIntentService } from "../../core/services/pending-link-intent.service";
import type { BulkAction, CollectionDto, DomainDto, LinksResponse, LinkDto, LinkState } from "../../core/models";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";
import { LatestRequest } from "../../core/services/latest-request";
import { OwnedMutations } from "../../core/services/owned-mutations";
import { targetWorkspace } from "../../core/services/workspace-target";
import { decodeLinksResponse } from "../../core/services/link-response-decoders";
import { decodeDomainsResponse } from "../../core/services/domain-response-decoders";
import { decodeBulkActionResponse, decodeCollectionsResponse } from "../../core/services/scale-response-decoders";
import { parseRouteId } from "../../core/strict-wire";
import { AuthService } from "../../core/services/auth.service";
import { downloadBlob } from "../../core/services/browser-download";
import { CopyFeedbackService } from "../../core/services/copy-feedback.service";
import { CopyFeedbackIconComponent } from "../copy-feedback-icon.component";
import { linkStateLabel } from "../../core/link-state-label";
import { TagsDialogComponent } from "./tags-dialog.component";
import { CollectionsDialogComponent } from "./collections-dialog.component";
import { CsvImportDialogComponent } from "./csv-import-dialog.component";

type StateFilter = "" | LinkState;

@Component({
  selector: "app-links",
  standalone: true,
  providers: [CopyFeedbackService],
  imports: [
    CopyFeedbackIconComponent,
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
  private readonly dialogOwner = inject(DestroyRef);
  private route = inject(ActivatedRoute);
  readonly router = inject(Router);
  private dialog = inject(MatDialog);
  private snackbar = inject(MatSnackBar);
  private linkDialog = inject(LinkDialogService);
  private workspaces = inject(WorkspaceService);
  readonly copyFeedback = inject(CopyFeedbackService);
  readonly copyScope = () => `${this.workspaces.currentId()}:${this.workspaces.selectionGeneration()}`;
  private actions = inject(ActionDialogService);
  private intents = inject(PendingLinkIntentService);
  private readonly requests = new LatestRequest(inject(DestroyRef));
  private readonly qrLibrary = inject(QrLibraryService);
  private readonly qrRequests = new LatestRequest(inject(DestroyRef));
  readonly qrSnapshotBusy = signal(false);
  private readonly exports = new LatestRequest(inject(DestroyRef));
  private readonly domainRequests = new LatestRequest(inject(DestroyRef));
  private readonly collectionRequests = new LatestRequest(inject(DestroyRef));
  private collectionLoad: { context: string; promise: Promise<void> } | null = null;
  private readonly auth = inject(AuthService);

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
  readonly bulkPanel = signal<"none" | "tag" | "untag" | "move" | "domain">("none");
  bulkTagsInput = "";
  readonly bulkCollectionId = signal<number | null>(null);
  /** Destino de «cambiar dominio»; null es el dominio de plataforma. */
  readonly bulkDomainId = signal<number | null>(null);
  /** Sólo dominios sirviendo pueden recibir enlaces; el resto no se ofrece. */
  readonly bulkDomainOptions = computed(() => this.domainOptions().filter((d) => d.servingReady));
  readonly collections = signal<CollectionDto[]>([]);
  readonly exporting = signal(false);
  /**
   * Clave de idempotencia de la última acción masiva y su firma. Se reutiliza
   * cuando un intento quedó sin respuesta (red, 5xx o `409` de relevo): el
   * reintento debe reproducir la respuesta original, nunca aplicar el efecto
   * dos veces. Una respuesta definitiva del servidor la descarta.
   */
  private lastBulk: { signature: string; key: string } | null = null;
  /**
   * Reintento ofrecido tras un `409`: mismo cuerpo y misma clave congelados,
   * porque el contrato (docs/api.md) pide repetir exactamente la petición
   * desplazada aunque la selección haya cambiado después.
   */
  private bulkRetry: { signature: string; body: Record<string, unknown>; key: string } | null = null;

  readonly q = signal("");
  readonly state = signal<StateFilter>("");
  readonly tag = signal("");
  readonly sort = signal("created_at_desc");
  /** null es «uvh.es»: los enlaces sin dominio personalizado. */
  readonly domainId = signal<number | null>(null);
  readonly domainOptions = signal<DomainDto[]>([]);
  readonly hasFilters = computed(() => Boolean(this.q().trim() || this.state() || this.tag() || this.domainId() !== null));
  readonly someOnPage = computed(() => this.links().some(link => this.selected().has(link.id)) && !this.allOnPage());
  readonly page = signal(0);
  readonly pageSizeOptions = [20, 50, 100];
  readonly pageSize = signal(20);
  private readonly legacyDestination = this.route.snapshot.queryParamMap.get("destination")?.trim() ?? "";
  /**
   * Filtro de dominio que llega en la URL («Ver N enlaces» desde la pantalla
   * de dominios). Es una entrada de un solo uso: se aplica al primer
   * workspace que carga la pantalla y queda consumida, porque al cambiar de
   * workspace el dominio apuntaría a un tenant ajeno. La URL no se limpia, de
   * modo que compartir o recargar la vista conserva el filtro.
   */
  private readonly initialDomainFilter = parseRouteId(this.route.snapshot.queryParamMap.get("domainId"));
  private initialDomainFilterApplied = false;
  private pendingClaimInFlight = false;
  private pendingDialogOpen = false;
  private pendingAutoHandled = false;

  readonly canWrite = computed(() => {
    const role = this.workspaces.currentRole();
    return role === "owner" || role === "admin" || role === "editor";
  });
  readonly pendingLink = this.intents.pending;

  readonly stateLabel = linkStateLabel;

  private loadedContext: string | undefined;

  private viewContext(): string {
    return JSON.stringify([this.auth.sessionGeneration(), this.workspaces.currentId(),
      this.workspaces.selectionGeneration(), this.workspaces.currentRole()]);
  }

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
      const context = this.viewContext();
      if (context === this.loadedContext) return;
      this.loadedContext = context;
      this.qrRequests.invalidate(); this.qrSnapshotBusy.set(false);
      this.exports.invalidate();
      this.exporting.set(false);
      this.requests.invalidate();
      this.domainRequests.invalidate();
      this.collectionRequests.invalidate();
      this.collectionLoad = null;
      this.collections.set([]);
      this.bulkCollectionId.set(null);
      this.bulkDomainId.set(null);
      this.clearSelection();
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
      // El filtro por dominio es por workspace: la selección previa apuntaría
      // a un dominio de otro tenant.
      this.domainId.set(null);
      this.domainOptions.set([]);
      if (workspaceId === null) {
        this.loading.set(false);
        return;
      }
      if (this.initialDomainFilter !== null && !this.initialDomainFilterApplied) {
        // El primer workspace que carga es el único que puede aplicar el
        // filtro de la URL: consume la entrada para que un cambio de workspace
        // no vuelva a filtrar por un dominio de otro tenant.
        this.initialDomainFilterApplied = true;
        this.domainId.set(this.initialDomainFilter);
      }
      void this.loadDomainOptions();
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
    const request = this.requests.begin(this.viewContext());
    // Selection belongs to the workspace, including links on other pages.
    // Context changes and successful bulk mutations clear it explicitly.
    const page = this.page() + 1;
    const perPage = this.pageSize();
    this.loading.set(true);
    this.error.set(null);
    try {
      const res = await this.api.get<LinksResponse>("/api/v1/links", {
        q: this.q(),
        state: this.state(),
        tag: this.tag(),
        domainId: this.domainId() ?? "",
        sort: this.sort(),
        page,
        perPage,
      }, (value) => decodeLinksResponse(value, { page, perPage }), { signal: request.signal });
      if (!this.requests.isCurrent(request, this.viewContext())) return;
      this.links.set(res.links);
      this.total.set(res.total);
      void this.openPendingLink();
    } catch (err) {
      if (!this.requests.isCurrent(request, this.viewContext())) return;
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar los enlaces");
    } finally {
      if (this.requests.isCurrent(request, this.viewContext())) this.loading.set(false);
    }
  }

  onSearch(value: string): void {
    this.q.set(value.trim());
    this.page.set(0);
    void this.reload();
  }

  clearFilters(): void {
    this.clearSelection();
    this.q.set("");
    this.state.set("");
    this.tag.set("");
    this.domainId.set(null);
    this.page.set(0);
    void this.reload();
  }

  onState(value: StateFilter): void {
    this.state.set(value);
    this.page.set(0);
    void this.reload();
  }

  onDomain(value: number | null): void {
    this.domainId.set(value);
    this.page.set(0);
    void this.reload();
  }

  /** Opciones del filtro por dominio; sólo necesitan id y nombre. */
  private async loadDomainOptions(): Promise<void> {
    if (this.workspaces.currentId() === null) return;
    const request = this.domainRequests.begin(this.viewContext());
    try {
      const { domains } = await this.api.get<{ domains: DomainDto[] }>("/api/v1/domains", undefined, decodeDomainsResponse, { signal: request.signal });
      if (!this.domainRequests.isCurrent(request, this.viewContext())) return;
      this.domainOptions.set(domains);
    } catch {
      // El filtro queda sin opciones, nunca a medias.
      if (this.domainRequests.isCurrent(request, this.viewContext())) this.domainOptions.set([]);
    }
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

  openBulkPanel(mode: "tag" | "untag" | "move" | "domain"): void {
    this.bulkPanel.set(this.bulkPanel() === mode ? "none" : mode);
    if (this.bulkPanel() === "move") void this.loadCollections();
    // El dominio predeterminado del workspace es el destino que casi siempre
    // se quiere; la elección queda visible antes de aplicar nada.
    if (this.bulkPanel() === "domain") {
      this.bulkDomainId.set(this.bulkDomainOptions().find((d) => d.isDefault)?.id ?? null);
    }
  }

  applyBulkTags(): Promise<void> {
    const tags = [...new Set(this.bulkTagsInput.split(/[;,\n]/).map((tag) => tag.trim()).filter((tag) => tag !== ""))];
    if (!tags.length) return Promise.resolve();
    return this.runBulk(this.bulkPanel() === "untag" ? "untag" : "tag", { tags });
  }

  applyBulkMove(): Promise<void> {
    return this.runBulk("move", { collectionId: this.bulkCollectionId() });
  }

  applyBulkDomain(): Promise<void> {
    return this.runBulk("set-domain", { domainId: this.bulkDomainId() });
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
    const ids = [...this.selected()].sort((a, b) => a - b);
    if (!ids.length) return;
    await this.sendBulk(JSON.stringify({ action, ids, ...extra }), { action, linkIds: ids, ...extra });
  }

  /**
   * Repite la acción masiva que un `409` desplazó: el mismo cuerpo con la
   * misma clave, tal y como pide el contrato de reintento. Se repite la
   * intención congelada aunque la selección haya cambiado después.
   */
  async retryBulk(): Promise<void> {
    const pending = this.bulkRetry;
    if (pending === null) return;
    this.bulkRetry = null;
    await this.sendBulk(pending.signature, pending.body);
  }

  private async sendBulk(signature: string, body: Record<string, unknown>): Promise<void> {
    if (this.actionId() !== null) return;
    const target = targetWorkspace(this.workspaces);
    if (target.workspaceId === null) return;
    const key = this.lastBulk?.signature === signature ? this.lastBulk.key : crypto.randomUUID();
    this.lastBulk = { signature, key };
    const op = this.mutations.begin(0);
    try {
      await this.api.post("/api/v1/links/bulk", body, decodeBulkActionResponse, { "Idempotency-Key": key });
      if (!target.isCurrent() || !this.mutations.isCurrent(op)) return;
      this.lastBulk = null;
      this.bulkRetry = null;
      this.clearSelection();
      this.snackbar.open("Acción aplicada", "Cerrar", { duration: 2500 });
      void this.reload();
    } catch (err) {
      if (!target.isCurrent() || !this.mutations.isCurrent(op)) return;
      if (err instanceof ApiRequestError && err.status === 409) {
        // El `409` pide repetir el mismo cuerpo con la misma clave: no se
        // descarta nada y se ofrece el reintento real en vez de abrir una
        // intención nueva que volvería a ejecutar lo ya aplicado.
        this.bulkRetry = { signature, body, key };
        this.snackbar
          .open(err.message, "Reintentar", { duration: 8000 })
          .onAction()
          .subscribe(() => void this.retryBulk());
        return;
      }
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
    const workspaceId = this.workspaces.currentId();
    if (workspaceId === null) return;
    const request = this.exports.begin(this.viewContext());
    const current = (): boolean => this.exports.isCurrent(request, this.viewContext());
    this.exporting.set(true);
    try {
      const blob = await this.api.getBlob("/api/v1/links/export.csv", undefined, { signal: request.signal });
      if (!current()) return;
      const stamp = new Date().toISOString().slice(0, 10);
      if (!downloadBlob(blob, `uvh-links-${stamp}.csv`)) {
        this.snackbar.open("No se pudo iniciar la descarga", "Cerrar", { duration: 3000 });
        return;
      }
      this.snackbar.open("Export CSV descargado", "Cerrar", { duration: 2500 });
    } catch (err) {
      if (!current()) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo exportar el CSV", "Cerrar", { duration: 3500 });
    } finally {
      if (current()) this.exporting.set(false);
    }
  }

  importCsv(): void {
    const context = this.viewContext();
    this.dialog.open(CsvImportDialogComponent, { width: "min(720px, 94vw)", maxWidth: "94vw" })
      .afterClosed()
      .pipe(takeUntilDestroyed(this.dialogOwner))
      .subscribe((imported: unknown) => {
        if (this.viewContext() !== context) return;
        // Backdrop/navigation closes carry no count. Refresh conservatively:
        // a completed import must not leave the library stale in that case.
        if (imported === undefined || (typeof imported === "number" && imported > 0)) void this.reload();
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
    if (this.workspaces.currentId() === null) return;
    const context = this.viewContext();
    if (this.collectionLoad?.context === context) return this.collectionLoad.promise;
    const request = this.collectionRequests.begin(context);
    const promise = (async () => {
      try {
        const res = await this.api.get("/api/v1/collections", undefined, decodeCollectionsResponse, { signal: request.signal });
        if (this.collectionRequests.isCurrent(request, this.viewContext())) this.collections.set(res.collections);
      } catch {
        if (this.collectionRequests.isCurrent(request, this.viewContext())) this.collections.set([]);
      }
    })();
    this.collectionLoad = { context, promise };
    try {
      await promise;
    } finally {
      // An old completion must not release a new context's pending read.
      if (this.collectionLoad?.promise === promise) this.collectionLoad = null;
    }
  }

  copy(url: string): void { this.copyFeedback.copy(url, this.copyScope); }

  showQr(url: string, linkId?: number): void {
    this.dialog.open(QrDialogComponent, { data: { url, linkId }, width: "760px", maxWidth: "calc(100vw - 32px)" });
  }

  openQrDesigns(): void {
    this.dialog.open(QrDialogComponent, { data: { url: this.links()[0]?.shortUrl ?? "https://uvh.es/", library: true }, width: "820px", maxWidth: "calc(100vw - 24px)" });
  }
  async exportSelectedQr(): Promise<void> {
    if (this.qrSnapshotBusy()) return;
    const ids = [...this.selected()];
    if (!ids.length || ids.length > 100) { this.error.set("Selecciona entre 1 y 100 enlaces para exportar sus QR."); return; }
    const request = this.qrRequests.begin(this.viewContext()); this.qrSnapshotBusy.set(true);
    try {
      const links = await this.qrLibrary.snapshot(ids, { signal: request.signal });
      if (!this.qrRequests.isCurrent(request, this.viewContext())) return;
      this.dialog.open(QrDialogComponent, { data: { url: links[0].shortUrl, links }, width: "820px", maxWidth: "calc(100vw - 24px)" });
    } catch (error) { if (this.qrRequests.isCurrent(request, this.viewContext())) this.error.set(error instanceof Error ? error.message : "No se pudo preparar la selección."); }
    finally { if (this.qrRequests.isCurrent(request, this.viewContext())) this.qrSnapshotBusy.set(false); }
  }

  create(): void {
    this.linkDialog.openCreate("", this.dialogOwner).subscribe((created) => {
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
    this.linkDialog.openEdit(link, this.dialogOwner).subscribe((updated) => {
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
      this.selected.update(ids => { const next = new Set(ids); next.delete(link.id); return next; });
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

    const context = this.viewContext();
    this.pendingAutoHandled = true;
    this.pendingClaimInFlight = true;
    try {
      const pending = await this.intents.claim();
      if (!pending || this.dialogOwner.destroyed || context !== this.viewContext()) return;
      this.pendingDialogOpen = true;
      this.linkDialog.openCreate(pending.destination, this.dialogOwner).subscribe((created) => {
        this.pendingDialogOpen = false;
        if (!created || this.dialogOwner.destroyed || context !== this.viewContext()) return;
        void this.intents.complete();
        void this.router.navigate(["/app/links", created.id]);
      });
    } catch (err) {
      if (this.dialogOwner.destroyed || context !== this.viewContext()) return;
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
