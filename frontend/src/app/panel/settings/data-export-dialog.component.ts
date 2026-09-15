import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal, viewChild } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MAT_FORM_FIELD_DEFAULT_OPTIONS, MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { ApiRequestError } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";

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
  readonly ref = inject(MatDialogRef<DataExportDialogComponent, boolean>);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly context = this.auth.sessionGeneration();
  private readonly fb = inject(FormBuilder);
  private readonly heading = viewChild<ElementRef<HTMLElement>>("stepHeading");
  readonly requiresMfa = this.auth.user()?.mfaEnabled === true;
  readonly step = signal<1 | 2 | 3>(1);
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
    // exit path. Only a boolean completion signal reaches the settings page.
    this.destroyRef.onDestroy(() => this.clearSecrets());
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
    try {
      await this.auth.requestDataExport(
        this.passwordForm.controls.password.value,
        this.requiresMfa ? this.factorForm.controls.factorCode.value.trim() : undefined,
      );
      if (this.destroyRef.destroyed) return;
      this.clearSecrets();
      this.moveTo(this.requiresMfa ? 3 : 2);
    } catch (error) {
      if (!this.destroyRef.destroyed) {
        this.clearSecrets();
        this.error.set(error instanceof ApiRequestError ? error.message : "No se pudo confirmar la solicitud. Comprueba su estado antes de volver a intentarlo.");
        this.moveTo(1);
      }
    } finally {
      if (!this.destroyRef.destroyed) {
        this.busy.set(false);
        this.ref.disableClose = false;
      }
    }
  }

  isDone(): boolean {
    return this.requiresMfa ? this.step() === 3 : this.step() === 2;
  }

  private moveTo(step: 1 | 2 | 3): void {
    this.step.set(step);
    queueMicrotask(() => this.heading()?.nativeElement.focus());
  }

  private clearSecrets(): void {
    this.passwordForm.reset();
    this.factorForm.reset();
  }
}
