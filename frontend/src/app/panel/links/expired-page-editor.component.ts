import { ChangeDetectionStrategy, Component, computed, input, model, signal } from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatExpansionModule } from "@angular/material/expansion";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { defaultExpiredPage, type ExpiredPageSpec, type LinkNoticeContent } from "../../core/link-workflows";

export function validExpiredPage(spec: ExpiredPageSpec): boolean {
  return [spec.expired, spec.exhausted].every(content => {
    if (!content.title.trim() || !content.message.trim() || Array.from(content.title).length > 80 || Array.from(content.message).length > 500
      || Array.from(content.buttonLabel).length > 40 || /[<>\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/.test(content.title + content.message + content.buttonLabel)
      || /[\r\n\t]/.test(content.title + content.buttonLabel) || Boolean(content.buttonLabel.trim()) !== Boolean(content.buttonUrl)) return false;
    if (content.buttonUrl) { try { const u = new URL(content.buttonUrl); if (content.buttonUrl.length > 2048 || !/^https?:$/.test(u.protocol) || u.username || u.password || /[\s\\]/.test(content.buttonUrl)) return false; } catch { return false; } }
    return true;
  });
}
@Component({ selector: "app-expired-page-editor", standalone: true,
  imports: [FormsModule, MatButtonModule, MatIconModule, MatExpansionModule, MatFormFieldModule, MatInputModule, MatCheckboxModule],
  template: `<mat-expansion-panel class="notice-settings">
    <mat-expansion-panel-header><mat-panel-title><mat-icon aria-hidden="true">web</mat-icon>Página de enlace no disponible</mat-panel-title></mat-expansion-panel-header>
    <p class="settings-intro">Decide qué verá quien abra el enlace cuando caduque o agote sus usos.</p>
    <mat-checkbox [ngModel]="spec().enabled" [ngModelOptions]="{standalone:true}" (ngModelChange)="enable($event)">Personalizar esta página</mat-checkbox>
    @if (spec().enabled) {
      <div class="reason-switch" role="group" aria-label="Motivo de indisponibilidad">
        <button mat-button type="button" [class.chosen]="reason() === 'expired'" [attr.aria-pressed]="reason() === 'expired'" (click)="reason.set('expired')">Por caducidad</button>
        <button mat-button type="button" [class.chosen]="reason() === 'exhausted'" [attr.aria-pressed]="reason() === 'exhausted'" (click)="reason.set('exhausted')">Por agotamiento</button>
      </div>
      <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Título</mat-label><input matInput [ngModelOptions]="{standalone:true}" [ngModel]="content().title" (ngModelChange)="change('title',$event)" maxlength="160" /><mat-hint>Hasta 80 caracteres.</mat-hint></mat-form-field>
      <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Mensaje</mat-label><textarea matInput [ngModelOptions]="{standalone:true}" [ngModel]="content().message" (ngModelChange)="change('message',$event)" rows="3" maxlength="1000"></textarea><mat-hint>Hasta 500 caracteres. Texto sin HTML.</mat-hint></mat-form-field>
      <div class="button-fields"><mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>Texto del botón (opcional)</mat-label><input matInput [ngModelOptions]="{standalone:true}" [ngModel]="content().buttonLabel" (ngModelChange)="change('buttonLabel',$event)" maxlength="80" /></mat-form-field>
      <mat-form-field appearance="outline" subscriptSizing="dynamic"><mat-label>URL del botón</mat-label><input matInput type="url" [ngModelOptions]="{standalone:true}" [ngModel]="content().buttonUrl ?? ''" (ngModelChange)="change('buttonUrl',$event)" placeholder="https://ejemplo.com" maxlength="2048" /></mat-form-field></div>
      <div class="preview-heading"><span>Vista previa</span><div role="group" aria-label="Tamaño de vista previa"><button mat-icon-button type="button" [attr.aria-pressed]="!mobile()" aria-label="Vista de escritorio" (click)="mobile.set(false)"><mat-icon>desktop_windows</mat-icon></button><button mat-icon-button type="button" [attr.aria-pressed]="mobile()" aria-label="Vista de móvil" (click)="mobile.set(true)"><mat-icon>smartphone</mat-icon></button></div></div>
      <div class="notice-preview" [class.mobile]="mobile()"><span class="notice-brand">{{ brand() }}</span><span class="notice-chip"><mat-icon aria-hidden="true">info_outline</mat-icon>Enlace no disponible</span><span class="notice-code" aria-hidden="true">{{ reason() === "expired" ? "404" : "410" }}</span><h4>{{ content().title || 'Añade un título' }}</h4><p>{{ content().message || 'Tu mensaje aparecerá aquí.' }}</p>@if (content().buttonLabel) { <span class="notice-button">{{ content().buttonLabel }}</span> }<small class="notice-foot">Puedes pedir un enlace nuevo a quien te lo compartió.</small></div>
      <p class="preview-help">El botón de esta vista previa no abre destinos. Los cambios se publican al guardar el enlace.</p>
    }
    @if (!valid()) { <p class="notice-error" role="alert">Revisa ambos mensajes y sus límites. Si añades un botón, necesita texto y una URL http/https válida.@if (!spec().enabled) { Activa la personalización para corregir el borrador o restablece los textos. <button mat-button type="button" (click)="reset()">Restablecer textos</button> }</p> }
  </mat-expansion-panel>`,
  styles: [`:host{display:block;margin-top:24px}.notice-settings{box-shadow:none!important;border:1px solid var(--uvh-border);background:var(--uvh-surface-raised);border-radius:16px!important}mat-panel-title{display:flex;align-items:center;gap:10px;font-size:14px}.settings-intro,.preview-help{font-size:12px;color:var(--uvh-muted);line-height:1.6}.reason-switch{display:flex;gap:8px;margin:18px 0;flex-wrap:wrap}.reason-switch button{min-height:44px}.reason-switch .chosen{background:color-mix(in srgb,var(--uvh-electric) 12%,var(--uvh-surface-raised))}mat-form-field{width:100%;margin-bottom:16px}.button-fields{display:grid;grid-template-columns:1fr 1fr;gap:12px}.preview-heading{display:flex;align-items:center;justify-content:space-between;font-size:12px;font-weight:650;margin:4px 0 12px}.preview-heading button{min-width:44px;min-height:44px}.notice-preview{display:flex;flex-direction:column;align-items:stretch;text-align:left;gap:0;background:var(--uvh-surface-raised);border:1px solid var(--uvh-border);border-top:3px solid var(--uvh-electric);border-radius:3px;padding:28px;max-width:416px;margin:auto;min-width:0;width:100%;box-sizing:border-box;transition:max-width .18s ease}.notice-preview.mobile{max-width:320px;margin:auto}.notice-brand{font:10px/1.6 "Courier New",monospace;letter-spacing:.1em;text-transform:uppercase;color:var(--uvh-muted);padding-bottom:14px;margin-bottom:20px;border-bottom:1px solid var(--uvh-border)}.notice-chip{display:inline-flex;align-items:center;gap:8px;align-self:flex-start;font:9.5px/1.6 "Courier New",monospace;letter-spacing:.12em;text-transform:uppercase;color:var(--uvh-muted);border:1px solid var(--uvh-border);border-radius:3px;padding:5px 10px;margin-bottom:16px}.notice-chip mat-icon{font-size:13px;width:13px;height:13px}.notice-code{font-size:56px;line-height:.9;font-weight:800;letter-spacing:-.05em;color:var(--uvh-muted);margin-bottom:2px}.notice-preview h4{font-size:20px;line-height:1.6;font-weight:800;letter-spacing:-.03em;margin:-2px 0 8px;overflow-wrap:anywhere}.notice-preview p{font-size:13.5px;line-height:1.6;margin:0 0 22px;color:var(--uvh-muted);white-space:pre-line;overflow-wrap:anywhere}.notice-foot{font-size:11.5px;line-height:1.6;color:var(--uvh-muted);margin-top:20px;padding-top:14px;border-top:1px solid var(--uvh-border)}.notice-button{display:block;text-align:center;padding:12px 16px;min-height:44px;box-sizing:border-box;border-radius:3px;background:var(--uvh-electric);color:var(--accent-ink);font-size:13px;font-weight:650;overflow-wrap:anywhere}.notice-error{color:var(--uvh-danger);font-size:12px;line-height:1.6}@media(max-width:560px){.button-fields{grid-template-columns:1fr;gap:0}mat-panel-title{font-size:12px}.notice-preview{padding:24px 16px}}@media(prefers-reduced-motion:reduce){.notice-preview{transition:none}}`], changeDetection: ChangeDetectionStrategy.Eager })
export class ExpiredPageEditorComponent {
  readonly brand = input("UVH · Enlaces cortos. Control total.");
  readonly spec = model<ExpiredPageSpec>(defaultExpiredPage()); readonly reason = signal<"expired" | "exhausted">("expired"); readonly mobile = signal(false);
  readonly content = computed(() => this.spec()[this.reason()]); readonly valid = computed(() => validExpiredPage(this.spec()));
  enable(enabled: boolean): void { this.spec.update(spec => ({ ...spec, enabled })); }
  reset(): void { this.spec.update(spec => ({ ...defaultExpiredPage(), enabled: spec.enabled })); }
  change(field: keyof LinkNoticeContent, value: string): void { const reason = this.reason(); this.spec.update(spec => ({ ...spec, [reason]: { ...spec[reason], [field]: field === "buttonUrl" ? value.trim() || null : value } })); }
}
