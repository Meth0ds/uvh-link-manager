import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal, viewChild } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MAT_FORM_FIELD_DEFAULT_OPTIONS, MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { AuthService } from "../../core/services/auth.service";
import { ApiRequestError } from "../../core/services/api.service";

export interface EmailAccessDialogData {
  mode: "change" | "cancel";
  pendingEmail?: string | null;
}

@Component({
  selector: "app-email-access-dialog", standalone: true,
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatFormFieldModule, MatInputModule, MatIconModule],
  providers: [{ provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { subscriptSizing: "dynamic" } }],
  templateUrl: "./email-access-dialog.component.html",
  styleUrl: "./email-access-dialog.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class EmailAccessDialogComponent {
  readonly data = inject<EmailAccessDialogData>(MAT_DIALOG_DATA);
  readonly auth = inject(AuthService);
  readonly ref = inject(MatDialogRef<EmailAccessDialogComponent, boolean>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly context = this.auth.sessionGeneration();
  readonly requiresMfa = this.auth.user()?.mfaEnabled === true;
  private readonly fb = inject(FormBuilder);
  private readonly heading = viewChild<ElementRef<HTMLElement>>("stepHeading");
  readonly step = signal<1 | 2 | 3 | 4>(1);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly emailForm = this.fb.nonNullable.group({
    newEmail: ["", [Validators.required, Validators.email, Validators.maxLength(254)]],
  });
  readonly passwordForm = this.fb.nonNullable.group({
    password: ["", [Validators.required, Validators.maxLength(72)]],
  });
  readonly factorForm = this.fb.nonNullable.group({
    factorCode: ["", [Validators.required, Validators.pattern(/^(?:\d{6}|[A-Za-z2-9\s-]{16,24})$/)]],
  });

  constructor() {
    // Secrets live only for this dialog instance and never cross afterClosed.
    this.destroyRef.onDestroy(() => this.clearSecrets());
  }

  title(): string {
    return this.data.mode === "change" ? "Cambiar el email de acceso" : "Cancelar el cambio pendiente";
  }

  nextFromEmail(): void {
    if (this.data.mode === "change" && this.emailForm.invalid) {
      this.emailForm.markAllAsTouched();
      return;
    }
    this.moveTo(2);
  }

  nextFromPassword(): void {
    if (this.passwordForm.invalid) {
      this.passwordForm.markAllAsTouched();
      return;
    }
    if (this.requiresMfa) {
      this.factorForm.reset();
      this.moveTo(3);
      return;
    }
    void this.submit();
  }

  back(): void {
    if (this.busy()) return;
    if (this.step() === 3) {
      this.factorForm.reset();
      this.moveTo(2);
      return;
    }
    this.passwordForm.reset();
    this.moveTo(1);
  }

  async submit(): Promise<void> {
    if ((this.requiresMfa ? this.step() !== 3 : this.step() !== 2) || this.busy()) return;
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
    const factor = this.requiresMfa ? this.factorForm.controls.factorCode.value.trim() : undefined;
    try {
      if (this.data.mode === "change") {
        await this.auth.requestEmailChange(this.emailForm.controls.newEmail.value.trim(), this.passwordForm.controls.password.value, factor);
      } else {
        await this.auth.cancelEmailChange(this.passwordForm.controls.password.value, factor);
      }
      if (this.destroyRef.destroyed) return;
      this.clearSecrets();
      this.moveTo(this.requiresMfa ? 4 : 3);
    } catch (error) {
      if (!this.destroyRef.destroyed) {
        this.clearSecrets();
        this.error.set(error instanceof ApiRequestError ? error.message : "No se pudo confirmar la operación. No repitas el envío hasta comprobar el estado del email en Ajustes.");
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
    return this.requiresMfa ? this.step() === 4 : this.step() === 3;
  }

  private moveTo(step: 1 | 2 | 3 | 4): void {
    this.step.set(step);
    // Reuse one heading in the DOM so screen readers announce the new task.
    queueMicrotask(() => this.heading()?.nativeElement.focus());
  }

  private clearSecrets(): void {
    this.passwordForm.reset();
    this.factorForm.reset();
  }
}
