import { UI_TEXT } from "../core/localisation/template-messages";
import { ChangeDetectionStrategy, Component, DestroyRef, ElementRef, Injector, ViewChild, afterNextRender, inject, signal } from "@angular/core";
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
        <span class="step-kicker">{{ administrativeAccess ? uiText.ui_b1ef9175658594 : uiText.ui_816abe2969d7e4 }}</span>
        @if (initializing() || busy() || navigationBusy()) {
          <mat-progress-bar mode="indeterminate" aria-label="Procesando solicitud"  i18n-aria-label="@@ui.ecd743d7dea145"/>
        }
        <mat-icon class="icon" aria-hidden="true">{{ navigationFailed() ? 'arrow_forward' : administrativeAccess ? 'admin_panel_settings' : 'verified_user' }}</mat-icon>
        <h2 id="reauth-title">{{ navigationFailed() ? uiText.ui_8d947833f8d9ba : uiText.ui_2bf2c76cc993b2 }}</h2>
        @if (!navigationFailed()) { <p class="sub"><ng-container i18n="@@ui.abf655cd513d3e">{{ administrativeAccess ? uiText.ui_dafd4b3724c39b : uiText.ui_f3160925ad434b }} Confirma tu contraseña y un segundo factor para continuar con una verificación reciente.</ng-container></p> }
        @if (initializing()) { <p class="auth-note" role="status"><ng-container i18n="@@ui.1ebe46a651eac8">Comprobando la sesión y los requisitos de acceso. Todavía no necesitas introducir ningún código.</ng-container></p> }

        @if (!initializing() && ready()) {
          <form class="form" [formGroup]="form" (ngSubmit)="submit()">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label><ng-container i18n="@@ui.a389a638dec325">Contraseña</ng-container></mat-label>
              <input matInput [type]="hidePassword() ? 'password' : 'text'" formControlName="password" autocomplete="current-password" maxlength="72" [readonly]="busy()" />
              <button mat-icon-button matSuffix type="button" (click)="hidePassword.set(!hidePassword())" [attr.aria-label]="hidePassword() ? uiText.ui_5fe3b78d0838f4 : uiText.ui_20d93396e534a5">
                <mat-icon>{{ hidePassword() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
              @if (form.controls.password.touched && form.controls.password.invalid) { <mat-error><ng-container i18n="@@ui.76115edd8ea225">Introduce tu contraseña actual.</ng-container></mat-error> }
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label><ng-container i18n="@@ui.918073072dca10">Segundo factor</ng-container></mat-label>
              <input matInput formControlName="factorCode" autocomplete="one-time-code" maxlength="24" inputmode="text" autocapitalize="off" spellcheck="false" [readonly]="busy()" />
              <mat-hint><ng-container i18n="@@ui.7ae0009eaa2698">El código de 6 dígitos de tu aplicación o un código de recuperación.</ng-container></mat-hint>
              @if (form.controls.factorCode.touched && form.controls.factorCode.invalid) { <mat-error><ng-container i18n="@@ui.f7ba24e9e59da1">Introduce un segundo factor para continuar.</ng-container></mat-error> }
            </mat-form-field>

            <details class="factor-help"><summary><ng-container i18n="@@ui.11355421873779">¿No tienes tu aplicación a mano?</ng-container><mat-icon aria-hidden="true">expand_more</mat-icon></summary><p><ng-container i18n="@@ui.728889debb977d">Puedes usar uno de los códigos de recuperación que guardaste al activar MFA. Cada código de recuperación sirve una sola vez; el código temporal de tu aplicación no es lo mismo.</ng-container></p><p><ng-container i18n="@@ui.95e2f47d80180d">Si no dispones de ninguno, vuelve al panel. No necesitas desactivar la protección para salir de esta pantalla.</ng-container></p></details>

            @if (error()) {
              <div class="alert error" role="alert">{{ error() }}</div>
            }
            <button mat-flat-button color="primary" class="submit" type="submit" [disabled]="form.invalid || busy()" [attr.aria-busy]="busy()">
              {{ busy() ? uiText.ui_c2f6ff98f69578 : administrativeAccess ? uiText.ui_cee1364b5c6b9a : uiText.ui_da56408a25f6f5 }}
            </button>
          </form>
        }

        @if (navigationFailed()) {
          <div #navigationStatus class="navigation-recovery" tabindex="-1" role="status" [attr.aria-busy]="navigationBusy()">
            <p class="auth-note"><ng-container i18n="@@ui.8a300e18bbe2cd">No hemos podido abrir la página de destino. Puedes volver a intentarlo para continuar.</ng-container></p>
            <button mat-flat-button class="navigation-retry" type="button" (click)="retryNavigation()" [disabled]="navigationBusy()">{{ navigationBusy() ? uiText.ui_2d5bf11d9a53df : uiText.ui_c35a102ad7130f }}</button>
          </div>
        }
        @if (!initializing() && !ready() && error() && !navigationFailed()) {
          <div class="alert error" role="alert">{{ error() }}</div>
          <button mat-flat-button type="button" (click)="retryInitialization()"><ng-container i18n="@@ui.6416f7f1035d2a">Reintentar comprobación</ng-container></button>
        }
        <a class="back" routerLink="/app/dashboard"><mat-icon aria-hidden="true">arrow_back</mat-icon><ng-container i18n="@@ui.834f03046a7776">Volver al panel</ng-container></a>
        @if (!navigationFailed()) { <p class="auth-note"><ng-container i18n="@@ui.0ee4972161b0bf">Esta comprobación no cierra tu sesión. Confirma tu identidad antes de continuar con acciones sensibles.</ng-container></p> }
      </section>
    </app-auth-shell>
  `,
  styleUrl: "./security-flow.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class MfaReauthenticateComponent {
  readonly uiText = UI_TEXT;
  private readonly fb = inject(FormBuilder);
  private readonly auth = inject(AuthService);
  private readonly route = inject(ActivatedRoute);
  private readonly router = inject(Router);
  @ViewChild("navigationStatus") private navigationStatus?: ElementRef<HTMLElement>;
  private readonly destroyRef = inject(DestroyRef);
  private readonly injector = inject(Injector);
  private readonly initializeRequests = new LatestRequest(this.destroyRef);
  private readonly submitRequests = new LatestRequest(this.destroyRef);
  private pendingNavigation: { navigate: () => Promise<boolean>; current: () => boolean } | null = null;
  private terminalNavigation = false;
  private verifiedContext: string | null = null;

  readonly initializing = signal(true);
  readonly ready = signal(false);
  readonly busy = signal(false);
  readonly navigationBusy = signal(false);
  readonly navigationFailed = signal(false);
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
    if (!this.ready() || this.initializing() || this.verifiedContext !== this.context() || this.form.invalid || this.busy() || this.terminalNavigation) {
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
      this.ready.set(false);
      await this.navigateOnce(
        () => this.router.navigateByUrl(this.returnTo),
        () => this.submitRequests.isCurrent(request, this.context()),
      );
    } catch (error) {
      if (!this.submitRequests.isCurrent(request, this.context())) return;
      this.form.controls.factorCode.reset();
      this.error.set(error instanceof ApiRequestError ? error.message : $localize`:@@ui.694541b711532b:No se pudo confirmar tu identidad`);
    } finally {
      if (this.submitRequests.isCurrent(request, this.context())) this.busy.set(false);
    }
  }

  retryInitialization(): void {
    if (this.initializing() || this.busy() || this.terminalNavigation) return;
    void this.initialize();
  }

  async retryNavigation(): Promise<void> {
    const pending = this.pendingNavigation;
    if (!pending || this.navigationBusy()) return;
    if (!pending.current()) {
      this.resetNavigationContext();
      return;
    }
    this.navigationStatus?.nativeElement.focus({ preventScroll: true });
    this.terminalNavigation = false;
    await this.navigateOnce(pending.navigate, pending.current);
  }

  /** A destination approved for an old session must be checked again. */
  private resetNavigationContext(): void {
    this.pendingNavigation = null;
    this.navigationFailed.set(false);
    this.navigationBusy.set(false);
    this.terminalNavigation = false;
    this.verifiedContext = null;
    this.ready.set(false);
    this.busy.set(false);
    this.initializing.set(false);
    this.error.set($localize`:@@ui.c8fc8d90034802:Tu sesión ha cambiado. Vuelve a comprobarla para continuar.`);
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
        this.error.set($localize`:@@ui.c31dc33de862c8:No se pudo comprobar la sesión. Reintenta cuando recuperes la conexión.`);
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
        this.error.set(error instanceof ApiRequestError ? error.message : $localize`:@@ui.ff9a1a069d746e:No se pudo comprobar el estado de la sesión`);
      }
    } finally {
      if (current()) this.initializing.set(false);
    }
  }

  /** Navigation retries reuse only the route operation, never a factor POST. */
  private async navigateOnce(navigate: () => Promise<boolean>, current: () => boolean): Promise<void> {
    if (this.terminalNavigation || !current()) return;
    this.terminalNavigation = true;
    this.navigationBusy.set(true);
    let navigated = false;
    try {
      navigated = await navigate();
    } catch {
      // A failed route load and a cancelled route are both retryable here.
    } finally {
      if (!this.destroyRef.destroyed) this.navigationBusy.set(false);
    }
    if (this.destroyRef.destroyed) return;
    if (!current()) {
      this.resetNavigationContext();
      return;
    }
    this.pendingNavigation = navigated ? null : { navigate, current };
    this.navigationFailed.set(!navigated);
    if (!navigated) {
      this.error.set(null);
      afterNextRender(() => {
        if (current() && this.navigationFailed() && !this.navigationBusy()) {
          this.navigationStatus?.nativeElement.focus({ preventScroll: true });
        }
      }, { injector: this.injector });
    }
  }
}
