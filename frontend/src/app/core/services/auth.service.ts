import { Injectable, computed, inject, signal } from "@angular/core";
import { ApiRequestError, ApiService } from "./api.service";
import { WorkspaceService } from "./workspace.service";
import {
  decodeAccountDeletionImpact,
  decodeAccountDeletionRequest,
  decodeAuthUserResponse,
  decodeDataExportStatusResponse,
  decodeLoginOutcome,
  decodeLoginResponse,
  decodeMfaReauthentication,
  decodeMfaSessionStatus,
  decodeMfaSetup,
  decodeRecoveryCodes,
  decodeRequiredDataExportResponse,
  decodeSessionRevocation,
  decodeSessionsResponse,
  decodeWorkspacesResponse,
} from "./auth-response-decoders";
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

/** Internal control-flow error: a newer auth transition owns the UI state. */
export class AuthOperationSupersededError extends Error {
  constructor() {
    super("La operación de autenticación fue reemplazada por otra más reciente");
    this.name = "AuthOperationSupersededError";
  }
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
  private generation = 0;
  private workspaceRequest = 0;

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

  /**
   * Every operation captures this value before awaiting the network. Any
   * logout, invalidation or newer login increments it, so an old response can
   * no longer resurrect or overwrite a different browser session.
   */
  sessionGeneration(): number {
    return this.generation;
  }

  private nextGeneration(): number {
    this.generation += 1;
    return this.generation;
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  private assertCurrent(generation: number): void {
    if (!this.isCurrent(generation)) throw new AuthOperationSupersededError();
  }

  /** Load /auth/me + workspaces once at startup, coalescing concurrent guards. */
  init(): Promise<void> {
    if (this.loaded()) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    const generation = this.generation;
    const operation = (async () => {
      try {
        const { user } = await this.api.get<{ user: AuthUser }>("/api/v1/auth/me", undefined, decodeAuthUserResponse);
        this.assertCurrent(generation);
        this.user.set(user);
        await this.refreshWorkspaces(generation);
        this.assertCurrent(generation);
        this.loaded.set(true);
      } catch (error) {
        if (!this.isCurrent(generation)) return;
        this.user.set(null);
        // A definitive 401 means initialization completed anonymously. A
        // transport/5xx failure remains retryable and preserves the stored
        // workspace preference for the next attempt.
        if (error instanceof ApiRequestError && error.status === 401) {
          this.clearLocalAuth();
          this.loaded.set(true);
        } else {
          this.loaded.set(false);
        }
      }
    })();
    this.initPromise = operation;
    // `operation` absorbs expected failures above, so this cleanup branch
    // cannot create an unhandled rejection while making a later retry possible.
    void operation.then(() => {
      if (this.initPromise === operation) this.initPromise = undefined;
    });

    return operation;
  }

  async refreshWorkspaces(generation = this.generation): Promise<boolean> {
    const request = ++this.workspaceRequest;
    try {
      const { workspaces } = await this.api.get<{ workspaces: Workspace[] }>("/api/v1/workspaces", undefined, decodeWorkspacesResponse);
      if (!this.isCurrent(generation) || request !== this.workspaceRequest) return false;
      this.workspaces.setList(workspaces);
      return true;
    } catch {
      // Keep the last known list on a transient failure. Clearing it here made
      // an old failed request erase a newer successful response.
      return false;
    }
  }

  async login(email: string, password: string, captchaToken: string): Promise<LoginOutcome> {
    // A login attempt must never leave an older local identity visible while
    // the server is deciding whether this account is allowed to sign in.
    const generation = this.nextGeneration();
    this.sessionInvalidated.set(false);
    this.clearLocalAuth();
    try {
      const res = await this.api.post<LoginOutcome>("/api/v1/auth/login", { email, password, captchaToken }, decodeLoginOutcome);
      this.assertCurrent(generation);
      this.loaded.set(true);
      if (res.mfaRequired) return res;
      this.user.set(res.user);
      this.adminMfaReauthenticationRequired.set(false);
      await this.refreshWorkspaces(generation);
      this.assertCurrent(generation);
      return res;
    } catch (err) {
      if (this.isCurrent(generation)) this.clearLocalAuth();
      throw err;
    }
  }

  async verifyMfa(challenge: string, code: string): Promise<void> {
    const generation = this.nextGeneration();
    const res = await this.api.post<LoginResponse>("/api/v1/auth/mfa/verify", { challenge, code }, decodeLoginResponse);
    this.assertCurrent(generation);
    this.user.set(res.user);
    this.loaded.set(true);
    this.adminMfaReauthenticationRequired.set(false);
    await this.refreshWorkspaces(generation);
    this.assertCurrent(generation);
  }

  async recoverMfa(challenge: string, code: string): Promise<void> {
    const generation = this.nextGeneration();
    const res = await this.api.post<LoginResponse>("/api/v1/auth/mfa/recovery", { challenge, code }, decodeLoginResponse);
    this.assertCurrent(generation);
    this.user.set(res.user);
    this.loaded.set(true);
    this.adminMfaReauthenticationRequired.set(false);
    await this.refreshWorkspaces(generation);
    this.assertCurrent(generation);
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
    const generation = this.nextGeneration();
    this.sessionInvalidated.set(false);
    await this.api.post("/api/v1/auth/logout");
    this.assertCurrent(generation);
    this.clearLocalAuth();
    this.loaded.set(true);
    this.announceInvalidation();
  }

  /** Called by the HTTP interceptor when a previously live session is revoked. */
  sessionExpired(expectedGeneration = this.generation): void {
    if (!this.isCurrent(expectedGeneration)) return;
    this.invalidateLocalSession(true);
  }

  /** Reconcile a confirmed cookie/session revocation without erasing a newer login. */
  accountSignedOut(expectedGeneration = this.generation): boolean {
    if (!this.isCurrent(expectedGeneration)) return false;
    this.nextGeneration();
    this.sessionInvalidated.set(false);
    this.clearLocalAuth();
    this.loaded.set(true);
    this.announceInvalidation();
    return true;
  }

  private invalidateLocalSession(announce: boolean): void {
    this.nextGeneration();
    this.sessionInvalidated.set(true);
    this.clearLocalAuth();
    this.loaded.set(true);
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
    const generation = this.generation;
    const { user } = await this.api.get<{ user: AuthUser }>("/api/v1/auth/me", undefined, decodeAuthUserResponse);
    this.assertCurrent(generation);
    this.sessionInvalidated.set(false);
    this.user.set(user);
    return user;
  }

  /** Refresh the local identity after security-sensitive account changes. */
  async refreshUser(): Promise<void> {
    await this.me();
  }

  async mfaSessionStatus(): Promise<MfaSessionStatus> {
    const generation = this.generation;
    const status = await this.api.get<MfaSessionStatus>("/api/v1/auth/mfa/session", undefined, decodeMfaSessionStatus);
    this.assertCurrent(generation);
    if (status.fresh) this.adminMfaReauthenticationRequired.set(false);
    return status;
  }

  async reauthenticateMfa(password: string, factorCode: string): Promise<{ verifiedAt: string; expiresAt: string }> {
    const generation = this.generation;
    const result = await this.api.post<{ ok: true; verifiedAt: string; expiresAt: string }>(
      "/api/v1/auth/mfa/reauthenticate",
      { password, factorCode },
      decodeMfaReauthentication,
    );
    this.assertCurrent(generation);
    this.adminMfaReauthenticationRequired.set(false);
    return { verifiedAt: result.verifiedAt, expiresAt: result.expiresAt };
  }

  requireAdminMfaReauthentication(expectedGeneration = this.generation): void {
    if (!this.isCurrent(expectedGeneration)) return;
    if (this.authenticated()) this.adminMfaReauthenticationRequired.set(true);
  }

  clearAdminMfaReauthentication(): void {
    this.adminMfaReauthenticationRequired.set(false);
  }

  async updateProfile(name: string): Promise<AuthUser> {
    const generation = this.generation;
    const { user } = await this.api.patch<{ user: AuthUser }>("/api/v1/auth/profile", { name }, decodeAuthUserResponse);
    this.assertCurrent(generation);
    this.user.set(user);
    return user;
  }

  async changePassword(current: string, newPassword: string, factorCode?: string): Promise<void> {
    const generation = this.generation;
    await this.api.post("/api/v1/auth/change-password", {
      current,
      newPassword,
      ...(factorCode ? { factorCode } : {}),
    });
    this.assertCurrent(generation);
  }

  async requestEmailChange(newEmail: string, password: string, factorCode?: string): Promise<AuthUser> {
    const generation = this.generation;
    const { user } = await this.api.post<{ user: AuthUser }>("/api/v1/auth/change-email", {
      newEmail,
      password,
      ...(factorCode ? { factorCode } : {}),
    }, decodeAuthUserResponse);
    this.assertCurrent(generation);
    this.user.set(user);
    return user;
  }

  async cancelEmailChange(password: string, factorCode?: string): Promise<AuthUser> {
    const generation = this.generation;
    const { user } = await this.api.post<{ user: AuthUser }>("/api/v1/auth/change-email/cancel", {
      password,
      ...(factorCode ? { factorCode } : {}),
    }, decodeAuthUserResponse);
    this.assertCurrent(generation);
    this.user.set(user);
    return user;
  }

  async dataExportStatus(): Promise<DataExportStatus | null> {
    const generation = this.generation;
    const { export: status } = await this.api.get<{ export: DataExportStatus | null }>("/api/v1/auth/data-export", undefined, decodeDataExportStatusResponse);
    this.assertCurrent(generation);
    return status;
  }

  async requestDataExport(password: string, factorCode?: string): Promise<DataExportStatus> {
    const generation = this.generation;
    const { export: status } = await this.api.post<{ export: DataExportStatus }>("/api/v1/auth/data-export", {
      password,
      ...(factorCode ? { factorCode } : {}),
    }, decodeRequiredDataExportResponse);
    this.assertCurrent(generation);
    return status;
  }

  async cancelDataExport(): Promise<void> {
    const generation = this.generation;
    await this.api.post("/api/v1/auth/data-export/cancel");
    this.assertCurrent(generation);
  }

  async accountDeletionImpact(): Promise<AccountDeletionImpact> {
    const generation = this.generation;
    const impact = await this.api.get<AccountDeletionImpact>("/api/v1/auth/account-deletion", undefined, decodeAccountDeletionImpact);
    this.assertCurrent(generation);
    return impact;
  }

  async requestAccountDeletion(password: string, confirmation: string, factorCode?: string): Promise<{ status: "requested"; confirmationExpiresAt: string }> {
    const generation = this.generation;
    const result = await this.api.post<{ status: "requested"; confirmationExpiresAt: string }>("/api/v1/auth/account-deletion", {
      password,
      confirmation,
      ...(factorCode ? { factorCode } : {}),
    }, decodeAccountDeletionRequest);
    this.assertCurrent(generation);
    return result;
  }

  async listSessions(): Promise<Session[]> {
    const generation = this.generation;
    const { sessions } = await this.api.get<{ sessions: Session[] }>("/api/v1/auth/sessions", undefined, decodeSessionsResponse);
    this.assertCurrent(generation);
    return sessions;
  }

  async revokeSession(id: string, current = false): Promise<boolean> {
    const generation = this.generation;
    const result = await this.api.post<{ ok: true; current?: boolean }>(
      `/api/v1/auth/sessions/${encodeURIComponent(id)}/revoke`,
      undefined,
      decodeSessionRevocation,
    );
    this.assertCurrent(generation);
    if (current || result.current) this.sessionExpired();
    return result.current === true || current;
  }

  async mfaSetup(password: string, code?: string): Promise<{ secret: string; uri: string }> {
    const generation = this.generation;
    const result = await this.api.post<{ secret: string; uri: string }>("/api/v1/auth/mfa/setup", { password, code }, decodeMfaSetup);
    this.assertCurrent(generation);
    return result;
  }

  async mfaEnable(code: string): Promise<{ recoveryCodes: string[] }> {
    const generation = this.generation;
    const result = await this.api.post<{ recoveryCodes: string[] }>("/api/v1/auth/mfa/enable", { code }, decodeRecoveryCodes);
    this.assertCurrent(generation);
    return result;
  }

  async mfaCancelSetup(): Promise<void> {
    const generation = this.generation;
    await this.api.post("/api/v1/auth/mfa/cancel-setup");
    this.assertCurrent(generation);
  }

  async mfaRegenerateRecoveryCodes(password: string, factorCode: string): Promise<{ recoveryCodes: string[] }> {
    const generation = this.generation;
    const result = await this.api.post<{ recoveryCodes: string[] }>("/api/v1/auth/mfa/recovery-codes/regenerate", {
      password,
      factorCode,
    }, decodeRecoveryCodes);
    this.assertCurrent(generation);
    return result;
  }

  async mfaDisable(password: string, code: string): Promise<void> {
    const generation = this.generation;
    await this.api.post("/api/v1/auth/mfa/disable", { password, code });
    this.assertCurrent(generation);
  }
}
