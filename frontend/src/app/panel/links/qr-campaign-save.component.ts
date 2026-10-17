import { UI_TEXT } from "../../core/localisation/template-messages";
import { Component, ChangeDetectionStrategy, input, output, signal, computed, inject, effect, DestroyRef } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatInputModule } from "@angular/material/input";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatButtonModule } from "@angular/material/button";
import { QrLibraryService, type QrVariant } from "../../core/services/qr-library.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { SessionContextService } from "../../core/services/session-context.service";
import { validateQrDesign, type QrDesignSpec } from "../../core/services/qr-design";

@Component({
  selector: "app-qr-campaign-save", standalone: true, imports: [FormsModule, MatInputModule, MatFormFieldModule, MatButtonModule], changeDetection: ChangeDetectionStrategy.OnPush,
  template: `@if (canWrite()) { <section aria-label="Guardar QR de campaña" i18n-aria-label="@@ui.bd13b368804025"><h3>{{ variant() ? uiText.ui_f95101381ecb30 : uiText.ui_a90fb7659f13c6 }}</h3><p>{{ variant() ? uiText.ui_b7442b4275d5a3 : uiText.ui_9bbe46796763c5 }}</p>
    <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label><ng-container i18n="@@ui.6c95929146555b">Nombre de campaña</ng-container></mat-label><input matInput maxlength="80" [ngModel]="name()" (ngModelChange)="name.set($event)" [disabled]="busy() || disabled()" /></mat-form-field>
    <button mat-flat-button (click)="save()" [disabled]="busy() || disabled() || created() || !name().trim()">{{ busy() ? uiText.ui_3c8dc4dc7a83dd : variant() ? uiText.ui_08732b71e109ce : uiText.ui_eb851481ca15b9 }}</button>
    @if (message()) { <p role="status">{{ message() }}</p> } @if (error()) { <p class="error" role="alert">{{ error() }}</p> }
  </section> }`,
  styles: [`section{display:flex;flex-direction:column;gap:12px;padding:18px 0;border-top:1px solid var(--uvh-border)}h3{font-size:14px;margin:0;color:var(--uvh-ink)}p{font-size:12px;color:var(--uvh-muted);line-height:1.6;margin:0}.error{color:var(--uvh-danger)}mat-form-field{width:100%}`],
})
export class QrCampaignSaveComponent {
  readonly uiText = UI_TEXT;
  private readonly library = inject(QrLibraryService);
  private readonly workspace = inject(WorkspaceService);
  private readonly session = inject(SessionContextService);
  private readonly destroy = inject(DestroyRef);
  readonly linkId = input.required<number>(); readonly spec = input.required<QrDesignSpec>(); readonly file = input<File | null>(null);
  readonly variant = input<QrVariant | null>(null); readonly disabled = input(false); readonly saved = output<QrVariant>(); readonly working = output<boolean>();
  readonly name = signal(""); readonly busy = signal(false); private readonly savedSignature = signal<string | null>(null);
  readonly created = computed(() => this.savedSignature() === JSON.stringify([this.name().trim(), this.spec()])); readonly message = signal<string | null>(null); readonly error = signal<string | null>(null);
  readonly canWrite = computed(() => ["owner", "admin", "editor"].includes(this.workspace.currentRole() ?? ""));
  private retry: { signature: string; file: File | null; key: string; uploadKey: string; assetId?: number } | null = null;
  constructor() { effect(() => this.working.emit(this.busy())); effect(() => { const variant = this.variant(); if (variant && !this.name()) this.name.set(variant.name); }); }
  private context(): string { return JSON.stringify([this.workspace.currentId(), this.workspace.selectionGeneration(), this.workspace.currentRole(), this.session.user()?.id, this.session.generation()]); }
  async save(): Promise<void> {
    if (!this.canWrite() || this.busy() || this.disabled() || this.created()) return;
    const context = this.context(), current = () => !this.destroy.destroyed && context === this.context();
    const variant = this.variant(), file = this.file();
    this.busy.set(true); this.error.set(null);
    try {
      const spec = validateQrDesign(this.spec()), name = this.name().trim() || variant?.name || "";
      const signature = JSON.stringify([this.linkId(), name, spec, file?.name, file?.size, file?.lastModified]);
      if (this.retry?.signature !== signature || this.retry.file !== file) this.retry = { signature, file, key: crypto.randomUUID(), uploadKey: crypto.randomUUID() };
      const retry = this.retry;
      if (spec.logo.kind === "custom" && spec.logo.assetId === null) {
        if (!file) throw new Error($localize`:@@ui.25fb28d3982a25:Elige tu logo antes de guardar la campaña.`);
        const assetId = retry.assetId ?? await this.library.upload(file, retry.uploadKey);
        if (!current()) return; retry.assetId = assetId; spec.logo = { kind: "custom", assetId };
      }
      const row = variant ? await this.library.updateVariant(variant, { name, spec }) : await this.library.createVariant(this.linkId(), name, spec, retry.key);
      if (!current()) return;
      this.retry = null; this.savedSignature.set(JSON.stringify([row.name, row.spec])); this.message.set($localize`:@@ui.e202dda0d56e7c:Campaña guardada. El QR de la vista previa ya incluye su identificador.`); this.saved.emit(row);
    } catch (error) { if (current()) this.error.set(error instanceof Error ? error.message : $localize`:@@ui.2fedeffca55d52:No se pudo guardar la campaña.`); }
    finally { if (current()) this.busy.set(false); }
  }
}
