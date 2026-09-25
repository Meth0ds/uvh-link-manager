import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal, viewChild } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MAT_FORM_FIELD_DEFAULT_OPTIONS, MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { ApiRequestError } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { downloadBlob } from "../../core/services/browser-download";

export interface DataExportDialogData {
  /** `request` inicia una exportación; `download` entrega la ya preparada. */
  purpose: "request" | "download";
}

/**
 * `true` = la operación terminó; `"unconfirmed"` = el archivo se guardó en el
 * navegador pero el acuse de recepción falló. Nunca cruzan credenciales ni
 * datos de la exportación.
 */
export type DataExportDialogResult = boolean | "unconfirmed";

@Component({
  selector: "app-data-export-dialog",
  standalone: true,
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule],
  providers: [{ provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { subscriptSizing: "dynamic" } }],
  templateUrl: "./data-export-dialog.component.html",
  styleUrl: "./data-export-dialog.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class DataExportDialogComponent {
  readonly data = inject<DataExportDialogData>(MAT_DIALOG_DATA);
  readonly ref = inject(MatDialogRef<DataExportDialogComponent, DataExportDialogResult>);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly context = this.auth.sessionGeneration();
  private readonly fb = inject(FormBuilder);
  private readonly heading = viewChild<ElementRef<HTMLElement>>("stepHeading");
  readonly requiresMfa = this.auth.user()?.mfaEnabled === true;
  readonly step = signal<1 | 2>(1);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly passwordForm = this.fb.nonNullable.group({
    password: ["", [Validators.required, Validators.maxLength(72)]],
  });
  readonly factorForm = this.fb.nonNullable.group({
    factorCode: ["", [Validators.required, Validators.pattern(/^(?:\d{6}|[A-Za-z2-9\s-]{16,24})$/)]],
  });

  constructor() {
    // Export credentials never leave this overlay and are discarded on every
    // exit path. Only a small completion signal reaches the settings page.
    this.destroyRef.onDestroy(() => this.clearSecrets());
  }

  get isDownload(): boolean {
    return this.data.purpose === "download";
  }

  continueFromPassword(): void {
    if (this.passwordForm.invalid || this.busy()) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    if (this.requiresMfa) {
      this.factorForm.reset();
      this.moveTo(2);
      return;
    }
    void this.submit();
  }

  back(): void {
    if (this.busy()) return;
    this.factorForm.reset();
    this.error.set(null);
    this.moveTo(1);
  }

  async submit(): Promise<void> {
    if ((this.requiresMfa ? this.step() !== 2 : this.step() !== 1) || this.busy()) return;
    if (this.passwordForm.invalid || (this.requiresMfa && this.factorForm.invalid)) {
      this.passwordForm.markAllAsTouched();
      this.factorForm.markAllAsTouched();
      return;
    }
    if (this.auth.sessionGeneration() !== this.context) {
      this.clearSecrets();
      this.error.set("Tu sesión ha cambiado. Cierra esta ventana y empieza de nuevo.");
      this.moveTo(1);
      return;
    }

    this.busy.set(true);
    this.error.set(null);
    this.ref.disableClose = true;
    const password = this.passwordForm.controls.password.value;
    const factorCode = this.requiresMfa ? this.factorForm.controls.factorCode.value.trim() : undefined;
    try {
      if (this.isDownload) {
        await this.finishDownload(password, factorCode);
      } else {
        await this.auth.requestDataExport(password, factorCode);
        if (this.destroyRef.destroyed) return;
        this.clearSecrets();
        this.ref.close(true);
      }
    } catch (error) {
      if (!this.destroyRef.destroyed) {
        this.clearSecrets();
        this.error.set(error instanceof ApiRequestError
          ? error.message
          : this.isDownload
            ? "No se pudo descargar el archivo. Sigue disponible: vuelve a intentarlo."
            : "No se pudo confirmar la solicitud. Comprueba su estado antes de volver a intentarlo.");
        this.moveTo(1);
      }
    } finally {
      if (!this.destroyRef.destroyed) {
        this.busy.set(false);
        this.ref.disableClose = false;
      }
    }
  }

  primaryLabel(): string {
    if (this.requiresMfa) return "Continuar a 2FA";
    return this.busy()
      ? (this.isDownload ? "Descargando…" : "Solicitando…")
      : (this.isDownload ? "Descargar archivo" : "Solicitar mi archivo");
  }

  private async finishDownload(password: string, factorCode?: string): Promise<void> {
    const blob = await this.auth.downloadDataExport(password, factorCode);
    if (this.destroyRef.destroyed) return;
    if (!downloadBlob(blob, `uvh-datos-${new Date().toISOString().slice(0, 10)}.json`)) {
      // No se acusa nada: la exportación sigue `ready` y un reintento vuelve
      // a entregar el mismo archivo tras un nuevo step-up.
      this.clearSecrets();
      this.error.set("El navegador no pudo guardar el archivo. La exportación sigue disponible: vuelve a intentarlo.");
      this.moveTo(1);
      return;
    }
    try {
      // postBlob sólo resuelve con el cuerpo completo en memoria del
      // navegador; el acuse consume la exportación ya guardada.
      await this.auth.acknowledgeDataExportDownload();
      if (this.destroyRef.destroyed) return;
      this.clearSecrets();
      this.ref.close(true);
    } catch {
      if (this.destroyRef.destroyed) return;
      // El archivo ya está en el dispositivo: no se obliga a repetir el
      // step-up ni la descarga. Sin acuse, la exportación caduca sola.
      this.clearSecrets();
      this.ref.close("unconfirmed");
    }
  }

  private moveTo(step: 1 | 2): void {
    this.step.set(step);
    queueMicrotask(() => this.heading()?.nativeElement.focus());
  }

  private clearSecrets(): void {
    this.passwordForm.reset();
    this.factorForm.reset();
  }
}
