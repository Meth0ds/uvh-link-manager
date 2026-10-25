import type { Session } from "../../core/models";
import { ApiRequestError } from "../../core/services/api.service";
import type { SettingsComponent } from "./settings.component";

interface SettingsSessionsCoordinatorContext {
  readonly accountContext: SettingsComponent["accountContext"];
  readonly auth: SettingsComponent["auth"];
  readonly destroyRef: SettingsComponent["destroyRef"];
  readonly router: SettingsComponent["router"];
  readonly sessionDeadline: SettingsComponent["sessionDeadline"];
  sessionDeadlineContext: SettingsComponent["sessionDeadlineContext"];
  readonly sessionRevocationRequests: SettingsComponent["sessionRevocationRequests"];
  readonly sessions: SettingsComponent["sessions"];
  readonly sessionsError: SettingsComponent["sessionsError"];
  readonly sessionsLoading: SettingsComponent["sessionsLoading"];
  readonly sessionsRequest: SettingsComponent["sessionsRequest"];
  readonly sessionsTruncated: SettingsComponent["sessionsTruncated"];
  readonly snackbar: SettingsComponent["snackbar"];
  readonly toast: SettingsComponent["toast"];
  readonly user: SettingsComponent["user"];
}

/** Behaviour coordinator; forms and signals remain owned by the mounted view. */
export class SettingsSessionsCoordinator {
  constructor(private readonly context: SettingsSessionsCoordinatorContext) {}

  async loadSessions(): Promise<void> {
    if (!this.context.user() || this.context.destroyRef.destroyed) return;
    this.context.sessionDeadline.stop();
    const context = this.context.accountContext();
    const request = this.context.sessionsRequest.begin(context);
    this.context.sessionsLoading.set(true);
    this.context.sessionsError.set(null);
    try {
      const { sessions, truncated } = await this.context.auth.listSessions({ signal: request.signal });
      if (!this.context.sessionsRequest.isCurrent(request, this.context.accountContext())) return;
      const now = Date.now();
      this.context.sessions.set(sessions.filter((session) => !session.revoked_at && new Date(session.expires_at).getTime() > now));
      this.context.sessionsTruncated.set(truncated);
      this.context.sessionDeadlineContext = context;
      const deadlines = this.context.sessions().map(row => Date.parse(row.expires_at));
      this.context.sessionDeadline.schedule(deadlines.length ? Math.min(...deadlines) : null);
    } catch (err) {
      if (!this.context.sessionsRequest.isCurrent(request, this.context.accountContext())) return;
      this.context.sessions.set([]);
      this.context.sessionsTruncated.set(false);
      this.context.sessionsError.set(err instanceof ApiRequestError ? err.message : $localize`:@@ui.0a77c5488d3df2:No se pudieron cargar las sesiones`);
    } finally {
      if (this.context.sessionsRequest.isCurrent(request, this.context.accountContext())) this.context.sessionsLoading.set(false);
    }
  }

  async revokeSession(session: Session): Promise<void> {
    if (!this.context.user() || this.context.destroyRef.destroyed || this.context.sessionsLoading() || this.context.sessionsError()
      || session.revoked_at !== null || Date.parse(session.expires_at) <= Date.now()) return;
    const generation = this.context.auth.sessionGeneration();
    const context = this.context.accountContext();
    const request = this.context.sessionRevocationRequests.begin(context);
    const live = () => this.context.sessionRevocationRequests.isCurrent(request, context);
    let revokedCurrent: boolean;
    try {
      revokedCurrent = await this.context.auth.revokeSession(session.id, session.current);
    } catch (err) {
      if (live() && this.context.accountContext() === context) this.context.toast(err, $localize`:@@ui.971a3b33f92d4b:No se pudo revocar la sesión`);
      return;
    }
    if (!live()) return;
    const completedContext = this.context.accountContext();
    // Revoking this browser deliberately expires its own local identity. Only
    // that single transition may navigate; a newer login owns its own route.
    const ownLogout = revokedCurrent && this.context.auth.sessionGeneration() === generation + 1 && this.context.auth.user() === null;
    if (completedContext !== context && !ownLogout) return;
    const current = () => live() && this.context.accountContext() === completedContext;
    if (revokedCurrent) {
      try {
        const navigated = await this.context.router.navigate(["/auth"]);
        if (!current()) return;
        if (!navigated) this.context.snackbar.open($localize`:@@ui.e6482d2ddd1e69:La sesión quedó revocada. Abre la pantalla de acceso para continuar.`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 5000 });
      } catch {
        if (current()) this.context.snackbar.open($localize`:@@ui.36ad28621f6de0:La sesión quedó revocada, pero no se pudo abrir la pantalla de acceso.`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 5000 });
      }
      return;
    }
    this.context.snackbar.open($localize`:@@ui.eef3d770790a42:Sesión revocada`, $localize`:@@ui.aeccae342e4bd0:Cerrar`, { duration: 2500 });
    void this.loadSessions();
  }
}
