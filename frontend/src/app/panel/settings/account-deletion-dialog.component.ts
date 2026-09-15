import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, inject, signal, viewChild } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MAT_FORM_FIELD_DEFAULT_OPTIONS, MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { AuthService } from "../../core/services/auth.service";
import { ApiRequestError } from "../../core/services/api.service";
import type { AccountDeletionImpact } from "../../core/models";

@Component({
  selector: "app-account-deletion-dialog", standalone: true,
  imports: [ReactiveFormsModule, MatDialogModule, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatIconModule],
  providers: [{ provide: MAT_FORM_FIELD_DEFAULT_OPTIONS, useValue: { subscriptSizing: "dynamic" } }],
  templateUrl: "./account-deletion-dialog.component.html",
  styleUrl: "./account-deletion-dialog.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountDeletionDialogComponent {
  readonly auth = inject(AuthService);
  readonly ref = inject(MatDialogRef<AccountDeletionDialogComponent, boolean>);
  private readonly destroyRef = inject(DestroyRef);
  private readonly context = this.auth.sessionGeneration();
  readonly requiresMfa = this.auth.user()?.mfaEnabled === true;
  private readonly abort = new AbortController();
  readonly step = signal<1 | 2 | 3 | 4>(1);
  readonly acknowledged = signal(false);
  readonly loading = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly impact = signal<AccountDeletionImpact | null>(null);
  private readonly heading = viewChild<ElementRef<HTMLElement>>("stepHeading");
  readonly credentialsForm = inject(FormBuilder).nonNullable.group({
    password: ["", [Validators.required, Validators.maxLength(72)]],
    confirmation: ["", [Validators.required, Validators.pattern(/^ELIMINAR MI CUENTA$/)]],
  });
  readonly factorForm = inject(FormBuilder).nonNullable.group({
    factorCode: ["", [Validators.required, Validators.pattern(/^(?:\d{6}|[A-Za-z2-9\s-]{16,24})$/)]],
  });

  constructor() {
    // Credentials stay in this dialog; never emit them in afterClosed or retain
    // them on the account page. Cancel outstanding reads when the dialog closes.
    this.destroyRef.onDestroy(() => { this.abort.abort(); this.credentialsForm.reset(); this.factorForm.reset(); });
    void this.checkImpact();
  }

  allowed(): boolean {
    const impact = this.impact();
    return !!impact?.canDelete && !impact.isPlatformAdmin && !impact.request
      && !impact.ownedWorkspaces.length && !impact.blockingPrivacyRequests.length;
  }

  async checkImpact(): Promise<void> {
    this.loading.set(true);
    this.error.set(null);
    this.impact.set(null);
    try {
      const impact = await this.auth.accountDeletionImpact({ signal: this.abort.signal });
      if (this.destroyRef.destroyed) return;
      if (this.auth.sessionGeneration() !== this.context) throw new Error("Account context changed");
      this.impact.set(impact);
      if (!this.allowed()) this.error.set("La cuenta tiene requisitos pendientes o una solicitud en curso. Cierra esta ventana y actualiza los ajustes antes de continuar.");
    } catch {
      if (!this.destroyRef.destroyed) this.error.set("No se pudo comprobar si puedes cerrar la cuenta. No se ha enviado ninguna solicitud.");
    } finally {
      if (!this.destroyRef.destroyed) this.loading.set(false);
    }
  }

  next(): void {
    if (!this.acknowledged() || !this.allowed() || this.loading() || this.busy()) return;
    this.moveTo(2);
  }

  continueFromCredentials(): void {
    if (this.credentialsForm.invalid || this.busy()) {
      this.credentialsForm.markAllAsTouched();
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
    this.credentialsForm.reset();
    this.factorForm.reset();
    this.error.set(null);
    this.moveTo(1);
  }

  async submit(): Promise<void> {
    if ((this.requiresMfa ? this.step() !== 3 : this.step() !== 2) || this.busy() || !this.allowed() || !this.acknowledged()) return;
    if (this.auth.sessionGeneration() !== this.context) {
      this.credentialsForm.reset();
      this.factorForm.reset();
      this.error.set("Tu sesión ha cambiado. Cierra esta ventana y vuelve a abrirla.");
      return;
    }
    if (this.credentialsForm.invalid || (this.requiresMfa && this.factorForm.invalid)) {
      this.credentialsForm.markAllAsTouched();
      this.factorForm.markAllAsTouched();
      return;
    }
    this.busy.set(true);
    this.error.set(null);
    // Escape/backdrop cannot dismiss an in-flight request and invite a duplicate.
    // The server remains authoritative for MFA, ownership and grace-period rules.
    this.ref.disableClose = true;
    try {
      await this.auth.requestAccountDeletion(
        this.credentialsForm.controls.password.value,
        this.credentialsForm.controls.confirmation.value,
        this.requiresMfa ? this.factorForm.controls.factorCode.value.trim() : undefined,
      );
      if (this.destroyRef.destroyed) return;
      this.credentialsForm.reset();
      this.factorForm.reset();
      this.moveTo(this.requiresMfa ? 4 : 3);
    } catch (error) {
      if (!this.destroyRef.destroyed) {
        this.credentialsForm.reset();
        this.factorForm.reset();
        this.step.set(1);
        this.acknowledged.set(false);
        this.impact.set(null);
        this.error.set(error instanceof ApiRequestError ? error.message : "No se pudo confirmar el envío. Comprueba tu correo y vuelve a consultar los requisitos antes de repetirlo.");
      }
    } finally {
      if (!this.destroyRef.destroyed) { this.busy.set(false); this.ref.disableClose = false; }
    }
  }

  private moveTo(step: 1 | 2 | 3 | 4): void {
    this.step.set(step);
    queueMicrotask(() => this.heading()?.nativeElement.focus());
  }
}
