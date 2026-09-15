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
  selector: "app-password-change-dialog",
  standalone: true,
  imports: [ReactiveFormsModule, MatButtonModule, MatDialogModule, MatFormFieldModule, MatIconModule, MatInputModule],
  providers: [{ provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { subscriptSizing: "dynamic" } }],
  templateUrl: "./password-change-dialog.component.html",
  styleUrl: "./password-change-dialog.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PasswordChangeDialogComponent {
  readonly ref = inject(MatDialogRef<PasswordChangeDialogComponent, boolean>);
  private readonly auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly context = this.auth.sessionGeneration();
  private readonly fb = inject(FormBuilder);
  private readonly heading = viewChild<ElementRef<HTMLElement>>("stepHeading");

  // The requirement is frozen when the dialog opens. A changing account
  // context invalidates submission instead of silently changing the workflow.
  readonly requiresMfa = this.auth.user()?.mfaEnabled === true;
  readonly step = signal<1 | 2 | 3>(1);
  readonly busy = signal(false);
  readonly reveal = signal(false);
  readonly error = signal<string | null>(null);
  readonly passwordForm = this.fb.nonNullable.group(
    {
      current: ["", [Validators.required, Validators.maxLength(72)]],
      next: ["", [Validators.required, Validators.minLength(10), Validators.maxLength(72)]],
      confirm: ["", [Validators.required, Validators.maxLength(72)]],
    },
    { validators: (group) => group.get("next")?.value === group.get("confirm")?.value ? null : { mismatch: true } },
  );
  readonly factorForm = this.fb.nonNullable.group({
    factorCode: ["", [Validators.required, Validators.pattern(/^(?:\d{6}|[A-Za-z2-9\s-]{16,24})$/)]],
  });

  constructor() {
    // Secret fields are owned by this short-lived overlay and are never
    // returned through afterClosed or retained on the Settings page.
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
    // Do not allow Escape/backdrop to make an in-flight security mutation look
    // cancelled. The backend still validates the password and factor.
    this.ref.disableClose = true;
    try {
      await this.auth.changePassword(
        this.passwordForm.controls.current.value,
        this.passwordForm.controls.next.value,
        this.requiresMfa ? this.factorForm.controls.factorCode.value.trim() : undefined,
      );
      if (this.destroyRef.destroyed) return;
      this.clearSecrets();
      this.moveTo(this.requiresMfa ? 3 : 2);
    } catch (error) {
      if (!this.destroyRef.destroyed) {
        this.clearSecrets();
        this.error.set(error instanceof ApiRequestError ? error.message : "No se pudo confirmar el cambio. La contraseña no se ha modificado.");
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
    this.reveal.set(false);
  }
}
