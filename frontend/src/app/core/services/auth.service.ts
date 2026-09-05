import { Injectable, computed, inject, signal } from "@angular/core";
import { ApiService } from "./api.service";
import { WorkspaceService } from "./workspace.service";
import type { AccountDeletionImpact, AuthUser, DataExportStatus, Session, Workspace } from "../models";

const AUTH_INVALIDATION_KEY = "uvh.auth.invalidated";

export interface LoginResponse {
  mfaRequired?: false;
  user: AuthUser;
}
export interface MfaRequiredResponse {
  mfaRequired: true;
  challenge: string;
  recoveryAvailable: boolean;
}
export type LoginOutcome = LoginResponse | MfaRequiredResponse;

export interface MfaSessionStatus {
  enabled: boolean;
  fresh: boolean;
  verifiedAt: string | null;
  expiresAt: string | null;
}

@Injectable({ providedIn: "root" })
export class AuthService {
  private api = inject(ApiService);
  private workspaces = inject(WorkspaceService);

  readonly user = signal<AuthUser | null>(null);
  readonly loaded = signal(false);
  readonly authenticated = computed(() => this.user() !== null);
  /** True when the server rejected the session and the panel must close. */
  readonly sessionInvalidated = signal(false);
  readonly adminMfaReauthenticationRequired = signal(false);
  private initPromise?: Promise<void>;

  /**
   * A revoke/logout in one browser tab must close the other tabs too. The event
   * carries no credential; it is only a monotonic local-storage marker and is
   * therefore safe to use for cross-tab invalidation.
   */
  private readonly onStorage = (event: StorageEvent): void => {
    if (event.key !== AUTH_INVALIDATION_KEY || !event.newValue || !this.authenticated()) return;
    this.invalidateLocalSession(false);
  };

  constructor() {
    if (typeof window !== "undefined") {
      window.addEventListener("storage", this.onStorage);
    }
  }

  /** Clear the local identity before waiting on the network. */
  private clearLocalAuth(): void {
    this.user.set(null);
    this.adminMfaReauthenticationRequired.set(false);
    this.workspaces.setList([]);
    this.workspaces.select(null);
  }

  /** Load /auth/me + workspaces once at startup, coalescing concurrent guards. */
  init(): Promise<void> {
    if (this.loaded()) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    this.initPromise = (async () => {
      try {
        const { user } = await this.api.get<{ user: AuthUser }>("/api/v1/auth/me");
        this.user.set(user);
        await this.refreshWorkspaces();
      } catch {
        this.user.set(null);
        this.workspaces.setList([]);
      } finally {
        this.loaded.set(true);
      }
    })();

    return this.initPromise;
  }

  async refreshWorkspaces(): Promise<void> {
    try {
      const { workspaces } = await this.api.get<{ workspaces: Workspace[] }>("/api/v1/workspaces");
      this.workspaces.setList(workspaces);
    } catch {
      this.workspaces.setList([]);
    }
  }

  async login(email: string, password: string, captchaToken: string): Promise<LoginOutcome> {
    // A login attempt must never leave an older local identity visible while
    // the server is deciding whether this account is allowed to sign in.
    this.sessionInvalidated.set(false);
    this.clearLocalAuth();
    try {
      const res = await this.api.post<LoginOutcome>("/api/v1/auth/login", { email, password, captchaToken });
      if (res.mfaRequired) return res;
      this.user.set(res.user);
      this.adminMfaReauthenticationRequired.set(false);
      await this.refreshWorkspaces();
      return res;
    } catch (err) {
      this.clearLocalAuth();
      throw err;
    }
  }

  async verifyMfa(challenge: string, code: string): Promise<void> {
    const res = await this.api.post<LoginResponse>("/api/v1/auth/mfa/verify", { challenge, code });
    this.user.set(res.user);
    this.adminMfaReauthenticationRequired.set(false);
    await this.refreshWorkspaces();
  }

  async recoverMfa(challenge: string, code: string): Promise<void> {
    const res = await this.api.post<LoginResponse>("/api/v1/auth/mfa/recovery", { challenge, code });
    this.user.set(res.user);
    this.adminMfaReauthenticationRequired.set(false);
    await this.refreshWorkspaces();
  }

  /**
   * Registration always returns the same generic body (anti-enumeration); it
   * never creates a session. The UI then shows the "check your email" step.
   */
  async register(
    name: string,
    email: string,
    password: string,
    antiBot: {
      captchaToken: string;
      website?: string;
      acceptTerms: boolean;
      termsVersion: string;
      privacyVersion: string;
    },
  ): Promise<void> {
    await this.api.post<{ user: null }>("/api/v1/auth/register", {
      name,
      email,
      password,
      ...antiBot,
    });
  }

  async resendVerification(email: string | undefined, captchaToken: string): Promise<void> {
    await this.api.post<{ ok: true }>("/api/v1/auth/resend-verification", { email, captchaToken });
  }

  async changeRegistrationEmail(
    currentEmail: string,
    newEmail: string,
    password: string,
    antiBot: { captchaToken: string; website?: string },
  ): Promise<void> {
    await this.api.post<{ ok: true }>("/api/v1/auth/change-registration-email", {
      currentEmail,
      newEmail,
      password,
      ...antiBot,
    });
  }

  /** Confirm server-side revocation before representing the session as closed. */
  async logout(): Promise<void> {
    this.sessionInvalidated.set(false);
    await this.api.post("/api/v1/auth/logout");
    this.clearLocalAuth();
    this.announceInvalidation();
  }

  /** Called by the HTTP interceptor when a previously live session is revoked. */
  sessionExpired(): void {
    this.invalidateLocalSession(true);
  }

  /** A confirmed account change revoked every server session intentionally. */
  accountSignedOut(): void {
    this.sessionInvalidated.set(false);
    this.clearLocalAuth();
    this.announceInvalidation();
  }

  private invalidateLocalSession(announce: boolean): void {
    this.sessionInvalidated.set(true);
    this.clearLocalAuth();
    if (announce) this.announceInvalidation();
  }

  private announceInvalidation(): void {
    if (typeof window === "undefined") return;
    try {
      localStorage.setItem(AUTH_INVALIDATION_KEY, `${Date.now()}-${Math.random().toString(36).slice(2)}`);
    } catch {
      // Storage can be disabled; the current tab is still cleared locally.
    }
  }

  async me(): Promise<AuthUser> {
    const { user } = await this.api.get<{ user: AuthUser }>("/api/v1/auth/me");
    this.sessionInvalidated.set(false);
    this.user.set(user);
    return user;
  }

  /** Refresh the local identity after security-sensitive account changes. */
  async refreshUser(): Promise<void> {
    await this.me();
  }

  async mfaSessionStatus(): Promise<MfaSessionStatus> {
    const status = await this.api.get<MfaSessionStatus>("/api/v1/auth/mfa/session");
    if (status.fresh) this.adminMfaReauthenticationRequired.set(false);
    return status;
  }

  async reauthenticateMfa(password: string, factorCode: string): Promise<{ verifiedAt: string; expiresAt: string }> {
    const result = await this.api.post<{ ok: true; verifiedAt: string; expiresAt: string }>(
      "/api/v1/auth/mfa/reauthenticate",
      { password, factorCode },
    );
    this.adminMfaReauthenticationRequired.set(false);
    return { verifiedAt: result.verifiedAt, expiresAt: result.expiresAt };
  }

  requireAdminMfaReauthentication(): void {
    if (this.authenticated()) this.adminMfaReauthenticationRequired.set(true);
  }

  clearAdminMfaReauthentication(): void {
    this.adminMfaReauthenticationRequired.set(false);
  }

  async updateProfile(name: string): Promise<AuthUser> {
    const { user } = await this.api.patch<{ user: AuthUser }>("/api/v1/auth/profile", { name });
    this.user.set(user);
    return user;
  }

  async changePassword(current: string, newPassword: string, factorCode?: string): Promise<void> {
    await this.api.post("/api/v1/auth/change-password", {
      current,
      newPassword,
      ...(factorCode ? { factorCode } : {}),
    });
  }

  async requestEmailChange(newEmail: string, password: string, factorCode?: string): Promise<AuthUser> {
    const { user } = await this.api.post<{ user: AuthUser }>("/api/v1/auth/change-email", {
      newEmail,
      password,
      ...(factorCode ? { factorCode } : {}),
    });
    this.user.set(user);
    return user;
  }

  async cancelEmailChange(password: string, factorCode?: string): Promise<AuthUser> {
    const { user } = await this.api.post<{ user: AuthUser }>("/api/v1/auth/change-email/cancel", {
      password,
      ...(factorCode ? { factorCode } : {}),
    });
    this.user.set(user);
    return user;
  }

  async dataExportStatus(): Promise<DataExportStatus | null> {
    const { export: status } = await this.api.get<{ export: DataExportStatus | null }>("/api/v1/auth/data-export");
    return status;
  }

  async requestDataExport(password: string, factorCode?: string): Promise<DataExportStatus> {
    const { export: status } = await this.api.post<{ export: DataExportStatus }>("/api/v1/auth/data-export", {
      password,
      ...(factorCode ? { factorCode } : {}),
    });
    return status;
  }

  async cancelDataExport(): Promise<void> {
    await this.api.post("/api/v1/auth/data-export/cancel");
  }

  async accountDeletionImpact(): Promise<AccountDeletionImpact> {
    return this.api.get<AccountDeletionImpact>("/api/v1/auth/account-deletion");
  }

  async requestAccountDeletion(password: string, confirmation: string, factorCode?: string): Promise<{ status: "requested"; confirmationExpiresAt: string }> {
    return this.api.post("/api/v1/auth/account-deletion", {
      password,
      confirmation,
      ...(factorCode ? { factorCode } : {}),
    });
  }

  async listSessions(): Promise<Session[]> {
    const { sessions } = await this.api.get<{ sessions: Session[] }>("/api/v1/auth/sessions");
    return sessions;
  }

  async revokeSession(id: string, current = false): Promise<boolean> {
    const result = await this.api.post<{ ok: true; current?: boolean }>(
      `/api/v1/auth/sessions/${encodeURIComponent(id)}/revoke`,
    );
    if (current || result.current) this.sessionExpired();
    return result.current === true || current;
  }

  async mfaSetup(password: string, code?: string): Promise<{ secret: string; uri: string }> {
    return this.api.post<{ secret: string; uri: string }>("/api/v1/auth/mfa/setup", { password, code });
  }

  async mfaEnable(code: string): Promise<{ recoveryCodes: string[] }> {
    return this.api.post<{ recoveryCodes: string[] }>("/api/v1/auth/mfa/enable", { code });
  }

  async mfaCancelSetup(): Promise<void> {
    await this.api.post("/api/v1/auth/mfa/cancel-setup");
  }

  async mfaRegenerateRecoveryCodes(password: string, factorCode: string): Promise<{ recoveryCodes: string[] }> {
    return this.api.post<{ recoveryCodes: string[] }>("/api/v1/auth/mfa/recovery-codes/regenerate", {
      password,
      factorCode,
    });
  }

  async mfaDisable(password: string, code: string): Promise<void> {
    await this.api.post("/api/v1/auth/mfa/disable", { password, code });
  }
}
