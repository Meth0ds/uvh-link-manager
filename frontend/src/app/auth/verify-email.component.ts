import { UI_TEXT } from "../core/localisation/template-messages";
import { afterNextRender, Component, computed, DestroyRef, ElementRef, inject, Injector, signal, ChangeDetectionStrategy, viewChild } from "@angular/core";
import { DOCUMENT, Location } from "@angular/common";

import { FormBuilder, ReactiveFormsModule, Validators } from "@angular/forms";
import { toSignal } from "@angular/core/rxjs-interop";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatInputModule } from "@angular/material/input";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { AuthShellComponent } from "./auth-shell.component";
import { PRIVACY_VERSION, TERMS_VERSION } from "../core/legal-documents";
import { ApiService, ApiRequestError } from "../core/services/api.service";
import { PendingLinkIntentService } from "../core/services/pending-link-intent.service";
import { PendingInvitationService } from "../core/services/pending-invitation.service";
import { authBearer } from "./auth-bearer";
import { LatestRequest } from "../core/services/latest-request";
import { decodeRegistrationActivation } from "../core/services/auth-response-decoders";
import { AuthService } from "../core/services/auth.service";
import { assessPassword, passwordStrengthLabel } from "./password-policy";

/**
 * Activation of a pending registration: the email bearer plus the identity,
 * legal acceptance and password typed here, which become the account's own.
 *
 * The initial request only supplies an email. Whoever opens its mailbox link
 * chooses the name and password and accepts the current legal versions here.
 * No identity, credential or workspace is inherited from an anonymous request.
 */
@Component({
  selector: "app-verify-email",
  standalone: true,
  imports: [ReactiveFormsModule, RouterLink, MatButtonModule, MatCheckboxModule, MatFormFieldModule, MatInputModule, MatIconModule, MatProgressBarModule, AuthShellComponent],
  template: `
    <app-auth-shell>
      <div class="card center" aria-labelledby="verify-email-title">
        <span class="step-kicker"><ng-container i18n="@@ui.6d73c370e7ba25">COMPLETAR REGISTRO</ng-container></span>
        @if (busy()) {
          <mat-progress-bar mode="indeterminate" aria-label="Procesando solicitud"  i18n-aria-label="@@ui.ecd743d7dea145"/>
        }
        <mat-icon class="icon" aria-hidden="true" [class.ok]="ok()" [class.bad]="failed() || ((!token || linkRejected()) && done())">
          {{ ok() ? 'verified_user' : (failed() || !token || linkRejected() ? 'error_outline' : 'mark_email_read') }}
        </mat-icon>
        <h2 id="verify-email-title">{{ ok() ? (newAccount() ? uiText.ui_b2120b1e6d5b61 : uiText.ui_22d93bf7496928) : (!token || linkRejected() ? uiText.ui_11e385a1023bde : uiText.ui_fb38b0e95c59d6) }}</h2>
        <p class="sub" [attr.role]="failed() ? 'alert' : 'status'">{{ message() }}</p>
        @if (token && !ok() && !linkRejected()) {
          <form #actionForm class="form" [formGroup]="form" (ngSubmit)="verify()" [attr.aria-busy]="busy()">
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label><ng-container i18n="@@ui.acc2e245d5b951">Nombre completo</ng-container></mat-label>
              <input matInput formControlName="name" autocomplete="name" maxlength="80" />
              <mat-hint><ng-container i18n="@@ui.d4b1161fae63aa">El nombre que quieres mostrar en UVH.</ng-container></mat-hint>
              @if (form.controls.name.invalid && form.controls.name.touched) { <mat-error><ng-container i18n="@@ui.2a2a53e091ecdd">Utiliza entre 2 y 80 caracteres.</ng-container></mat-error> }
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label><ng-container i18n="@@ui.a389a638dec325">Contraseña</ng-container></mat-label>
              <input matInput [type]="hide() ? 'password' : 'text'" formControlName="password" autocomplete="new-password" maxlength="72" />
              <button mat-icon-button matSuffix type="button" (click)="hide.set(!hide())" [attr.aria-label]="hide() ? uiText.ui_5fe3b78d0838f4 : uiText.ui_20d93396e534a5">
                <mat-icon>{{ hide() ? 'visibility_off' : 'visibility' }}</mat-icon>
              </button>
              <mat-hint><ng-container i18n="@@ui.679236f4d75f6b">Elige la contraseña con la que iniciarás sesión. Entre 10 y 72 caracteres.</ng-container></mat-hint>
              @if (form.controls.password.invalid && form.controls.password.touched) { <mat-error><ng-container i18n="@@ui.e3acd3c0081b57">Utiliza entre 10 y 72 caracteres.</ng-container></mat-error> }
            </mat-form-field>
            <mat-form-field appearance="outline" subscriptSizing="dynamic">
              <mat-label><ng-container i18n="@@ui.fb1ba2096139e4">Repite la contraseña</ng-container></mat-label>
              <input matInput [type]="hide() ? 'password' : 'text'" formControlName="confirm" autocomplete="new-password" maxlength="72" />
            </mat-form-field>
            @if (passwordValue()) {
              <p class="sub" role="status"><ng-container i18n="@@ui.7cbafa293ec788">Fortaleza estimada: {{ passwordStrength() }}. {{ passwordAssessment().feedback }}</ng-container></p>
            }
            @if (form.hasError('mismatch') && form.controls.confirm.touched) {
              <div class="alert error" role="alert"><ng-container i18n="@@ui.dcce46a3ea026e">Las contraseñas no coinciden. Revisa el segundo campo.</ng-container></div>
            }
            <mat-checkbox formControlName="acceptTerms" color="primary">
              <ng-container i18n="@@ui.7da94f946cb21e">Acepto los </ng-container><a routerLink="/legal/terminos" target="_blank" rel="noopener" (click)="$event.stopPropagation()"><ng-container i18n="@@ui.b4bfd7f8ce68b2">Términos de servicio</ng-container></a> <ng-container i18n="@@ui.fb5353ef6be3b1">y confirmo que he leído la </ng-container><a routerLink="/legal/privacidad" target="_blank" rel="noopener" (click)="$event.stopPropagation()"><ng-container i18n="@@ui.298dfe180a7fba">Política de privacidad</ng-container></a> <ng-container i18n="@@ui.8e7df73bc9c021">vigentes
            </ng-container></mat-checkbox>
            @if (form.controls.acceptTerms.hasError('required') && form.controls.acceptTerms.touched) {
              <div class="alert error" role="alert"><ng-container i18n="@@ui.0a24faed62e566">Debes aceptar los términos vigentes para activar la cuenta.</ng-container></div>
            }
            <button #submitButton mat-flat-button color="primary" type="submit" [disabled]="form.invalid || busy()">
              {{ busy() ? uiText.ui_dca985cac02b9e : (attempted() ? uiText.ui_c35a102ad7130f : uiText.ui_47f281d09dc90c) }}
            </button>
          </form>
        }
        @if (done() && ok()) {
          @if (signedIn()) {
            <a #nextLink mat-flat-button color="primary" [routerLink]="continueTo()">{{ hasPendingLink() ? uiText.ui_021d687dee0bce : (pendingInvitation() ? uiText.ui_8e3cfd59625c74 : uiText.ui_3bc27cd067f366) }}</a>
          } @else if (auth.authenticated()) {
            <button mat-flat-button color="primary" type="button" (click)="switchAccount()" [disabled]="busy()"><ng-container i18n="@@ui.45b3ad58fbb5a4">Cerrar la sesión actual y entrar con mi cuenta nueva</ng-container></button>
          } @else {
            <a #nextLink mat-flat-button color="primary" [routerLink]="['/auth']" [queryParams]="loginQueryParams()"><ng-container i18n="@@ui.8d518bb65ea3de">Iniciar sesión</ng-container></a>
          }
        } @else if (!token || linkRejected()) {
          <a #nextLink mat-flat-button color="primary" routerLink="/auth" [queryParams]="{ mode: 'register' }"><ng-container i18n="@@ui.345ca6883d4196">Solicitar otro enlace</ng-container></a>
        }
      </div>
    </app-auth-shell>
    `,
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./auth-card.scss",
})
export class VerifyEmailComponent {
  readonly uiText = UI_TEXT;
  private fb = inject(FormBuilder);
  readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private api = inject(ApiService);
  private route = inject(ActivatedRoute);
  private intents = inject(PendingLinkIntentService);
  private invitations = inject(PendingInvitationService);
  private location = inject(Location);
  private readonly requests = new LatestRequest(inject(DestroyRef));
  private readonly document = inject(DOCUMENT);
  private readonly injector = inject(Injector);
  private readonly actionForm = viewChild<unknown, ElementRef<HTMLFormElement>>("actionForm", { read: ElementRef });
  private readonly submitButton = viewChild<unknown, ElementRef<HTMLButtonElement>>("submitButton", { read: ElementRef });
  private readonly nextLink = viewChild<unknown, ElementRef<HTMLAnchorElement>>("nextLink", { read: ElementRef });

  readonly busy = signal(false);
  readonly done = signal(false);
  readonly ok = signal(false);
  readonly attempted = signal(false);
  readonly failed = signal(false);
  readonly linkRejected = signal(false);
  readonly hide = signal(true);
  readonly newAccount = signal(false);
  readonly signedIn = signal(false);
  private readonly transferredLink = signal(false);
  readonly message = signal($localize`:@@ui.75966789644f0e:Elige tu nombre y contraseña para crear la cuenta y confirmar tu email. Si no solicitaste este registro, no continúes.`);
  readonly pendingLink = this.intents.pending;
  readonly pendingInvitation = this.invitations.pending;
  readonly token: string;
  readonly hasPendingLink = computed(() => this.transferredLink() || !!this.pendingLink());
  readonly continueTo = computed(() => this.hasPendingLink() ? "/app/links" : (this.pendingInvitation() ? "/invitations/accept" : "/app"));
  readonly loginQueryParams = computed(() => this.hasPendingLink()
    ? { returnTo: "/app/links" }
    : (this.pendingInvitation() ? { returnTo: "/invitations/accept" } : {}));

  form = this.fb.nonNullable.group(
    {
      name: ["", [Validators.required, Validators.minLength(2), Validators.maxLength(80)]],
      password: ["", [Validators.required, Validators.minLength(10), Validators.maxLength(72)]],
      confirm: ["", [Validators.required]],
      acceptTerms: [false, [Validators.requiredTrue]],
    },
    { validators: (g) => (g.get("password")?.value === g.get("confirm")?.value ? null : { mismatch: true }) },
  );

  readonly passwordValue = toSignal(this.form.controls.password.valueChanges, { initialValue: "" });
  private readonly nameValue = toSignal(this.form.controls.name.valueChanges, { initialValue: "" });
  readonly passwordAssessment = computed(() => assessPassword(this.passwordValue(), this.nameValue()));
  readonly passwordStrength = computed(() => passwordStrengthLabel(this.passwordAssessment().score));

  constructor() {
    this.token = authBearer(this.route);
    this.location.replaceState("/auth/verify-email");
    if (!this.token) {
      this.done.set(true);
      this.message.set($localize`:@@ui.07283ca45f4566:Este enlace de verificación no es válido. Solicita un correo de verificación nuevo.`);
    }
  }

  async verify(): Promise<void> {
    if (!this.token || this.busy() || this.ok() || this.linkRejected() || this.form.invalid) return;
    const ownedFocus = this.actionForm()?.nativeElement.contains(this.document.activeElement) ?? false;
    const request = this.requests.begin(this.token);
    const generation = this.auth.sessionGeneration();
    this.busy.set(true);
    this.attempted.set(true);
    this.failed.set(false);
    try {
      // Identity, legal acceptance and password all cross here: the backend
      // installs them at activation and re-stamps the acceptance with this
      // request's timestamp, so nothing the anonymous registration proposed
      // becomes definitive.
      const activation = await this.api.post("/api/v1/auth/verify-email", {
        token: this.token,
        password: this.form.controls.password.value,
        name: this.form.controls.name.value.trim(),
        acceptTerms: true,
        termsVersion: TERMS_VERSION,
        privacyVersion: PRIVACY_VERSION,
      }, decodeRegistrationActivation);
      if (!this.requests.isCurrent(request, this.token)) return;
      this.ok.set(true);
      this.done.set(true);
      this.newAccount.set(activation.newAccount);
      this.transferredLink.set(activation.pendingLink);
      this.form.reset();
      if (activation.authenticated && activation.user) {
        const adopted = await this.auth.acceptRegistrationSession(activation.user, generation);
        if (!this.requests.isCurrent(request, this.token)) return;
        if (adopted && activation.pendingLink) {
          await this.intents.refresh();
          if (!this.requests.isCurrent(request, this.token)) return;
        }
        this.signedIn.set(adopted);
      }
      this.message.set(
        this.signedIn()
          ? (this.hasPendingLink() ? $localize`:@@ui.e3e37bde65dea2:Tu cuenta y tu sesión están listas. Continúa para revisar y crear el enlace que has guardado.` : $localize`:@@ui.9dcd4b05a05932:Tu cuenta y tu sesión están listas. Ya puedes entrar al panel.`)
          : (this.auth.authenticated() ? $localize`:@@ui.53b6bf77ac1c79:La cuenta está lista. Este navegador tiene otra cuenta abierta; puedes cerrar esa sesión para entrar con la nueva.` : $localize`:@@ui.21a6801538e93d:Tu email quedó confirmado. Inicia sesión para continuar con tu cuenta.`),
      );
    } catch (err) {
      if (!this.requests.isCurrent(request, this.token)) return;
      this.ok.set(false);
      this.failed.set(true);
      if (err instanceof ApiRequestError && err.status === 400) this.linkRejected.set(true);
      this.message.set(err instanceof ApiRequestError ? err.message : $localize`:@@ui.8e5c653629d637:El enlace de verificación no es válido o ha caducado.`);
    } finally {
      if (this.requests.isCurrent(request, this.token)) {
        this.busy.set(false);
        if (ownedFocus) {
          afterNextRender(() => {
            if (!this.requests.isCurrent(request, this.token) || this.document.activeElement !== this.document.body) return;
            const next = this.ok() || this.linkRejected() ? this.nextLink() : this.submitButton();
            next?.nativeElement.focus({ preventScroll: true });
          }, { injector: this.injector });
        }
      }
    }
  }

  async switchAccount(): Promise<void> {
    if (this.busy() || !this.ok()) return;
    this.busy.set(true);
    try {
      await this.auth.logout();
      await this.router.navigate(["/auth"], { queryParams: this.loginQueryParams() });
    } catch {
      this.message.set($localize`:@@ui.93f50ffd498ec0:No se pudo cerrar la sesión actual. Inténtalo de nuevo.`);
    } finally {
      this.busy.set(false);
    }
  }
}
