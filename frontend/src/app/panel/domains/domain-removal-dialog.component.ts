import { UI_TEXT } from "../../core/localisation/template-messages";
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, computed, effect, inject, signal, viewChild } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatPaginatorIntl, MatPaginatorModule, type PageEvent } from "@angular/material/paginator";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSelectModule } from "@angular/material/select";
import { MatTabsModule } from "@angular/material/tabs";
import type { DomainDto, LinkDto } from "../../core/models";
import type { DomainDeletionPreview, DomainReassignmentPreview } from "../../core/domain-management";
import { IdempotentIntent } from "../../core/idempotent-intent";
import { dateTimeMediumLabel } from "../../core/date-time-label";
import { linkStateLabel } from "../../core/link-state-label";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { LatestRequest } from "../../core/services/latest-request";
import { WorkspaceService } from "../../core/services/workspace.service";
import { SessionContextService } from "../../core/services/session-context.service";
import { decodeDomainDeletionPreview, decodeDomainReassignmentPreview, decodeDomainReassignmentResult } from "../../core/services/domain-management-decoders";
import { decodeDomainsResponse } from "../../core/services/domain-response-decoders";
import { decodeLinksResponse, decodeLinkTrashResponse } from "../../core/services/link-response-decoders";
import type { DomainRemovalDialogData, DomainRemovalDialogResult } from "./domain-removal-dialog.service";

interface Candidate { link: LinkDto; blocked: boolean; purgeAt: string | null }

function paginatorLabels(): MatPaginatorIntl {
  const labels = new MatPaginatorIntl();
  labels.itemsPerPageLabel = $localize`:@@ui.f0bb7ad3257fb1:Enlaces por página:`;
  labels.nextPageLabel = $localize`:@@ui.9dd6b398421db4:Página siguiente`; labels.previousPageLabel = $localize`:@@ui.9bcad734827a84:Página anterior`;
  labels.firstPageLabel = $localize`:@@ui.977c67cffa60e4:Primera página`; labels.lastPageLabel = $localize`:@@ui.9369fd17b8566b:Última página`;
  labels.getRangeLabel = (page, size, total) => total === 0 ? "0 de 0" : `${page * size + 1}–${Math.min((page + 1) * size, total)} de ${total}`;
  return labels;
}

@Component({
  selector: "app-domain-removal-dialog",
  standalone: true,
  providers: [{ provide: MatPaginatorIntl, useFactory: paginatorLabels }],
  imports: [FormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatIconModule, MatInputModule, MatPaginatorModule, MatProgressBarModule, MatSelectModule, MatTabsModule],
  templateUrl: "./domain-removal-dialog.component.html",
  styleUrl: "./domain-removal-dialog.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DomainRemovalDialogComponent {
  readonly uiText = UI_TEXT;
  readonly data = inject<DomainRemovalDialogData>(MAT_DIALOG_DATA);
  private readonly ref = inject<MatDialogRef<DomainRemovalDialogComponent, DomainRemovalDialogResult>>(MatDialogRef);
  private readonly api = inject(ApiService);
  private readonly workspaces = inject(WorkspaceService);
  private readonly session = inject(SessionContextService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly impactRequests = new LatestRequest(this.destroyRef);
  private readonly rowRequests = new LatestRequest(this.destroyRef);
  private readonly previewRequests = new LatestRequest(this.destroyRef);
  private readonly intents = new IdempotentIntent();
  private readonly ownerContext = this.context();
  private changed = false;
  private readonly previewHeading = viewChild<ElementRef<HTMLElement>>("previewHeading");
  private readonly impactHeading = viewChild<ElementRef<HTMLElement>>("impactHeading");
  private readonly selectionHeading = viewChild<ElementRef<HTMLElement>>("selectionHeading");
  private readonly operationError = viewChild<ElementRef<HTMLElement>>("operationError");

  readonly impact = signal<DomainDeletionPreview | null>(null);
  readonly domains = signal<DomainDto[]>([]);
  readonly loading = signal(true);
  readonly rowsLoading = signal(false);
  readonly managing = signal(false);
  readonly tab = signal(0);
  readonly q = signal("");
  readonly page = signal(0);
  readonly perPage = 20;
  readonly total = signal(0);
  readonly rows = signal<Candidate[]>([]);
  readonly selected = signal<ReadonlyMap<number, Candidate>>(new Map());
  readonly targetId = signal<number | null | undefined>(undefined);
  readonly preview = signal<DomainReassignmentPreview | null>(null);
  readonly busy = signal<"review" | "apply" | "delete" | null>(null);
  readonly uncertain = signal(false);
  readonly deleteConfirmation = signal(false);
  readonly error = signal<string | null>(null);
  readonly rowsError = signal<string | null>(null);
  readonly status = signal("");
  readonly targetOptions = computed(() => this.domains().filter((d) => d.id !== this.data.domainId && d.servingReady));
  readonly locked = computed(() => this.busy() !== null || this.uncertain());
  readonly stateLabel = linkStateLabel;
  readonly formatDate = dateTimeMediumLabel;

  constructor() {
    effect(() => { if (this.context() !== this.ownerContext) this.ref.close(); });
    void this.reload();
  }

  private context(): string {
    return `${this.workspaces.currentId()}:${this.workspaces.currentRole()}:${this.session.user()?.id ?? ""}:${this.session.generation()}`;
  }

  private current(): boolean {
    const role = this.workspaces.currentRole();
    return !this.destroyRef.destroyed && this.context() === this.ownerContext
      && this.workspaces.currentId() === this.data.workspaceId && (role === "owner" || role === "admin");
  }

  async reload(): Promise<void> {
    if (!this.current()) return;
    const request = this.impactRequests.begin(this.ownerContext);
    this.loading.set(true);
    this.impact.set(null);
    this.error.set(null);
    this.deleteConfirmation.set(false);
    try {
      const [impact, catalog] = await Promise.all([
        this.api.get(`/api/v1/domains/${this.data.domainId}/deletion-preview`, undefined, (value) => decodeDomainDeletionPreview(value, this.data.domainId), { signal: request.signal }),
        this.api.get("/api/v1/domains", undefined, (value) => decodeDomainsResponse(value, true), { signal: request.signal }),
      ]);
      if (!this.current() || !this.impactRequests.isCurrent(request, this.ownerContext)) return;
      if (impact.domain !== this.data.domain) throw new Error("Invalid domain context");
      this.impact.set(impact);
      this.domains.set(catalog.domains);
    } catch (error) {
      if (this.current() && this.impactRequests.isCurrent(request, this.ownerContext)) this.showError(error);
    } finally {
      if (this.current() && this.impactRequests.isCurrent(request, this.ownerContext)) this.loading.set(false);
    }
  }

  startManaging(): void {
    if (!this.current() || this.locked() || !this.impact()?.totalLinks) return;
    this.managing.set(true);
    this.focus("selection");
    void this.loadRows();
  }

  async loadRows(): Promise<void> {
    if (!this.current()) return;
    const tab = this.tab();
    const page = this.page() + 1;
    const key = `${this.ownerContext}:${tab}:${page}:${this.q()}`;
    const request = this.rowRequests.begin(key);
    this.rowsLoading.set(true);
    this.rowsError.set(null);
    const params = { domainId: this.data.domainId, q: this.q(), page, perPage: this.perPage };
    try {
      let candidates: Candidate[];
      let total: number;
      if (tab === 1) {
        const response = await this.api.get("/api/v1/links/trash", params, (value) => decodeLinkTrashResponse(value, params), { signal: request.signal });
        candidates = response.links.map((row) => ({ link: row.link, blocked: row.previousState === "blocked", purgeAt: row.purgeAt }));
        total = response.total;
      } else {
        const response = await this.api.get("/api/v1/links", params, (value) => decodeLinksResponse(value, params), { signal: request.signal });
        candidates = response.links.map((link) => ({ link, blocked: link.state === "blocked", purgeAt: null }));
        total = response.total;
      }
      if (!this.current() || !this.rowRequests.isCurrent(request, key)) return;
      if (candidates.some((row) => row.link.domainId !== this.data.domainId)) throw new Error("Invalid domain link context");
      this.rows.set(candidates);
      this.total.set(total);
    } catch (error) {
      if (this.current() && this.rowRequests.isCurrent(request, key)) {
        this.rows.set([]);
        this.rowsError.set(error instanceof ApiRequestError ? error.message : $localize`:@@ui.86ca4cbae4fc01:No se pudieron cargar los enlaces. Vuelve a intentarlo.`);
      }
    } finally {
      if (this.current() && this.rowRequests.isCurrent(request, key)) this.rowsLoading.set(false);
    }
  }

  changeTab(tab: number): void {
    if (this.locked()) return;
    this.tab.set(tab); this.page.set(0); void this.loadRows();
  }

  search(value: string): void {
    if (this.locked()) return;
    this.q.set(value.trim()); this.page.set(0); void this.loadRows();
  }

  paginate(event: PageEvent): void {
    if (this.locked()) return;
    this.page.set(event.pageIndex); void this.loadRows();
  }

  toggle(row: Candidate, checked: boolean): void {
    if (!this.current() || this.locked() || row.blocked) return;
    const selected = new Map(this.selected());
    if (checked && selected.size >= 100 && !selected.has(row.link.id)) return;
    if (checked) selected.set(row.link.id, row);
    else selected.delete(row.link.id);
    this.selected.set(selected);
    this.invalidatePreview();
  }

  changeTarget(value: number | null): void {
    if (!this.current() || this.locked()) return;
    this.targetId.set(value); this.invalidatePreview();
  }

  private invalidatePreview(): void {
    this.previewRequests.invalidate(); this.preview.set(null); this.error.set(null); this.status.set("");
  }

  async review(): Promise<void> {
    const targetId = this.targetId();
    const ids = [...this.selected().keys()].sort((a, b) => a - b);
    if (!this.current() || this.locked() || targetId === undefined || !ids.length) return;
    const request = this.previewRequests.begin(this.ownerContext);
    this.busy.set("review"); this.error.set(null); this.preview.set(null);
    try {
      const preview = await this.api.post(`/api/v1/domains/${this.data.domainId}/reassignment-preview`, { linkIds: ids, targetDomainId: targetId },
        (value) => decodeDomainReassignmentPreview(value, this.data.domainId, targetId, ids));
      if (!this.current() || !this.previewRequests.isCurrent(request, this.ownerContext)) return;
      this.preview.set(preview);
      this.status.set(preview.canApply ? $localize`:@@ui.00029b02b8f26c:Revisión preparada. Comprueba las URL antes de confirmar.` : $localize`:@@ui.1333bbb4d05eaf:Hay conflictos. Ajusta la selección o el destino y vuelve a revisar.`);
      this.focus("preview");
    } catch (error) {
      if (this.current() && this.previewRequests.isCurrent(request, this.ownerContext)) this.showError(error);
    } finally {
      if (this.current() && this.previewRequests.isCurrent(request, this.ownerContext)) this.busy.set(null);
    }
  }

  async apply(): Promise<void> {
    const preview = this.preview();
    if (!this.current() || this.busy() !== null || !preview?.canApply) return;
    const body = { linkIds: preview.links.map((row) => row.linkId), targetDomainId: preview.targetDomainId,
      expectedVersions: preview.links.map((row) => ({ id: row.linkId, version: row.version })) };
    this.busy.set("apply"); this.ref.disableClose = true; this.error.set(null);
    try {
      await this.intents.run(JSON.stringify(body), (key) => this.api.post(`/api/v1/domains/${this.data.domainId}/reassign`, body,
        (value) => decodeDomainReassignmentResult(value, preview), { "Idempotency-Key": key }));
      if (!this.current()) return;
      this.changed = true;
      this.uncertain.set(false); this.selected.set(new Map()); this.preview.set(null); this.targetId.set(undefined);
      this.status.set($localize`:@@ui.0c2a431c65855f:${preview.links.length} enlaces reasignados. Revisa los enlaces y QR que ya habías compartido.`);
      await Promise.all([this.reload(), this.loadRows()]);
      this.focus("impact");
    } catch (error) {
      if (!this.current()) return;
      const status = error instanceof ApiRequestError ? error.status : 0;
      this.uncertain.set(status === 0 || status >= 500);
      if (!this.uncertain()) this.preview.set(null);
      this.showError(error);
    } finally {
      if (this.current()) { this.busy.set(null); this.ref.disableClose = false; }
    }
  }

  async remove(): Promise<void> {
    if (!this.current() || this.locked() || !this.impact()?.canDelete || !this.deleteConfirmation()) return;
    this.busy.set("delete"); this.ref.disableClose = true; this.error.set(null);
    try {
      await this.api.delete(`/api/v1/domains/${this.data.domainId}`, undefined, (value) => {
        if (typeof value !== "object" || value === null || !("ok" in value) || value.ok !== true) throw new Error("Invalid domain deletion response");
        return true;
      });
      if (this.current()) this.ref.close({ deleted: true, changed: true });
    } catch (error) {
      if (!this.current()) return;
      // A lost DELETE response is reconciled by a scoped read, never another
      // unreviewed delete. A 404 means this workspace no longer has the row.
      if (error instanceof ApiRequestError && (error.status === 0 || error.status >= 500)) {
        try {
          await this.api.get(`/api/v1/domains/${this.data.domainId}/deletion-preview`, undefined,
            (value) => decodeDomainDeletionPreview(value, this.data.domainId));
        } catch (probe) {
          if (this.current() && probe instanceof ApiRequestError && probe.status === 404) {
            this.ref.close({ deleted: true, changed: true }); return;
          }
        }
      }
      await this.reload();
      if (this.current()) this.showError(error);
    } finally {
      if (this.current()) { this.busy.set(null); this.ref.disableClose = false; }
    }
  }

  private showError(error: unknown): void {
    this.error.set(error instanceof ApiRequestError ? error.message : $localize`:@@ui.1f289ae0d2a67e:No se pudo completar la operación. Vuelve a intentarlo.`);
    this.focus("error");
  }

  private focus(section: "preview" | "impact" | "selection" | "error"): void {
    setTimeout(() => {
      if (!this.current()) return;
      const heading = section === "preview" ? this.previewHeading() : section === "impact" ? this.impactHeading()
        : section === "selection" ? this.selectionHeading() : this.operationError();
      heading?.nativeElement.focus();
    });
  }

  close(): void {
    if (this.busy() === null) this.ref.close({ deleted: false, changed: this.changed });
  }
}
