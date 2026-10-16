import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, inject, signal } from "@angular/core";
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatTooltipModule } from "@angular/material/tooltip";
import { MatSelectModule } from "@angular/material/select";
import { MatFormFieldModule } from "@angular/material/form-field";
import type { LinkHistoryComparison, LinkHistoryEntry, LinkHistoryResponse } from "../../core/models";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { decodeLinkHistoryComparison, decodeLinkHistoryResponse } from "../../core/services/link-history-response-decoders";
import { ActionDialogService } from "../action-dialog.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";

export interface LinkHistoryDialogData { linkId: number; expectedVersion: number; canRestore: boolean; }
type HistoryChange = LinkHistoryComparison["changes"][number];

@Component({
  selector: "app-link-history-dialog",
  standalone: true,
  imports: [DatePipe, MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule, MatTooltipModule, MatSelectModule, MatFormFieldModule],
  templateUrl: "./link-history-dialog.component.html",
  styleUrl: "./link-history-dialog.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class LinkHistoryDialogComponent {
  private readonly api = inject(ApiService);
  private readonly actions = inject(ActionDialogService);
  private readonly ref = inject(MatDialogRef<LinkHistoryDialogComponent>);
  private readonly auth = inject(AuthService);
  private readonly workspaces = inject(WorkspaceService);
  readonly data = inject<LinkHistoryDialogData>(MAT_DIALOG_DATA);
  private readonly openedContext = this.contextKey();
  readonly versions = signal<LinkHistoryEntry[]>([]);
  readonly page = signal(1);
  readonly lastPage = signal(1);
  readonly selectedFrom = signal<number | null>(null);
  readonly selectedTo = signal<number | null>(null);
  readonly comparison = signal<LinkHistoryComparison | null>(null);
  readonly loading = signal(true);
  readonly comparing = signal(false);
  readonly restoring = signal(false);
  readonly error = signal<string | null>(null);
  readonly source = signal<LinkHistoryEntry["source"] | "all">("all");
  private loadRequest = 0;
  private compareRequest = 0;

  constructor() { void this.load(); }

  private contextKey(): string {
    return JSON.stringify([this.auth.user()?.id ?? null, this.auth.sessionGeneration(), this.workspaces.currentId(), this.workspaces.selectionGeneration(), this.workspaces.currentRole()]);
  }

  private contextStillValid(): boolean { return this.openedContext === this.contextKey(); }

  async load(page = this.page()): Promise<void> {
    const request = ++this.loadRequest;
    ++this.compareRequest;
    this.loading.set(true); this.error.set(null);
    try {
      const result = await this.api.get<LinkHistoryResponse>(`/api/v1/links/${this.data.linkId}/history`, { page, perPage: 20, ...(this.source() === "all" ? {} : { source: this.source() }) }, decodeLinkHistoryResponse);
      if (request !== this.loadRequest) return;
      if (!this.contextStillValid()) { this.ref.close(false); return; }
      this.versions.set(result.versions); this.page.set(result.page); this.lastPage.set(result.lastPage);
      if (this.versions().length >= 2 && this.selectedFrom() === null) {
        this.selectedFrom.set(this.versions()[1].revision); this.selectedTo.set(this.versions()[0].revision); await this.compare();
      }
    } catch (error) { this.error.set(error instanceof ApiRequestError ? error.message : "No se pudo cargar el historial"); }
    finally { if (request === this.loadRequest) this.loading.set(false); }
  }

  async setSource(value: LinkHistoryEntry["source"] | "all"): Promise<void> {
    this.source.set(value);
    this.page.set(1);
    this.selectedFrom.set(null); this.selectedTo.set(null); this.comparison.set(null);
    await this.load(1);
  }

  select(revision: number): void {
    ++this.compareRequest;
    if (this.selectedFrom() === revision) this.selectedFrom.set(null);
    else if (this.selectedTo() === revision) this.selectedTo.set(null);
    else if (this.selectedFrom() === null) this.selectedFrom.set(revision);
    else this.selectedTo.set(revision);
    if (this.selectedFrom() !== null && this.selectedTo() !== null) void this.compare();
    else this.comparison.set(null);
  }

  async compare(): Promise<void> {
    const from = this.selectedFrom(), to = this.selectedTo();
    if (from === null || to === null || from === to) return;
    if (!this.contextStillValid()) { this.ref.close(false); return; }
    const request = ++this.compareRequest;
    this.comparing.set(true); this.error.set(null);
    try {
      const result = await this.api.get<LinkHistoryComparison>(`/api/v1/links/${this.data.linkId}/history/compare`, { from, to }, decodeLinkHistoryComparison);
      if (request !== this.compareRequest) return;
      if (!this.contextStillValid()) { this.ref.close(false); return; }
      this.comparison.set(result);
    } catch (error) {
      if (request === this.compareRequest) this.error.set(error instanceof ApiRequestError ? error.message : "No se pudo comparar las versiones");
    }
    finally { if (request === this.compareRequest) this.comparing.set(false); }
  }

  async restore(version: LinkHistoryEntry): Promise<void> {
    if (!this.data.canRestore || this.restoring() || !this.contextStillValid()) return;
    const confirmed = await this.actions.confirm({
      title: `Restaurar revisión ${version.revision}`,
      message: "Se restaurará la configuración seleccionada. La URL corta, la contraseña actual, los clics y el estado de moderación se conservarán.",
      confirmLabel: "Restaurar configuración",
    });
    if (!confirmed) return;
    if (!this.contextStillValid()) { this.ref.close(false); return; }
    this.restoring.set(true); this.error.set(null);
    try {
      await this.api.post(`/api/v1/links/${this.data.linkId}/history/${version.revision}/restore`, { expectedVersion: this.data.expectedVersion }, undefined, { "Idempotency-Key": crypto.randomUUID() });
      if (!this.contextStillValid()) { this.ref.close(false); return; }
      this.ref.close(true);
    } catch (error) { this.error.set(error instanceof ApiRequestError ? error.message : "No se pudo restaurar la configuración"); }
    finally { this.restoring.set(false); }
  }

  sourceLabel(source: LinkHistoryEntry["source"]): string { return ({ create: "Creación", update: "Edición", duplicate: "Duplicación", restore: "Restauración", import: "Importación", bulk: "Edición masiva" })[source]; }
  fieldLabel(field: string): string { return ({ destination: "Destino", fallbackDestination: "Destino alternativo", rules: "Reglas", utm: "Campaña UTM", name: "Nombre", notes: "Notas", tags: "Etiquetas", collectionId: "Colección", maxClicks: "Límite de clics", singleUse: "Uso único", scheduledAt: "Activación", expiresAt: "Caducidad", expiredPage: "Página de caducidad", appOpening: "Abrir en una aplicación", socialPreview: "Tarjeta al compartir" })[field] ?? field; }
  fieldGroup(field: string): string {
    if (/^rules(?:\.|\[)/.test(field)) return "Reglas";
    if (field === "appOpening") return "Destino";
    if (field === "socialPreview") return "Tarjeta social";
    if (["destination", "fallbackDestination"].includes(field)) return "Destino";
    if (["maxClicks", "singleUse"].includes(field)) return "Acceso";
    if (["collectionId", "tags", "notes"].includes(field)) return "Organización";
    if (["utm"].includes(field)) return "Campaña";
    if (["scheduledAt", "expiresAt", "expiredPage"].includes(field)) return "Caducidad";
    return "Configuración";
  }
  changeGroups(changes: HistoryChange[]): Array<{ label: string; changes: HistoryChange[] }> {
    const groups = new Map<string, HistoryChange[]>();
    for (const change of changes) {
      const label = this.fieldGroup(change.field);
      const list = groups.get(label) ?? [];
      list.push(change); groups.set(label, list);
    }
    return [...groups.entries()].map(([label, grouped]) => ({ label, changes: grouped }));
  }
  changeKind(change: { before: unknown; after: unknown }): "added" | "removed" | "changed" {
    return change.before === null || change.before === undefined ? "added" : change.after === null || change.after === undefined ? "removed" : "changed";
  }
  ruleLabel(field: string): string {
    const match = /^rules\.(\d+)$/.exec(field);
    return match ? `Regla ${match[1]}` : this.fieldLabel(field);
  }
  changedLabels(entry: LinkHistoryEntry): string { return entry.changedFields.map((field) => this.fieldLabel(field)).join(" · "); }
  display(value: unknown): string {
    if (value === null || value === undefined || value === "") return "—";
    if (Array.isArray(value)) return value.map((item, index) => `#${index + 1} ${this.display(item)}`).join("\n");
    if (typeof value === "object") {
      const record = value as Record<string, unknown>;
      if ("imageAssetId" in record && typeof record["title"] === "string") {
        return [record["enabled"] ? "Personalización activada" : "Personalización desactivada", record["title"], record["description"], record["imageAssetId"] ? "Con imagen personalizada" : "Sin imagen", record["imageAlt"]].filter(Boolean).join("\n");
      }
      if (typeof record["destination"] === "string") return `prioridad ${String(record["priority"] ?? "—")} · ${record["destination"]}`;
      return JSON.stringify(value);
    }
    return String(value);
  }
  socialImageChanged(change: HistoryChange): boolean {
    if (change.field !== "socialPreview" || typeof change.before !== "object" || change.before === null || typeof change.after !== "object" || change.after === null) return false;
    return (change.before as Record<string,unknown>)["imageAssetId"] !== (change.after as Record<string,unknown>)["imageAssetId"];
  }
  close(): void { this.ref.close(false); }
}
