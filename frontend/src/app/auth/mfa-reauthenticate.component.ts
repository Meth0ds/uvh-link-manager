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
        <span class="step-kicker">ADMINISTRACIÓN / VERIFICACIÓN</span>
        @if (initializing() || busy()) {
          <mat-progress-bar mode="indeterminate" aria-label="Procesando solicitud" />
        }
        <mat-icon class="icon" aria-hidden="true">admin_panel_settings</mat-icon>
        <h2 id="reauth-title">Confirma que eres tú</h2>
        <p class="sub">La consola administrativa requiere una verificación reciente. Tu sesión general seguirá abierta.</p>

        @if (!initializing()) {
          <form class="form" [formGroup]="form" (ngSubmit)="submit()">
            <mat-form-field appearance="outline">
              <mat-label>Contraseña</mat-label>
              <input matInput [type]="hidePassword() ? 'password' : 'text'" formControlName="password" autocomplete="current-password" maxlength="72" />
              <button mat-icon-button matSuffix type="button" (click)="hidePassword.set(!hidePassword())" [attr.aria-label]="hidePassword() ? 'Mostrar contraseña' : 'Ocultar contraseña'">
                <mat-icon>{{ hidePassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
            </mat-form-field>
            <mat-form-field appearance="outline">
              <mat-label>Segundo factor</mat-label>
              <input matInput formControlName="factorCode" autocomplete="one-time-code" maxlength="24" inputmode="text" />
              <mat-hint>6 dígitos o uno de tus códigos de recuperación</mat-hint>
            </mat-form-field>

            @if (error()) {
              <div class="alert error" role="alert">{{ error() }}</div>
            }
            <button mat-flat-button color="primary" class="submit" type="submit" [disabled]="form.invalid || busy()">
              {{ busy() ? 'Verificando…' : 'Continuar a administración' }}
            </button>
          </form>
        }

        <a class="back" routerLink="/app/dashboard">Volver al panel</a>
      </section>
    </app-auth-shell>
  `,
  styleUrl: "./auth-card.scss",
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

  readonly initializing = signal(true);
  readonly busy = signal(false);
  readonly error = signal<string | null>(null);
  readonly hidePassword = signal(true);
  readonly form = this.fb.nonNullable.group({
    password: ["", [Validators.required, Validators.maxLength(72)]],
    factorCode: ["", [Validators.required, Validators.maxLength(24)]],
  });
  private readonly returnTo = safeReturnTo(this.route.snapshot.queryParamMap.get("returnTo") ?? "/app/admin");

  constructor() {
    void this.initialize();
  }

  async submit(): Promise<void> {
    if (this.form.invalid || this.busy()) {
      this.form.markAllAsTouched();
      return;
    }
    const request = this.submitRequests.begin(this.returnTo);
    this.busy.set(true);
    this.error.set(null);
    try {
      await this.auth.reauthenticateMfa(
        this.form.controls.password.value,
        this.form.controls.factorCode.value,
      );
      if (!this.submitRequests.isCurrent(request, this.returnTo)) return;
      this.form.reset();
      await this.navigateOnce(
        () => this.router.navigateByUrl(this.returnTo),
        () => this.submitRequests.isCurrent(request, this.returnTo),
      );
    } catch (error) {
      if (!this.submitRequests.isCurrent(request, this.returnTo)) return;
      this.form.controls.factorCode.reset();
      this.error.set(error instanceof ApiRequestError ? error.message : "No se pudo confirmar tu identidad");
    } finally {
      if (this.submitRequests.isCurrent(request, this.returnTo)) this.busy.set(false);
    }
  }

  private async initialize(): Promise<void> {
    const request = this.initializeRequests.begin(this.returnTo);
    const current = () => this.initializeRequests.isCurrent(request, this.returnTo);
    try {
      if (!this.auth.loaded()) await this.auth.init();
      if (!current()) return;
      if (!this.auth.authenticated()) {
        await this.navigateOnce(
          () => this.router.navigate(["/auth"], { queryParams: { returnTo: this.returnTo } }),
          current,
        );
        return;
      }
      if (this.auth.user()?.isAdmin !== true) {
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
      }
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
