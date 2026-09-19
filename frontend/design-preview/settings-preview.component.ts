import { ChangeDetectionStrategy, Component, signal, viewChild } from "@angular/core";
import { MatButtonModule } from "@angular/material/button";
import { SettingsComponent } from "../src/app/panel/settings/settings.component";
import { AuthService } from "../src/app/core/services/auth.service";
import { ApiService } from "../src/app/core/services/api.service";
import type { AccountDeletionImpact, AuthUser, SessionList } from "../src/app/core/models";
import { blocked } from "./workspace-fixture";

// This provider is compiled only into design-preview. All mutation methods reject;
// even an accidental submit cannot reach an account or a backend.
const user = signal<AuthUser>({ id: 900001, name: "Marina del Río", email: "marina@example.invalid", isAdmin: false, emailVerified: true, mfaEnabled: true, recoveryCodesRemaining: 8 });
const previewAuth = {
  user, sessionGeneration: () => 1,
  listSessions: async (): Promise<SessionList> => ({ truncated: false, sessions: [{ id: "fictional-session", user_agent: "Chrome · Windows · Dispositivo de ejemplo", created_at: "2026-09-14T10:00:00Z", last_used_at: "2026-09-14T10:00:00Z", expires_at: "2099-01-01T00:00:00Z", revoked_at: null, mfa_verified_at: "2026-09-14T10:00:00Z", current: true }] }),
  dataExportStatus: async () => null,
  accountDeletionImpact: async (): Promise<AccountDeletionImpact> => ({ canDelete: true, isPlatformAdmin: false, ownedWorkspaces: [], blockingPrivacyRequests: [], request: null }),
  updateProfile: blocked, requestEmailChange: blocked, cancelEmailChange: blocked,
  changePassword: blocked, requestDataExport: blocked, cancelDataExport: blocked,
  requestAccountDeletion: blocked, revokeSession: blocked, refreshUser: blocked,
  mfaSetup: blocked, mfaEnable: blocked, mfaDisable: blocked, mfaCancelSetup: blocked,
  mfaRegenerateRecoveryCodes: blocked,
};

@Component({
  selector: "app-settings-preview", standalone: true,
  imports: [SettingsComponent, MatButtonModule], changeDetection: ChangeDetectionStrategy.OnPush,
  providers: [
    { provide: AuthService, useValue: previewAuth },
    { provide: ApiService, useValue: {
      get: async (path: string, params: { page: number; perPage: number }, decode: (value: unknown) => unknown) => {
        if (path !== "/api/v1/auth/privacy-requests") return blocked();
        return decode({ requests: [], total: 0, page: params.page, perPage: params.perPage });
      }, post: blocked, patch: blocked, delete: blocked,
    } },
  ],
  template: `<p class="preview-notice">Vista de diseño · cuenta ficticia · cambios de cuenta bloqueados</p>
    <div class="preview-tools" role="group" aria-label="Escenarios ficticios">
      <button mat-stroked-button (click)="scenario('ready')">Cuenta de ejemplo</button>
      <button mat-stroked-button (click)="scenario('pending')">Email pendiente</button>
      <button mat-stroked-button (click)="scenario('error')">Error de lectura</button>
      <button mat-stroked-button (click)="scenario('loading')">Cargando datos</button>
    </div><app-settings />`,
  styles: `.preview-notice { padding: 10px; border: 1px dashed var(--line); color: var(--muted); font-size: 12px; } .preview-tools { display:flex; flex-wrap:wrap; gap:8px; margin-bottom:20px; }`,
})
export class SettingsPreviewComponent {
  private readonly settings = viewChild.required(SettingsComponent);

  // Presentation states only. These controls never simulate successful writes.
  scenario(mode: "ready" | "pending" | "error" | "loading"): void {
    const settings = this.settings();
    user.update(current => ({ ...current, pendingEmail: mode === "pending" ? "direccion.pendiente.de.confirmar@example.invalid" : null, pendingEmailExpiresAt: mode === "pending" ? "2099-01-01T00:00:00Z" : null }));
    settings.sessionsLoading.set(mode === "loading");
    settings.privacyLoading.set(mode === "loading");
    settings.exportLoading.set(mode === "loading");
    settings.deletionLoading.set(mode === "loading");
    settings.sessionsError.set(mode === "error" ? "No se pudieron cargar las sesiones" : null);
    settings.privacyError.set(mode === "error" ? "No se pudieron cargar las solicitudes" : null);
    if (mode === "error") settings.sessions.set([]);
    else if (mode === "ready") void settings.loadSessions();
  }
}
