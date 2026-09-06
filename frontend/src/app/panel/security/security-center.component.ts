import { ChangeDetectionStrategy, Component, DestroyRef, inject, signal } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import type { SecurityCenterSnapshot, Session } from "../../core/models";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { LatestRequest } from "../../core/services/latest-request";
import { decodeSecurityCenter } from "../../core/services/security-center-response";
import { ActionDialogService } from "../action-dialog.service";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";

const ACTION_LABELS: Record<string, string> = {
  "auth.login": "Inicio de sesión",
  "auth.logout": "Cierre de sesión",
  "auth.password_change": "Contraseña cambiada",
  "auth.password_reset": "Contraseña restablecida",
  "auth.session_revoke": "Sesión revocada",
  "auth.mfa_enable": "MFA activado",
  "auth.mfa_disable": "MFA desactivado",
  "auth.mfa_reconfigured": "MFA reconfigurado",
  "auth.mfa_recovery": "Código de recuperación utilizado",
  "auth.mfa_recovery_regenerate": "Códigos de recuperación regenerados",
  "auth.mfa_reauthenticated": "Reautenticación MFA completada",
  "auth.email_change_requested": "Cambio de email solicitado",
  "auth.email_change_cancelled": "Cambio de email cancelado",
  "auth.email_change_confirmed": "Cambio de email confirmado",
  "auth.emergency_access_revoked": "Acceso revocado por incidente",
  "auth.account_recovery_completed": "Recuperación de cuenta completada",
};

@Component({
  selector: "app-security-center",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, MatSnackBarModule, PageHeaderComponent, PanelSkeletonComponent],
  templateUrl: "./security-center.component.html",
  styleUrl: "./security-center.component.scss",
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class SecurityCenterComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly snackbar = inject(MatSnackBar);
  private readonly actions = inject(ActionDialogService);
  private readonly requests = new LatestRequest(inject(DestroyRef));

  readonly snapshot = signal<SecurityCenterSnapshot | null>(null);
  readonly sessions = signal<Session[]>([]);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly revokingId = signal<string | null>(null);

  constructor() { void this.load(); }

  async load(): Promise<void> {
    const generation = this.auth.sessionGeneration();
    const request = this.requests.begin(generation);
    this.loading.set(true);
    this.error.set(null);
    try {
      const [snapshot, sessions] = await Promise.all([
        this.api.get<SecurityCenterSnapshot>("/api/v1/auth/security-center", undefined, decodeSecurityCenter),
        this.auth.listSessions(),
      ]);
      if (!this.requests.isCurrent(request, this.auth.sessionGeneration())) return;
      const now = Date.now();
      this.snapshot.set(snapshot);
      this.sessions.set(sessions.filter((item) => item.revoked_at === null && Date.parse(item.expires_at) > now));
    } catch (err) {
      if (!this.requests.isCurrent(request, this.auth.sessionGeneration())) return;
      this.snapshot.set(null);
      this.sessions.set([]);
      this.error.set(err instanceof ApiRequestError && err.status === 401 ? "Tu sesión ya no está activa." : err instanceof ApiRequestError ? err.message : "No se pudo cargar el centro de seguridad");
    } finally {
      if (this.requests.isCurrent(request, this.auth.sessionGeneration())) this.loading.set(false);
    }
  }

  async revoke(session: Session): Promise<void> {
    const confirmed = await this.actions.confirm({
      title: session.current ? "Cerrar esta sesión" : "Revocar sesión",
      message: session.current ? "Tendrás que volver a iniciar sesión en este dispositivo." : "El dispositivo dejará de tener acceso inmediatamente.",
      confirmLabel: session.current ? "Cerrar sesión" : "Revocar acceso",
      destructive: true,
    });
    if (!confirmed || this.revokingId() !== null) return;
    this.revokingId.set(session.id);
    try {
      const current = await this.auth.revokeSession(session.id, session.current);
      if (current) {
        await this.router.navigate(["/auth"]);
        return;
      }
      this.snackbar.open("Sesión revocada", "Cerrar", { duration: 2500 });
      await this.load();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo revocar la sesión", "Cerrar", { duration: 4000 });
    } finally {
      this.revokingId.set(null);
    }
  }

  actionLabel(action: string): string { return ACTION_LABELS[action] ?? "Actividad de seguridad"; }
  formatDate(value: string | null): string { return value ? new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value)) : "Sin registro disponible"; }
  agent(value: string | null): string { return value?.slice(0, 160) || "Dispositivo no identificado"; }
}
