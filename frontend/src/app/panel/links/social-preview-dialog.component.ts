import { UI_TEXT } from "../../core/localisation/template-messages";
import { Component, DestroyRef, effect, inject, signal } from "@angular/core";
import {
  MAT_DIALOG_DATA,
  MatDialogModule,
  MatDialogRef,
} from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { SocialPreviewEditorComponent } from "./social-preview-editor.component";
import type { LinkDto } from "../../core/models";
import type { SocialPreviewSpec } from "../../core/sharing";
import { SharingService } from "../../core/services/sharing.service";
import { decodeLinkResponse } from "../../core/services/link-response-decoders";
@Component({
  selector: "app-social-preview-dialog",
  standalone: true,
  imports: [
    MatDialogModule,
    MatButtonModule,
    MatIconModule,
    MatProgressBarModule,
    SocialPreviewEditorComponent,
  ],
  template: `<header>
      <div>
        <h2 mat-dialog-title><ng-container i18n="@@ui.69eee355d1e388">Tarjeta al compartir</ng-container></h2>
        <p>{{ link.shortUrl }}</p>
      </div>
      <button
        mat-icon-button
        type="button"
        aria-label="Cerrar tarjeta social"
        (click)="ref.close()"
        [disabled]="saving()"
       i18n-aria-label="@@ui.82ac0013097c9d">
        <mat-icon>close</mat-icon>
      </button>
    </header>
    @if (saving()) {
      <mat-progress-bar mode="indeterminate" aria-label="Guardando tarjeta"  i18n-aria-label="@@ui.76387418ace800"/>
    }
    <mat-dialog-content
      ><app-social-preview-editor
        [initiallyOpen]="true"
        [spec]="spec()"
        (specChange)="spec.set($event)"
        [protected]="link.passwordProtected"
        [linkName]="link.name || ''"
        [shortUrl]="link.shortUrl"
        (working)="working.set($event)"
      />
      @if (error()) {
        <p class="error" role="alert">{{ error() }}</p>
      }</mat-dialog-content
    ><mat-dialog-actions align="end"
      ><button
        mat-button
        type="button"
        (click)="ref.close()"
        [disabled]="saving()"
      >
        <ng-container i18n="@@ui.bb9dbb406dcbd5">Cancelar</ng-container></button
      ><button
        mat-flat-button
        type="button"
        (click)="save()"
        [disabled]="saving() || working()"
      >
        {{ saving() ? uiText.ui_3c8dc4dc7a83dd : uiText.ui_293b21b82385f5 }}
      </button></mat-dialog-actions
    >`,
  styles: [
    `
      :host {
        display: flex;
        flex-direction: column;
        min-width: 0;
        max-height: calc(100dvh - 24px);
        overflow: hidden;
      }
      header,
      mat-dialog-actions {
        flex-shrink: 0;
      }
      h2::after {
        display: none;
      }
      header {
        display: flex;
        justify-content: space-between;
        align-items: flex-start;
        gap: 16px;
        padding: 24px;
        border-bottom: 1px solid var(--uvh-border);
      }
      h2 {
        padding: 0;
        margin: 0;
        font-size: 23px;
      }
      header p {
        font-size: 12px;
        color: var(--uvh-muted);
        overflow-wrap: anywhere;
        margin: 8px 0 0;
      }
      mat-dialog-content {
        padding: 16px 24px !important;
        max-height: none;
        flex: 1;
        min-height: 0;
        overflow: auto;
      }
      mat-dialog-actions {
        border-top: 1px solid var(--uvh-border);
        padding: 14px 24px !important;
      }
      .error {
        font-size: 13px;
        line-height: 1.6;
        color: var(--uvh-danger);
      }
      @media (max-width: 500px) {
        header {
          padding: 20px 18px;
        }
        mat-dialog-content {
          padding: 16px 18px !important;
        }
        mat-dialog-actions {
          padding: 12px 18px !important;
        }
      }
    `,
  ],
})
export class SocialPreviewDialogComponent {
  readonly uiText = UI_TEXT;
  readonly link = inject<LinkDto>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<SocialPreviewDialogComponent>);
  readonly sharing = inject(SharingService);
  private destroy = inject(DestroyRef);
  private context = this.sharing.context();
  readonly spec = signal<SocialPreviewSpec | null>(
    structuredClone(
      this.link.socialPreview ?? {
        version: 1,
        enabled: false,
        title: "",
        description: null,
        imageAssetId: null,
        imageAlt: null,
      },
    ),
  );
  readonly working = signal(false);
  readonly saving = signal(false);
  readonly error = signal("");
  constructor() {
    effect(() => {
      if (this.sharing.context() !== this.context) this.ref.close();
    });
  }
  async save(): Promise<void> {
    if (this.saving() || this.working()) return;
    this.error.set("");
    this.saving.set(true);
    this.ref.disableClose = true;
    try {
      const result = await this.sharing.api.patch(
        "/api/v1/links/" + this.link.id,
        { version: this.link.version, socialPreview: this.spec() },
        decodeLinkResponse,
      );
      if (!this.destroy.destroyed && this.sharing.context() === this.context)
        this.ref.close(result.link);
    } catch (e) {
      if (!this.destroy.destroyed && this.sharing.context() === this.context)
        this.error.set(
          e instanceof Error ? e.message : $localize`:@@ui.6a4b7eba7f8226:No se pudo guardar la tarjeta.`,
        );
    } finally {
      if (!this.destroy.destroyed) {
        this.saving.set(false);
        this.ref.disableClose = false;
      }
    }
  }
}
