import { UI_TEXT } from "../core/localisation/template-messages";
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
import { AuthService } from "../core/services/auth.service";
import { assessPassword, passwordMeterSteps, passwordStrengthLabel } from "./password-policy";
import { authBearer } from "./auth-bearer";
import { AuthShellComponent } from "./auth-shell.component";
import { LatestRequest } from "../core/services/latest-request";
import { decodeAccountRecoveryCompletion } from "../core/services/public-action-response-decoders";

@Component({
  selector: "app-account-recovery-complete",
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <section class="card recovery-complete" aria-labelledby="complete-title">
        <span class="step-kicker"><ng-container i18n="@@ui.c5489b6cbdec7a">Recuperación / proteger la cuenta</ng-container></span>
        <h2 id="complete-title">{{ token ? uiText.ui_814e535a71339c : uiText.ui_11e385a1023bde }}</h2>
        @if (token) { <p class="sub"><ng-container i18n="@@ui.f020d75a86acaa">El enlace funciona una sola vez. Al finalizar se cerrarán las sesiones, se revocarán los tokens API, se retirará el MFA perdido y tendrás que configurarlo de nuevo.</ng-container></p> }

        @if (!done()) {
          <form class="form" [formGroup]="form" (ngSubmit)="complete()">
            <mat-form-field subscriptSizing="dynamic" appearance="outline">
              <mat-label><ng-container i18n="@@ui.902e689d3d52a0">Nueva contraseña</ng-container></mat-label>
              <input matInput [type]="hide() ? 'password' : 'text'" formControlName="password" autocomplete="new-password" maxlength="72" />
              <button mat-icon-button matSuffix type="button" (click)="hide.set(!hide())" [attr.aria-label]="hide() ? uiText.ui_5fe3b78d0838f4 : uiText.ui_20d93396e534a5">
                <mat-icon>{{ hide() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
            </mat-form-field>
            <div class="strength" role="meter" aria-label="Fortaleza estimada" aria-valuemin="0" aria-valuemax="100" [attr.aria-valuenow]="passwordScore()" [attr.aria-valuetext]="passwordLabel()" i18n-aria-label="@@ui.a96f6b9bf57b56">
              @for (part of meterSteps; track part) { <span [class.met]="passwordScore() >= part"></span> }
              <small>{{ passwordLabel() }}</small>
            </div>
            <p class="sub" role="status"><ng-container i18n="@@ui.d39d4037d3fcbf">{{ passwordAssessment().feedback }} La estimación no comprueba tus datos personales.</ng-container></p>
            <mat-form-field subscriptSizing="dynamic" appearance="outline">
              <mat-label><ng-container i18n="@@ui.fb1ba2096139e4">Repite la contraseña</ng-container></mat-label>
              <input matInput [type]="hide() ? 'password' : 'text'" formControlName="confirm" autocomplete="new-password" maxlength="72" />
            </mat-form-field>
            <mat-form-field subscriptSizing="dynamic" appearance="outline">
              <mat-label><ng-container i18n="@@ui.6a3d678e62a91a">Confirmación escrita</ng-container></mat-label>
              <input matInput formControlName="confirmation" autocomplete="off" maxlength="20" />
              <mat-hint><ng-container i18n="@@ui.0f71ec515ee44a">Escribe exactamente RECUPERAR MI CUENTA.</ng-container></mat-hint>
            </mat-form-field>
            @if (error(); as message) { <div class="alert error" role="alert">{{ message }}</div> }
            <button mat-flat-button color="primary" class="submit" type="submit" [disabled]="form.invalid || busy() || !token">
              {{ busy() ? uiText.ui_3c1b76e2e6fc1a : uiText.ui_15f917088f1f12 }}
            </button>
          </form>
        } @else {
          <section class="result center" role="status">
            <mat-icon class="icon" [class.ok]="ok()" [class.bad]="!ok()" aria-hidden="true">{{ ok() ? 'verified_user' : 'error_outline' }}</mat-icon>
            <h3>{{ ok() ? uiText.ui_19a162bab0370d : uiText.ui_2df446caf2895b }}</h3>
            <p>{{ message() }}</p>
            <a mat-flat-button color="primary" routerLink="/auth">{{ ok() ? uiText.ui_8d518bb65ea3de : uiText.ui_7c60b6892ea0a1 }}</a>
          </section>
        }
      </section>
    </app-auth-shell>
  `,
  styleUrl: "./auth-card.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AccountRecoveryCompleteComponent {
  readonly uiText = UI_TEXT;
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
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
  readonly meterSteps = passwordMeterSteps;
  readonly passwordAssessment = computed(() => assessPassword(this.password()));
  readonly passwordScore = computed(() => this.passwordAssessment().score);
  readonly passwordLabel = computed(() => this.password() ? passwordStrengthLabel(this.passwordScore()) : $localize`:@@ui.a07f69bff8d0a0:Introduce una contraseña`);

  constructor() {
    this.location.replaceState("/auth/account-recovery/complete");
    if (!this.token) {
      this.done.set(true);
      this.message.set($localize`:@@ui.cdd54140958249:Falta el código de recuperación o el enlace ya no es válido.`);
    }
  }

  async complete(): Promise<void> {
    if (this.form.invalid || !this.token || this.busy() || this.done()) {
      this.form.markAllAsTouched();
      return;
    }
    const generation = this.auth.sessionGeneration();
    const request = this.requests.begin(this.token);
    this.busy.set(true);
    this.error.set(null);
    try {
      const result = await this.api.post("/api/v1/auth/account-recovery/complete", {
        token: this.token,
        password: this.form.controls.password.value,
        confirmation: this.form.controls.confirmation.value,
      }, decodeAccountRecoveryCompletion);
      if (result.current) this.auth.accountSignedOut(generation);
      if (!this.requests.isCurrent(request, this.token)) return;
      this.ok.set(true);
      this.message.set(result.message);
      this.done.set(true);
      this.form.reset();
    } catch (error) {
      if (!this.requests.isCurrent(request, this.token)) return;
      const message = error instanceof ApiRequestError ? error.message : $localize`:@@ui.3da38a6439a4a4:No se pudo completar la recuperación`;
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
