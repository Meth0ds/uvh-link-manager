import { Location } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, DestroyRef, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { ApiRequestError, ApiService } from "../core/services/api.service";
import { authBearer } from "./auth-bearer";
import { AuthShellComponent } from "./auth-shell.component";
import { LatestRequest } from "../core/services/latest-request";
import { decodePublicActionMessage } from "../core/services/public-action-response-decoders";

@Component({
  selector: "app-account-recovery-complete",
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <section class="card recovery-complete" aria-labelledby="complete-title">
        <span class="step-kicker">Recuperación / proteger la cuenta</span>
        <h2 id="complete-title">Protege de nuevo tu cuenta</h2>
        <p class="sub">El enlace funciona una sola vez. Al finalizar se cerrarán las sesiones, se revocarán los tokens API, se retirará el MFA perdido y tendrás que configurarlo de nuevo.</p>

        @if (!done()) {
          <form class="form" [formGroup]="form" (ngSubmit)="complete()">
            <mat-form-field appearance="outline">
              <mat-label>Nueva contraseña</mat-label>
              <input matInput [type]="hide() ? 'password' : 'text'" formControlName="password" autocomplete="new-password" maxlength="72" />
              <button mat-icon-button matSuffix type="button" (click)="hide.set(!hide())" [attr.aria-label]="hide() ? 'Mostrar contraseña' : 'Ocultar contraseña'">
                <mat-icon>{{ hide() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
            </mat-form-field>
            <div class="strength" role="meter" aria-label="Fortaleza estimada" aria-valuemin="0" aria-valuemax="4" [attr.aria-valuenow]="passwordScore()">
              @for (part of [1, 2, 3, 4]; track part) { <span [class.met]="passwordScore() >= part"></span> }
              <small>{{ passwordLabel() }}</small>
            </div>
            <mat-form-field appearance="outline">
              <mat-label>Repite la contraseña</mat-label>
              <input matInput [type]="hide() ? 'password' : 'text'" formControlName="confirm" autocomplete="new-password" maxlength="72" />
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Confirmación escrita</mat-label>
              <input matInput formControlName="confirmation" autocomplete="off" maxlength="20" />
              <mat-hint>Escribe exactamente RECUPERAR MI CUENTA.</mat-hint>
            </mat-form-field>
            @if (error(); as message) { <div class="alert error" role="alert">{{ message }}</div> }
            <button mat-flat-button color="primary" class="submit" type="submit" [disabled]="form.invalid || busy() || !token">
              {{ busy() ? 'Protegiendo cuenta…' : 'Finalizar recuperación' }}
            </button>
          </form>
        } @else {
          <section class="result center" role="status">
            <mat-icon class="icon" [class.ok]="ok()" [class.bad]="!ok()" aria-hidden="true">{{ ok() ? 'verified_user' : 'error_outline' }}</mat-icon>
            <h3>{{ ok() ? 'Cuenta recuperada' : 'No se pudo completar' }}</h3>
            <p>{{ message() }}</p>
            <a mat-flat-button color="primary" routerLink="/auth">{{ ok() ? 'Iniciar sesión' : 'Volver al acceso' }}</a>
          </section>
        }
      </section>
    </app-auth-shell>
  `,
  styleUrl: "./auth-card.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountRecoveryCompleteComponent {
  private readonly api = inject(ApiService);
  private readonly fb = inject(FormBuilder);
  private readonly route = inject(ActivatedRoute);
  private readonly location = inject(Location);
  private readonly requests = new LatestRequest(inject(DestroyRef));

  readonly token = authBearer(this.route);
  readonly busy = signal(false);
  readonly done = signal(false);
  readonly ok = signal(false);
  readonly hide = signal(true);
  readonly error = signal<string | null>(null);
  readonly message = signal("");
  readonly form = this.fb.nonNullable.group({
    password: ["", [Validators.required, Validators.minLength(10), Validators.maxLength(72)]],
    confirm: ["", [Validators.required, Validators.maxLength(72)]],
    confirmation: ["", [Validators.required, Validators.pattern(/^RECUPERAR MI CUENTA$/)]],
  }, { validators: (group) => group.get("password")?.value === group.get("confirm")?.value ? null : { mismatch: true } });
  private readonly password = toSignal(this.form.controls.password.valueChanges, { initialValue: "" });
  readonly passwordScore = computed(() => {
    const value = this.password();
    return [value.length >= 10, value.length >= 14, /[a-z]/.test(value) && /[A-Z]/.test(value), /\d/.test(value) || /[^A-Za-z0-9]/.test(value)].filter(Boolean).length;
  });
  readonly passwordLabel = computed(() => ["Introduce una contraseña", "Débil", "Mejorable", "Buena", "Fuerte"][this.passwordScore()]);

  constructor() {
    this.location.replaceState("/auth/account-recovery/complete");
    if (!this.token) {
      this.done.set(true);
      this.message.set("Falta el código de recuperación o el enlace ya no es válido.");
    }
  }

  async complete(): Promise<void> {
    if (this.form.invalid || !this.token || this.busy() || this.done()) {
      this.form.markAllAsTouched();
      return;
    }
    const request = this.requests.begin(this.token);
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.api.post<{ ok: true; message: string }>("/api/v1/auth/account-recovery/complete", {
        token: this.token,
        password: this.form.controls.password.value,
        confirmation: this.form.controls.confirmation.value,
      }, decodePublicActionMessage);
      if (!this.requests.isCurrent(request, this.token)) return;
      this.ok.set(true);
      this.message.set(result.message);
      this.done.set(true);
      this.form.reset();
    } catch (error) {
      if (!this.requests.isCurrent(request, this.token)) return;
      const message = error instanceof ApiRequestError ? error.message : "No se pudo completar la recuperación";
      if (error instanceof ApiRequestError && [400, 409].includes(error.status)) {
        this.message.set(message);
        this.done.set(true);
      } else {
        this.error.set(message);
      }
    } finally {
      if (this.requests.isCurrent(request, this.token)) this.busy.set(false);
    }
  }
}
