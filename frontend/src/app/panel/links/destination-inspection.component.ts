import { ChangeDetectionStrategy, Component, DestroyRef, effect, inject, input, output, signal } from "@angular/core";
import { DatePipe } from "@angular/common";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { DestinationInspectionService } from "../../core/services/destination-inspection.service";
import { LinkWorkflowService } from "../../core/services/link-workflow.service";
import { LatestRequest } from "../../core/services/latest-request";
import type { DestinationResult } from "../../core/link-workflows";
import type { LinkDto } from "../../core/models";

@Component({ selector: "app-destination-inspection", standalone: true, imports: [DatePipe, MatButtonModule, MatIconModule],
  template: `@if (workflows.enabled()) {
    <section class="destination-inspector" [class.preview]="preview()" aria-label="Información del destino">
      <div class="inspection-top">
        <div><h3>{{ preview() ? 'Vista previa del destino' : 'Disponibilidad del destino' }}</h3>
        <p>{{ preview() ? 'UVH consultará este sitio para obtener su título e icono.' : 'Comprueba la respuesta del destino principal sin abrir el enlace corto.' }}</p></div>
        <button mat-stroked-button type="button" [disabled]="busy() || !validUrl()" (click)="check()" [attr.aria-busy]="busy()">
          <mat-icon [class.spinning]="busy()" aria-hidden="true">{{ busy() ? 'progress_activity' : preview() ? 'preview' : 'network_check' }}</mat-icon>
          {{ busy() ? 'Comprobando…' : result() ? 'Volver a comprobar' : preview() ? 'Mostrar vista previa' : 'Comprobar destino' }}
        </button>
      </div>
      @if (error()) { <p class="inspection-error" role="alert">{{ error() }}</p> }
      @if (result(); as info) {
        <div class="inspection-result" [class.reachable]="info.status === 'reachable'" aria-live="polite">
          <span class="site-icon">@if (icon()) { <img [src]="icon()" alt="" width="32" height="32" /> } @else { <mat-icon aria-hidden="true">{{ statusIcon(info.status) }}</mat-icon> }</span>
          <div class="site-summary">@if (preview() && info.title) { <strong>{{ info.title }}</strong> }
            <span class="site-domain">{{ info.domain }}</span><span class="status-label">{{ statusLabel(info.status) }}@if (info.httpStatus) { <span class="http-code">HTTP {{ info.httpStatus }}</span> }</span>
            <small>Comprobado {{ info.checkedAt | date:'dd/MM/yyyy HH:mm' }}</small>
          </div>
        </div>
        @if (preview() && suggestName() && info.title) { <button mat-stroked-button class="use-title" type="button" (click)="useTitle()"><mat-icon aria-hidden="true">label_outline</mat-icon>Usar como nombre</button> }
        <p class="inspection-footnote">{{ info.status === 'restricted' ? 'El sitio puede requerir acceso o limitar las consultas automáticas.' : 'El resultado se reutiliza durante 10 minutos. Describe la respuesta del sitio; no certifica su seguridad.' }}</p>
      }
    </section>
  }`,
  styles: [`:host{display:block;min-width:0}.destination-inspector{padding:22px 0;border-top:1px solid var(--uvh-border)}.inspection-top{display:flex;align-items:center;justify-content:space-between;gap:20px}h3{margin:0 0 6px;font-size:15px;font-weight:700}p{margin:0;font-size:13px;line-height:1.6;color:var(--uvh-muted)}button{flex-shrink:0;min-height:44px}.inspection-result{display:flex;gap:14px;align-items:center;margin-top:18px;padding:18px;border:1px solid var(--uvh-border);border-radius:16px;background:var(--uvh-surface-raised);animation:inspection-reveal .18s ease-out}.site-icon{display:grid;place-items:center;width:48px;height:48px;border-radius:13px;background:var(--uvh-surface);flex-shrink:0}.site-icon img{object-fit:contain}.site-summary{display:flex;flex-direction:column;gap:5px;min-width:0}.site-summary strong,.site-domain{overflow-wrap:anywhere}.site-summary strong{font-size:14px}.site-domain{font-size:13px;color:var(--uvh-muted)}.status-label{display:flex;align-items:center;gap:10px;font-size:13px;font-weight:650}.http-code{font-size:11px;font-weight:500;color:var(--uvh-muted)}small{font-size:11px;color:var(--uvh-muted)}.use-title{margin-top:12px}.inspection-footnote{font-size:12px;margin-top:10px}.inspection-error{color:var(--uvh-danger);margin-top:12px}.reachable .site-icon{color:var(--uvh-success)}.spinning{animation:inspection-spin 1s linear infinite}@keyframes inspection-spin{to{transform:rotate(360deg)}}@keyframes inspection-reveal{from{opacity:0;transform:translateY(3px)}to{opacity:1;transform:none}}@media(max-width:600px){.inspection-top{align-items:flex-start;flex-direction:column;gap:12px}.inspection-top button{width:100%}}@media(prefers-reduced-motion:reduce){.inspection-result,.spinning{animation:none}}`],
  changeDetection: ChangeDetectionStrategy.Eager })
export class DestinationInspectionComponent {
  readonly suggestName = input(false);
  readonly nameSuggested = output<{ title: string; url: string }>();
  useTitle(): void {
    const title = this.result()?.title;
    if (title && this.preview() && this.suggestName() && !this.busy()) this.nameSuggested.emit({ title, url: this.url() });
  }
  readonly url = input(""); readonly link = input<LinkDto | null>(null); readonly preview = input(false);
  readonly workflows = inject(LinkWorkflowService);
  private readonly service = inject(DestinationInspectionService);
  private readonly owner = inject(DestroyRef);
  private readonly requests = new LatestRequest(this.owner);
  readonly result = signal<DestinationResult | null>(null); readonly busy = signal(false); readonly error = signal<string | null>(null); readonly icon = signal<string | null>(null);
  private loadedContext: string | null = null;
  constructor() {
    effect(() => { const context = this.context(); if (context === this.loadedContext) return; this.loadedContext = context; this.requests.invalidate(); this.releaseIcon(); this.result.set(null); this.error.set(null); this.busy.set(false); });
    this.owner.onDestroy(() => this.releaseIcon());
  }
  private context(): string { return JSON.stringify([this.workflows.context(), this.workflows.enabled(), this.url(), this.link()?.id, this.link()?.version, this.link()?.destination, this.preview()]); }
  private releaseIcon(): void { const icon = this.icon(); if (icon) URL.revokeObjectURL(icon); this.icon.set(null); }
  validUrl(): boolean { try { const u = new URL(this.link()?.destination ?? this.url()); return /^(https?:)$/.test(u.protocol) && !u.username && !u.password; } catch { return false; } }
  async check(): Promise<void> {
    if (this.busy() || !this.validUrl() || !this.workflows.enabled()) return;
    const request = this.requests.begin(this.context()); this.busy.set(true); this.error.set(null); this.result.set(null); this.releaseIcon();
    const current = () => this.requests.isCurrent(request, this.context());
    try {
      const link = this.link();
      const inspection = await this.service.inspect(link && !this.preview() ? { linkId: link.id, linkVersion: link.version } : { url: this.url() }, request.signal);
      if (!current()) return; this.result.set(inspection.result);
      if (inspection.result?.iconUrl && this.preview()) {
        try { const blob = await this.service.icon(inspection.result.iconUrl, request.signal); if (current()) this.icon.set(URL.createObjectURL(blob)); } catch { /* An unavailable icon never hides the destination result. */ }
      }
    } catch (error) { if (current()) this.error.set(error instanceof Error ? error.message : "No se pudo consultar este sitio."); }
    finally { if (current()) this.busy.set(false); }
  }
  statusLabel(status: DestinationResult["status"]): string { return { reachable: "El destino responde", restricted: "Acceso restringido", http_error: "El sitio devuelve un error", network_error: "No se pudo conectar", not_checkable: "Destino no comprobable" }[status]; }
  statusIcon(status: DestinationResult["status"]): string { return { reachable: "check_circle", restricted: "lock", http_error: "error_outline", network_error: "wifi_off", not_checkable: "info" }[status]; }
}
