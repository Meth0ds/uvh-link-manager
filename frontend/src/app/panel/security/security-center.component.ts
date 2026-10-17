import { UI_TEXT } from "../../core/localisation/template-messages";
import { ChangeDetectionStrategy, Component, computed, DestroyRef, effect, inject, NgZone, signal, untracked } from "@angular/core";
import { Router, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { ReadDeadline } from "../../core/read-deadline";
import { AsyncOperationStatusComponent } from "../async-operation-status.component";
import { dateTimeMediumLabel } from "../../core/date-time-label";
import { sessionAgentLabel } from "../../core/session-agent-label";
import type { SecurityCenterSnapshot, Session } from "../../core/models";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { AuthOperationSupersededError, AuthService } from "../../core/services/auth.service";
import { SessionContextService } from "../../core/services/session-context.service";
import { LatestRequest } from "../../core/services/latest-request";
import { decodeSecurityCenter } from "../../core/services/security-center-response";
import { ActionDialogService } from "../action-dialog.service";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";

const ACTION_LABELS: Record<string, string> = {
  "auth.login": $localize`:@@ui.ba4b93f605c830:Inicio de sesión`,
  "auth.logout": $localize`:@@ui.b92130e45812b6:Cierre de sesión`,
  "auth.password_change": $localize`:@@ui.e360581f0f7172:Contraseña cambiada`,
  "auth.password_reset": $localize`:@@ui.d99eea8fc08d51:Contraseña restablecida`,
  "auth.session_revoke": $localize`:@@ui.eef3d770790a42:Sesión revocada`,
  "auth.sessions_revoked_others": $localize`:@@ui.d9e03e79e9c083:Sesiones ajenas cerradas`,
  "auth.sessions_revoked_all": $localize`:@@ui.79abbc7f0fe148:Todas las sesiones cerradas`,
  "auth.mfa_enable": $localize`:@@ui.99b29f803bfed8:MFA activado`,
  "auth.mfa_disable": $localize`:@@ui.af28c171782d92:MFA desactivado`,
  "auth.mfa_reconfigured": $localize`:@@ui.fe582c16b1cd7b:MFA reconfigurado`,
  "auth.mfa_recovery": $localize`:@@ui.a6e9e9e5c668e2:Código de recuperación utilizado`,
  "auth.mfa_recovery_regenerate": $localize`:@@ui.ef48f61b2a19f8:Códigos de recuperación regenerados`,
  "auth.mfa_reauthenticated": $localize`:@@ui.650045ec3c9927:Reautenticación MFA completada`,
  "auth.email_change_requested": $localize`:@@ui.7db77bc4a64919:Cambio de email solicitado`,
  "auth.email_change_cancelled": $localize`:@@ui.0e55f6ade6c6aa:Cambio de email cancelado`,
  "auth.email_change_confirmed": $localize`:@@ui.d9e2e10f9a5b26:Cambio de email confirmado`,
  "auth.emergency_access_revoked": $localize`:@@ui.1a52e7acfe75cc:Acceso revocado por incidente`,
  "auth.account_recovery_completed": $localize`:@@ui.d5a3b5c3dfb052:Recuperación de cuenta completada`,
};

@Component({
  selector: "app-security-center",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, MatSnackBarModule, PageHeaderComponent, PanelSkeletonComponent, AsyncOperationStatusComponent],
  templateUrl: "./security-center.component.html",
  styleUrl: "./security-center.component.scss",
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class SecurityCenterComponent {
  readonly uiText = UI_TEXT;
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly router = inject(Router);
  private readonly snackbar = inject(MatSnackBar);
  private readonly actions = inject(ActionDialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sessionContext = inject(SessionContextService);
  private readonly requests = new LatestRequest(this.destroyRef);
  // Command tickets survive their own sign-out transition, but are replaced
  // by a newer command or destruction. They never cancel an admitted write.
  private readonly commands = new LatestRequest(this.destroyRef);
  private readonly accountRequests = new LatestRequest(this.destroyRef);
  readonly userRefreshRequired = this.auth.userRefreshRequired;
  readonly userMutationUnconfirmed = this.auth.userMutationUnconfirmed;
  readonly recoveryIssueUnconfirmed = this.auth.mfaRecoveryIssueUnconfirmed;
  readonly refreshingAccount = signal(false);
  private readonly sessionDeadline = new ReadDeadline(this.destroyRef, inject(NgZone), () => {
    if (this.renderedContext !== this.contextKey() || !this.eligible() || this.loading()) return;
    this.sessions.update(rows => rows.filter(row => Date.parse(row.expires_at) > Date.now()));
    void this.load();
  });
  private accountKey(): string { return `${this.sessionContext.generation()}:${this.sessionContext.user()?.id}`; }
  private renderedAccount = this.accountKey();
  private readonly contextKey = computed(() => {
    const user = this.sessionContext.user();
    return JSON.stringify([this.sessionContext.generation(), user?.id, user?.emailVerified,
      user?.mfaEnabled, user?.recoveryCodesRemaining, user?.pendingEmail, user?.pendingEmailExpiresAt,
      this.userRefreshRequired(), this.userMutationUnconfirmed(), this.recoveryIssueUnconfirmed()]);
  });
  private renderedContext = this.contextKey();
  private readonly answeredContext = signal<string | null>(null);
  private readonly eligible = computed(() => this.sessionContext.user()?.emailVerified === true);

  readonly snapshot = signal<SecurityCenterSnapshot | null>(null);
  readonly sessions = signal<Session[]>([]);
  /** The server held session rows back: this list is a window, not the registry. */
  readonly sessionsTruncated = signal(false);
  readonly loading = signal(true);
  readonly error = signal<string | null>(null);
  readonly revokingId = signal<string | null>(null);

  private readonly ready = computed(() => this.eligible() && !this.userRefreshRequired()
    && !this.loading() && !this.error() && this.snapshot() !== null
    && this.answeredContext() === this.contextKey() && this.renderedContext === this.contextKey());

  // DestroyRef is not a signal: do not cache view lifetime inside computed.
  canDecide(): boolean { return !this.destroyRef.destroyed && this.ready()
    && this.sessions().every(row => Date.parse(row.expires_at) > Date.now()); }

  constructor() {
    effect(() => {
      const context = this.contextKey();
      untracked(() => {
        if (this.renderedAccount !== this.accountKey()) {
          this.accountRequests.invalidate();
          this.refreshingAccount.set(false);
        }
        this.renderedAccount = this.accountKey();
        this.renderedContext = context;
        this.sessionDeadline.stop();
        this.requests.invalidate();
        this.snapshot.set(null);
        this.sessions.set([]);
        this.sessionsTruncated.set(false);
        this.answeredContext.set(null);
        this.error.set(null);
        this.loading.set(false);
        this.revokingId.set(null);
        if (this.eligible() && !this.userRefreshRequired()) void this.load();
      });
    });
  }

  async load(): Promise<void> {
    if (this.destroyRef.destroyed || !this.eligible() || this.userRefreshRequired() || this.renderedContext !== this.contextKey()) return;
    this.sessionDeadline.stop();
    const request = this.requests.begin(this.contextKey());
    this.loading.set(true);
    this.error.set(null);
    try {
      const [snapshot, listed] = await Promise.all([
        this.api.get<SecurityCenterSnapshot>("/api/v1/auth/security-center", undefined, decodeSecurityCenter, { signal: request.signal }),
        this.auth.listSessions({ signal: request.signal }),
      ]);
      if (!this.requests.isCurrent(request, this.contextKey())) return;
      const now = Date.now();
      this.answeredContext.set(this.contextKey());
      this.snapshot.set(snapshot);
      this.sessions.set(listed.sessions.filter((item) => item.revoked_at === null && Date.parse(item.expires_at) > now));
      this.sessionsTruncated.set(listed.truncated);
      const deadlines = this.sessions().map(row => Date.parse(row.expires_at));
      this.sessionDeadline.schedule(deadlines.length ? Math.min(...deadlines) : null);
    } catch (err) {
      if (!this.requests.isCurrent(request, this.contextKey())) return;
      this.answeredContext.set(null);
      this.snapshot.set(null);
      this.sessions.set([]);
      this.sessionsTruncated.set(false);
      this.error.set(err instanceof ApiRequestError && err.status === 401 ? $localize`:@@ui.ac31539228fd02:Tu sesión ya no está activa.` : err instanceof ApiRequestError ? err.message : $localize`:@@ui.26e6d21f4f1e8c:No se pudo cargar el centro de seguridad`);
    } finally {
      if (this.requests.isCurrent(request, this.contextKey())) this.loading.set(false);
    }
  }

  async refreshAccount(): Promise<void> {
    if (this.destroyRef.destroyed || !this.eligible() || this.refreshingAccount()) return;
    const request = this.accountRequests.begin(this.accountKey());
    const current = () => this.accountRequests.isCurrent(request, this.accountKey());
    this.refreshingAccount.set(true);
    try {
      await this.auth.refreshUser();
    } catch (err) {
      if (current() && !(err instanceof AuthOperationSupersededError)) this.snackbar.open(err instanceof ApiRequestError ? err.message : $localize`:@@ui.0d772dabf374b2:No se pudieron actualizar los datos de la cuenta.`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 5000 });
    } finally {
      if (current()) this.refreshingAccount.set(false);
    }
  }

  private captureIntent(): { context: string; generation: number } | null {
    if (!this.canDecide() || this.revokingId() !== null) return null;
    return { context: this.contextKey(), generation: this.sessionContext.generation() };
  }

  async revoke(session: Session): Promise<void> {
    const intent = this.captureIntent();
    const selected = this.sessions().find(row => row.id === session.id);
    if (!intent || !selected) return;
    const confirmed = await this.actions.confirm({
      title: selected.current ? $localize`:@@ui.ac033b6147e116:Cerrar esta sesión` : $localize`:@@ui.6500e4818a8dcc:Revocar sesión`,
      message: selected.current ? $localize`:@@ui.6fe2c139686296:Tendrás que volver a iniciar sesión en este dispositivo.`
        : $localize`:@@ui.7c29c94c2a03e9:${this.agent(selected.user_agent)} dejará de tener acceso inmediatamente.`,
      confirmLabel: selected.current ? $localize`:@@ui.c6e6960395f49b:Cerrar sesión` : $localize`:@@ui.09a1a14c32b62a:Revocar acceso`,
      destructive: true,
    });
    const live = this.sessions().find(row => row.id === selected.id);
    if (!confirmed || !live || live.current !== selected.current || Date.parse(live.expires_at) <= Date.now()) return;
    await this.runRevocation(selected.id, intent, async () => ({
      signedOut: await this.auth.revokeSession(selected.id, selected.current),
      notice: $localize`:@@ui.eef3d770790a42:Sesión revocada`,
    }), $localize`:@@ui.971a3b33f92d4b:No se pudo revocar la sesión`);
  }

  async closeOtherSessions(): Promise<void> {
    const intent = this.captureIntent();
    if (!intent) return;
    const confirmed = await this.actions.confirm({
      title: $localize`:@@ui.96899890493bf4:Cerrar las demás sesiones`,
      message: $localize`:@@ui.740dc42c43fcf7:Todos los demás dispositivos perderán el acceso inmediatamente. Esta sesión se mantiene abierta.`,
      confirmLabel: $localize`:@@ui.43ea17d0a60160:Cerrar las demás`,
      destructive: true,
    });
    if (!confirmed) return;
    await this.runRevocation("bulk-others", intent, async () => {
      const revoked = await this.auth.revokeOtherSessions();
      return { signedOut: false, notice: revoked > 0 ? `Se cerraron ${revoked} sesiones` : $localize`:@@ui.0682104e392053:No había otras sesiones abiertas` };
    }, $localize`:@@ui.1497e4d3b70fff:No se pudieron cerrar las demás sesiones`);
  }

  async closeAllSessions(): Promise<void> {
    const intent = this.captureIntent();
    if (!intent) return;
    const confirmed = await this.actions.confirm({
      title: $localize`:@@ui.18df0eef524e28:Cerrar todas las sesiones`,
      message: $localize`:@@ui.3f875e171afcb7:Se cerrará la sesión de este dispositivo y la de todos los demás. Tendrás que volver a iniciar sesión.`,
      confirmLabel: $localize`:@@ui.81c52b64777696:Cerrar todas`,
      destructive: true,
    });
    if (!confirmed) return;
    await this.runRevocation("bulk-all", intent, async () => {
      await this.auth.revokeAllSessions();
      return { signedOut: true };
    }, $localize`:@@ui.4598b5bca70954:No se pudieron cerrar las sesiones`);
  }

  private async runRevocation(label: string, intent: { context: string; generation: number },
    command: () => Promise<{ signedOut: boolean; notice?: string }>, fallback: string): Promise<void> {
    // Recheck intent after confirmation, before entering the facade/CSRF path.
    if (!this.canDecide() || this.contextKey() !== intent.context || this.revokingId() !== null) return;
    const ticket = this.commands.begin(intent.context);
    const ownsCommand = () => this.commands.isCurrent(ticket, intent.context);
    const current = () => ownsCommand() && this.contextKey() === intent.context;
    this.revokingId.set(label);
    try {
      const result = await command();
      if (!ownsCommand()) return;
      if (result.signedOut) {
        // The facade deliberately advances exactly once for its own logout.
        // A newer login, even before its response, owns a different generation.
        if (this.sessionContext.generation() !== intent.generation + 1 || this.sessionContext.user() !== null) return;
        const completedContext = this.contextKey();
        const stillClosed = () => ownsCommand() && this.contextKey() === completedContext;
        try {
          const navigated = await this.router.navigate(["/auth"]);
          if (!navigated && stillClosed()) this.snackbar.open($localize`:@@ui.50eb23c1cdbc23:La sesión quedó cerrada. Abre la pantalla de acceso para continuar.`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 5000 });
        } catch {
          if (stillClosed()) this.snackbar.open($localize`:@@ui.b26fd1ec402975:La sesión quedó cerrada, pero no se pudo abrir la pantalla de acceso.`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 5000 });
        }
        return;
      }
      if (!current()) return;
      this.snackbar.open(result.notice!, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: label === "bulk-others" ? 3000 : 2500 });
      await this.load();
    } catch (err) {
      if (current()) this.snackbar.open(err instanceof ApiRequestError ? err.message : fallback, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 4000 });
    } finally {
      if (ownsCommand()) this.revokingId.set(null);
    }
  }

  actionLabel(action: string): string { return ACTION_LABELS[action] ?? $localize`:@@ui.d926b57ad7918b:Actividad de seguridad`; }
  formatDate(value: string | null): string { return dateTimeMediumLabel(value, $localize`:@@ui.dc5e5da4e1a26b:Sin registro disponible`); }
  agent(value: string | null): string { return sessionAgentLabel(value); }
}
