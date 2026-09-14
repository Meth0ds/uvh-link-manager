/** Security-flow presentation only. Providers are local doubles; no account,
 * real bearer, authentication call or invitation mutation is available. */
import { Location } from "@angular/common";
import { ChangeDetectionStrategy, Component, effect, inject, signal, viewChild } from "@angular/core";
import { ActivatedRoute } from "@angular/router";
import { MfaReauthenticateComponent } from "../src/app/auth/mfa-reauthenticate.component";
import { InvitationAcceptComponent } from "../src/app/auth/invitation-accept.component";
import { AuthService } from "../src/app/core/services/auth.service";
import { PendingInvitationService } from "../src/app/core/services/pending-invitation.service";
import { blocked } from "./workspace-fixture";

@Component({
  selector: "app-security-preview", standalone: true, imports: [MfaReauthenticateComponent, InvitationAcceptComponent],
  changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: AuthService, useValue: { loaded: () => true, authenticated: () => true, user: () => ({ isAdmin: true }), mfaSessionStatus: async () => ({ enabled: true, fresh: false }), reauthenticateMfa: blocked, logout: blocked, sessionGeneration: () => 1, refreshWorkspaces: blocked } },
    { provide: Location, useValue: { replaceState: () => undefined } },
    { provide: PendingInvitationService, useValue: { capture: () => undefined, token: () => "fictional-preview-only-not-a-valid-invitation", persistent: () => false, clear: () => undefined } },
  ],
  template: `
    <aside><b>VISTA DE DISEÑO · SIN CUENTA NI CREDENCIALES</b>
      @if (page === 'invitation') { @for (item of modes; track item) { <button type="button" (click)="mode.set(item)" [attr.aria-pressed]="mode() === item">{{ item }}</button> } }
    </aside>
    @if (page === 'mfa') { <app-mfa-reauthenticate /> } @else { <app-invitation-accept /> }
  `,
  styles: `aside { display: flex; flex-wrap: wrap; gap: 8px; align-items: center; padding: 12px 20px; border-bottom: 1px dashed var(--line); background: var(--paper); color: var(--muted); } b { font: 10px/1.6 monospace; margin-right: auto; } button { min-height: 44px; border: 1px solid var(--line); padding: 8px; background: var(--paper-raised); color: var(--ink); border-radius: 3px; cursor: pointer; } button[aria-pressed=true] { border-color: var(--accent); } button:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }`,
})
export class SecurityPreviewComponent {
  readonly page = inject(ActivatedRoute).snapshot.data["page"] as string;
  readonly modes = ["Revisar", "Cargando", "Aceptada", "Rechazada", "Error", "Acceso"] as const;
  readonly mode = signal<string>("Revisar");
  private readonly invitation = viewChild(InvitationAcceptComponent);
  constructor() {
    effect(() => {
      const component = this.invitation();
      if (!component) return;
      const mode = this.mode();
      component.busy.set(mode === "Cargando"); component.ready.set(mode === "Revisar"); component.done.set(mode !== "Revisar" && mode !== "Cargando");
      component.ok.set(mode === "Aceptada"); component.rejected.set(mode === "Rechazada"); component.needsLogin.set(mode === "Acceso");
      component.message.set(mode === "Revisar" ? "Acepta para añadir tu cuenta al workspace o rechaza para invalidar este enlace." : mode === "Aceptada" ? "Te has unido al workspace. Ejemplo ficticio, sin cambios reales." : mode === "Rechazada" ? "La invitación ha sido rechazada. Ejemplo ficticio." : mode === "Acceso" ? "Inicia sesión con la cuenta a la que se envió la invitación. Ejemplo ficticio." : "La invitación no está disponible o ha caducado. Ejemplo ficticio.");
    });
  }
}
