import { ChangeDetectionStrategy, Component, computed, effect, inject, input, signal, DestroyRef } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatDialog } from "@angular/material/dialog";
import { QrLibraryService, type QrComparison, type QrVariant } from "../../core/services/qr-library.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { SessionContextService } from "../../core/services/session-context.service";
import { QrDialogComponent } from "./qr-dialog.component";
import { LatestRequest } from "../../core/services/latest-request";

@Component({
  selector: "app-qr-campaign-panel", standalone: true, imports: [FormsModule, MatButtonModule, MatIconModule], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `<section class="campaign-panel" aria-labelledby="campaign-heading"><div class="campaign-heading"><div><h2 id="campaign-heading">QR de campaña</h2><p>Un enlace, varios QR. Compara las visitas de cada ubicación o iniciativa.</p></div>@if (canWrite()) { <button mat-stroked-button (click)="create()"><mat-icon>add</mat-icon>Crear campaña</button> }</div>
    <div class="campaign-period"><label>Desde <input type="date" [ngModel]="from()" (ngModelChange)="from.set($event)" /></label><label>Hasta <input type="date" [ngModel]="to()" (ngModelChange)="to.set($event)" /></label><button mat-button (click)="load()" [disabled]="busy()">Comparar</button></div>
    @if (busy()) { <p role="status">Cargando visitas…</p> }
    @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
    @if (comparison(); as data) {
      <div class="campaign-totals"><span><b>{{ data.attributedVisits }}</b> visitas atribuidas</span><span><b>{{ data.unattributedVisits }}</b> visitas sin atribución</span></div>
      @if (!data.variants.length) { <div class="campaign-empty"><mat-icon aria-hidden="true">qr_code_2</mat-icon><p>Aún no hay variantes. Crea una para tu escaparate, un folleto o una campaña.</p></div> }
      @for (variant of data.variants; track variant.id) {
        <article class="campaign-row"><div><strong>{{ variant.name }}</strong><small>{{ variant.archived ? 'Archivada · el QR sigue funcionando' : 'Campaña activa' }}</small></div><div class="variant-visits"><b>{{ variant.visits }}</b><span>visitas · {{ variant.attributedPercentage === null ? 'Sin atribución todavía' : variant.attributedPercentage + '% de las atribuidas' }}</span></div>
          <div class="campaign-actions"><button mat-stroked-button (click)="open(variant)"><mat-icon>qr_code_2</mat-icon>Ver QR</button>@if (canWrite()) { <button mat-button (click)="open(variant, true)">Actualizar diseño</button><button mat-button (click)="archive(variant)" [disabled]="mutationBusy()">{{ variant.archived ? 'Reactivar' : 'Archivar' }}</button> }</div>
        </article>
      }
      @if (data.variants.length) {
        <details class="campaign-series"><summary>Serie diaria · UTC</summary><div class="series-scroll"><table><thead><tr><th scope="col">Fecha</th>@for (variant of data.variants; track variant.id) { <th scope="col">{{ variant.name }}</th> }<th scope="col">Sin atribución</th></tr></thead><tbody>@for (point of data.series; track point.day) { <tr><th scope="row">{{ point.day }}</th>@for (variant of point.variants; track variant.id) { <td>{{ variant.visits === null ? 'Sin datos' : variant.visits }}</td> }<td>{{ point.unattributed === null ? 'Sin datos' : point.unattributed }}</td></tr> }</tbody></table></div></details>
      }
      <p class="campaign-note">Las visitas son redirecciones registradas, no escaneos físicos comprobados ni personas distintas. Los datos pueden tardar unos instantes en actualizarse. Las fechas sin datos se muestran separadamente.</p>
    }
  </section>`,
  styles: [`:host{display:block}.campaign-panel{padding:24px;border:1px solid var(--uvh-border);background:var(--uvh-surface);border-radius:8px;min-width:0}.campaign-heading{display:flex;align-items:start;justify-content:space-between;gap:20px}h2{font-size:20px;letter-spacing:-.03em;margin:0 0 8px;color:var(--uvh-ink)}p{font-size:13px;line-height:1.6;color:var(--uvh-muted);margin:0}.campaign-period{display:flex;flex-wrap:wrap;gap:12px;align-items:center;margin:20px 0}.campaign-period label{display:flex;flex-direction:column;gap:5px;font-size:12px;color:var(--uvh-muted)}input{font:inherit;color:var(--uvh-ink);background:var(--uvh-bg);border:1px solid var(--uvh-border);padding:8px;border-radius:4px;min-width:0}.campaign-totals{display:flex;gap:24px;flex-wrap:wrap;padding-bottom:18px;color:var(--uvh-muted);font-size:12px}.campaign-totals b{color:var(--uvh-ink);font-size:22px;margin-right:5px}.campaign-row{display:grid;grid-template-columns:minmax(0,1fr) auto;gap:14px;padding:18px 0;border-top:1px solid var(--uvh-border)}.campaign-row strong{color:var(--uvh-ink);font-size:14px;overflow-wrap:anywhere}.campaign-row small{display:block;margin-top:5px;color:var(--uvh-muted);font-size:11px}.variant-visits{display:flex;flex-direction:column;align-items:end;gap:4px;color:var(--uvh-ink)}.variant-visits span{color:var(--uvh-muted);font-size:11px}.campaign-actions{display:flex;flex-wrap:wrap;gap:6px;grid-column:1/-1}.campaign-empty{display:flex;gap:12px;padding:20px 0;color:var(--uvh-muted)}.campaign-note{margin-top:18px;font-size:11px}.campaign-series{border-top:1px solid var(--uvh-border);padding-top:16px}.campaign-series summary{cursor:pointer;color:var(--uvh-ink);font-size:13px}.series-scroll{overflow-x:auto;margin-top:12px}table{border-collapse:collapse;font-size:12px;width:100%;color:var(--uvh-ink)}th,td{padding:8px 12px;text-align:left;border-bottom:1px solid var(--uvh-border);white-space:nowrap}.error{color:var(--uvh-danger)}input:focus-visible,summary:focus-visible{outline:2px solid var(--uvh-electric);outline-offset:2px}@media(max-width:600px){.campaign-panel{padding:16px}.campaign-heading{flex-direction:column}.campaign-row{grid-template-columns:1fr}.variant-visits{align-items:start}}`],
})
export class QrCampaignPanelComponent {
  readonly linkId = input.required<number>(); readonly url = input.required<string>();
  private readonly library = inject(QrLibraryService); private readonly dialog = inject(MatDialog);
  private readonly workspace = inject(WorkspaceService); private readonly session = inject(SessionContextService);
  private readonly destroy = inject(DestroyRef); private readonly requests = new LatestRequest(this.destroy);
  readonly comparison = signal<QrComparison | null>(null); readonly busy = signal(false); readonly error = signal<string | null>(null); readonly mutationBusy = signal(false);
  readonly from = signal(new Date(Date.now() - 29 * 86400000).toISOString().slice(0, 10)); readonly to = signal(new Date().toISOString().slice(0, 10));
  readonly canWrite = computed(() => ["owner", "admin", "editor"].includes(this.workspace.currentRole() ?? ""));
  private context(): string { return JSON.stringify([this.linkId(), this.workspace.currentId(), this.workspace.selectionGeneration(), this.workspace.currentRole(), this.session.user()?.id, this.session.generation()]); }
  constructor() { effect(() => { this.context(); this.requests.invalidate(); this.comparison.set(null); this.mutationBusy.set(false); void this.load(); }); }
  async load(): Promise<void> {
    const request = this.requests.begin(this.context()); this.busy.set(true); this.error.set(null);
    try {
      const data = await this.library.comparison(this.linkId(), this.from(), this.to(), { signal: request.signal });
      if (this.requests.isCurrent(request, this.context())) this.comparison.set(data);
    } catch (error) { if (this.requests.isCurrent(request, this.context())) this.error.set(error instanceof Error ? error.message : "No se pudo cargar la comparación."); }
    finally { if (this.requests.isCurrent(request, this.context())) this.busy.set(false); }
  }
  create(): void { if (!this.canWrite()) return; const context = this.context(); this.dialog.open(QrDialogComponent, { data: { url: this.url(), linkId: this.linkId(), campaign: true }, width: "820px", maxWidth: "calc(100vw - 24px)" }).afterClosed().subscribe(() => { if (!this.destroy.destroyed && this.context() === context) void this.load(); }); }
  open(variant: QrVariant, edit = false): void {
    const url = new URL(this.url()); url.searchParams.set("qr", variant.publicId);
    const context = this.context();
    this.dialog.open(QrDialogComponent, { data: { url: url.toString(), linkId: this.linkId(), initialDesign: variant.spec, variant: edit ? variant : null, campaign: edit }, width: "820px", maxWidth: "calc(100vw - 24px)" }).afterClosed().subscribe(() => { if (!this.destroy.destroyed && this.context() === context) void this.load(); });
  }
  async archive(variant: QrVariant): Promise<void> {
    if (!this.canWrite() || this.mutationBusy()) return;
    const context = this.context(); this.mutationBusy.set(true);
    try { await this.library.updateVariant(variant, { archived: !variant.archived }); if (!this.destroy.destroyed && context === this.context()) await this.load(); }
    catch (error) { if (!this.destroy.destroyed && context === this.context()) this.error.set(error instanceof Error ? error.message : "No se pudo cambiar el estado."); }
    finally { if (!this.destroy.destroyed && context === this.context()) this.mutationBusy.set(false); }
  }
}
