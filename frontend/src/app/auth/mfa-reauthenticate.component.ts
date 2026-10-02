import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from "@angular/core";
import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { AuthShellComponent } from "./auth-shell.component";
import { safeReturnTo } from "../core/guards/auth.guard";
import { ApiRequestError } from "../core/services/api.service";
import { AuthService } from "../core/services/auth.service";
import { LatestRequest } from "../core/services/latest-request";

@Component({
  selector: "app-mfa-reauthenticate",
  standalone: true,
  imports: [
    ReactiveFormsModule,
    RouterLink,
    MatButtonModule,
    MatFormFieldModule,
    MatIconModule,
    MatInputModule,
    MatProgressBarModule,
    AuthShellComponent,
  ],
  template: `
    <app-auth-shell>
      <section class="card" aria-labelledby="reauth-title">
        <span class="step-kicker">{{ administrativeAccess ? 'ADMINISTRACIÓN / VERIFICACIÓN' : 'SEGURIDAD / VERIFICACIÓN' }}</span>
        @if (initializing() || busy()) {
          <mat-progress-bar mode="indeterminate" aria-label="Procesando solicitud" />
        }
        <mat-icon class="icon" aria-hidden="true">{{ administrativeAccess ? 'admin_panel_settings' : 'verified_user' }}</mat-icon>
        <h2 id="reauth-title">Confirma que eres tú</h2>
        <p class="sub">{{ administrativeAccess ? 'Vas a entrar en administración.' : 'Vas a realizar una acción sensible en tu cuenta.' }} Confirma tu contraseña y un segundo factor para continuar con una verificación reciente.</p>
        @if (initializing()) { <p class="auth-note" role="status">Comprobando la sesión y los requisitos de acceso. Todavía no necesitas introducir ningún código.</p> }

        @if (!initializing() && ready()) {
          <form class="form" [formGroup]="form" (ngSubmit)="submit()">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Contraseña</mat-label>
              <input matInput [type]="hidePassword() ? 'password' : 'text'" formControlName="password" autocomplete="current-password" maxlength="72" [readonly]="busy()" />
              <button mat-icon-button matSuffix type="button" (click)="hidePassword.set(!hidePassword())" [attr.aria-label]="hidePassword() ? 'Mostrar contraseña' : 'Ocultar contraseña'">
                <mat-icon>{{ hidePassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
              @if (form.controls.password.touched && form.controls.password.invalid) { <mat-error>Introduce tu contraseña actual.</mat-error> }
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label>Segundo factor</mat-label>
              <input matInput formControlName="factorCode" autocomplete="one-time-code" maxlength="24" inputmode="text" autocapitalize="off" spellcheck="false" [readonly]="busy()" />
              <mat-hint>El código de 6 dígitos de tu aplicación o un código de recuperación.</mat-hint>
              @if (form.controls.factorCode.touched && form.controls.factorCode.invalid) { <mat-error>Introduce un segundo factor para continuar.</mat-error> }
            </mat-form-field>

            <details class="factor-help"><summary>¿No tienes tu aplicación a mano?<mat-icon aria-hidden="true">expand_more</mat-icon></summary><p>Puedes usar uno de los códigos de recuperación que guardaste al activar MFA. Cada código de recuperación sirve una sola vez; el código temporal de tu aplicación no es lo mismo.</p><p>Si no dispones de ninguno, vuelve al panel. No necesitas desactivar la protección para salir de esta pantalla.</p></details>

            @if (error()) {
              <div class="alert error" role="alert">{{ error() }}</div>
            }
            <button mat-flat-button color="primary" class="submit" type="submit" [disabled]="form.invalid || busy()" [attr.aria-busy]="busy()">
              {{ busy() ? 'Verificando…' : administrativeAccess ? 'Continuar a administración' : 'Confirmar y continuar' }}
            </button>
          </form>
        }

        @if (!initializing() && !ready() && error()) {
          <div class="alert error" role="alert">{{ error() }}</div>
          <button mat-flat-button type="button" (click)="retryInitialization()">Reintentar comprobación</button>
        }
        <a class="back" routerLink="/app/dashboard"><mat-icon aria-hidden="true">arrow_back</mat-icon>Volver al panel</a>
        <p class="auth-note">Esta comprobación no cierra tu sesión. Confirma tu identidad antes de continuar con acciones sensibles.</p>
      </section>
    </app-auth-shell>
  `,
  styleUrl: "./security-flow.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MfaReauthenticateComponent {
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  private readonly initializeRequests = new LatestRequest(inject(DestroyRef));
  private readonly submitRequests = new LatestRequest(inject(DestroyRef));
  private terminalNavigation = false;
  private verifiedContext: string | null = null;

  readonly initializing = signal(true);
  readonly ready = signal(false);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly hidePassword = signal(true);
  readonly form = this.fb.nonNullable.group({
    password: ["", [Validators.required, Validators.maxLength(72)]],
    factorCode: ["", [Validators.required, Validators.maxLength(24)]],
  });
  private readonly returnTo = safeReturnTo(this.route.snapshot.queryParamMap.get("returnTo") ?? "/app/dashboard");
  readonly administrativeAccess = /^\/app\/admin(?:\/|[?#]|$)/.test(this.returnTo);

  constructor() {
    void this.initialize();
  }

  async submit(): Promise<void> {
    if (!this.ready() || this.initializing() || this.verifiedContext !== this.context() || this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    const request = this.submitRequests.begin(this.context());
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.reauthenticateMfa(
        this.form.controls.password.value,
        this.form.controls.factorCode.value,
      );
      if (!this.submitRequests.isCurrent(request, this.context())) return;
      this.form.reset();
      await this.navigateOnce(
        () => this.router.navigateByUrl(this.returnTo),
        () => this.submitRequests.isCurrent(request, this.context()),
      );
    } catch (error) {
      if (!this.submitRequests.isCurrent(request, this.context())) return;
      this.form.controls.factorCode.reset();
      this.error.set(error instanceof ApiRequestError ? error.message : "No se pudo confirmar tu identidad");
    } finally {
      if (this.submitRequests.isCurrent(request, this.context())) this.busy.set(false);
    }
  }

  retryInitialization(): void {
    if (this.initializing() || this.busy() || this.terminalNavigation) return;
    void this.initialize();
  }

  private context(): string {
    return `${this.returnTo}:${this.auth.sessionGeneration()}`;
  }

  private async initialize(): Promise<void> {
    this.initializing.set(true);
    this.ready.set(false);
    this.verifiedContext = null;
    this.error.set(null);
    const request = this.initializeRequests.begin(this.context());
    const current = () => this.initializeRequests.isCurrent(request, this.context());
    try {
      if (!this.auth.loaded()) await this.auth.init();
      if (!current()) return;
      if (!this.auth.loaded()) {
        this.error.set("No se pudo comprobar la sesión. Reintenta cuando recuperes la conexión.");
        return;
      }
      if (!this.auth.authenticated()) {
        await this.navigateOnce(
          () => this.router.navigate(["/auth"], { queryParams: { returnTo: this.returnTo } }),
          current,
        );
        return;
      }
      if (this.administrativeAccess && this.auth.user()?.isAdmin !== true) {
        await this.navigateOnce(() => this.router.navigate(["/forbidden"]), current);
        return;
      }
      const status = await this.auth.mfaSessionStatus();
      if (!current()) return;
      if (!status.enabled) {
        await this.navigateOnce(() => this.router.navigate(["/forbidden"]), current);
        return;
      }
      if (status.fresh) {
        this.auth.clearAdminMfaReauthentication();
        await this.navigateOnce(() => this.router.navigateByUrl(this.returnTo), current);
        return;
      }
      this.verifiedContext = this.context();
      this.ready.set(true);
    } catch (error) {
      if (current()) {
        this.error.set(error instanceof ApiRequestError ? error.message : "No se pudo comprobar el estado de la sesión");
      }
    } finally {
      if (current()) this.initializing.set(false);
    }
  }

  /** Only one authorization outcome may own navigation from this view. */
  private async navigateOnce(navigate: () => Promise<boolean>, current: () => boolean): Promise<void> {
    if (this.terminalNavigation || !current()) return;
    this.terminalNavigation = true;
    await navigate();
  }
}
