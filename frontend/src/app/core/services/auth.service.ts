import { Injectable, computed, inject, signal } from "@angular/core";
import { ApiService } from "./api.service";
import { WorkspaceService } from "./workspace.service";
import type { AuthUser, Session, Workspace } from "../models";

const AUTH_INVALIDATION_KEY = "uvh.auth.invalidated";

export interface LoginResponse {
  mfaRequired?: false;
  user: AuthUser;
}
export interface MfaRequiredResponse {
  mfaRequired: true;
  challenge: string;
}
export type LoginOutcome = LoginResponse | MfaRequiredResponse;

@Injectable({ providedIn: "root" })
export class AuthService {
  private api = inject(ApiService);
  private workspaces = inject(WorkspaceService);

  readonly user = signal<AuthUser | null>(null);
  readonly loaded = signal(false);
  readonly authenticated = computed(() => this.user() !== null);
  /** True when the server rejected the session and the panel must close. */
  readonly sessionInvalidated = signal(false);
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

  async login(email: string, password: string): Promise<LoginOutcome> {
    // A login attempt must never leave an older local identity visible while
    // the server is deciding whether this account is allowed to sign in.
    this.sessionInvalidated.set(false);
    this.clearLocalAuth();
    try {
      const res = await this.api.post<LoginOutcome>("/api/v1/auth/login", { email, password });
      if (res.mfaRequired) return res;
      this.user.set(res.user);
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
    await this.refreshWorkspaces();
  }

  async recoverMfa(email: string, code: string): Promise<void> {
    const res = await this.api.post<LoginResponse>("/api/v1/auth/mfa/recovery", { email, code });
    this.user.set(res.user);
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
      captchaChallenge: string;
      captchaAnswer: string;
      website?: string;
      acceptTerms: boolean;
      termsVersion: string;
    },
  ): Promise<void> {
    await this.api.post<{ user: null }>("/api/v1/auth/register", {
      name,
      email,
      password,
      ...antiBot,
    });
  }

  async resendVerification(email?: string): Promise<void> {
    await this.api.post<{ ok: true }>("/api/v1/auth/resend-verification", email ? { email } : {});
  }

  async changeRegistrationEmail(
    currentEmail: string,
    newEmail: string,
    password: string,
    antiBot: { captchaChallenge: string; captchaAnswer: string; website?: string },
  ): Promise<void> {
    await this.api.post<{ ok: true }>("/api/v1/auth/change-registration-email", {
      currentEmail,
      newEmail,
      password,
      ...antiBot,
    });
  }

  /**
   * Start the server-side logout and clear local access immediately. The
   * request still carries the current httpOnly cookie; a transient network
   * error cannot leave the SPA showing a live authenticated panel.
   */
  async logout(): Promise<void> {
    // This is an intentional local logout, so the root shell must not treat it
    // as an unexpected remote session invalidation and redirect twice.
    this.sessionInvalidated.set(false);
    const request = this.api.post("/api/v1/auth/logout");
    this.clearLocalAuth();
    this.announceInvalidation();
    try {
      await request;
    } catch {
      // Local logout is already complete; the next authenticated request will
      // fail closed if the server was unreachable during revocation.
    }
  }

  /** Called by the HTTP interceptor when a previously live session is revoked. */
  sessionExpired(): void {
    this.invalidateLocalSession(true);
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

  async updateProfile(name: string): Promise<AuthUser> {
    const { user } = await this.api.patch<{ user: AuthUser }>("/api/v1/auth/profile", { name });
    this.user.set(user);
    return user;
  }

  async changePassword(current: string, newPassword: string): Promise<void> {
    await this.api.post("/api/v1/auth/change-password", { current, newPassword });
  }

  async listSessions(): Promise<Session[]> {
    const { sessions } = await this.api.get<{ sessions: Session[] }>("/api/v1/auth/sessions");
    return sessions;
  }

  async revokeSession(id: string, current = false): Promise<boolean> {
    // The session list already tells us whether this is the current browser.
    // Clear the local identity before awaiting the response for an immediate
    // UI lockout; the backend also revokes the hashed cookie session atomically.
    const request = this.api.post<{ ok: true; current?: boolean }>(
      `/api/v1/auth/sessions/${encodeURIComponent(id)}/revoke`,
    );
    if (current) this.sessionExpired();
    const result = await request;
    if (result.current && !current) this.sessionExpired();
    return result.current === true || current;
  }

  async mfaSetup(password: string, code?: string): Promise<{ secret: string; uri: string }> {
    return this.api.post<{ secret: string; uri: string }>("/api/v1/auth/mfa/setup", { password, code });
  }

  async mfaEnable(code: string): Promise<{ recoveryCodes: string[] }> {
    return this.api.post<{ recoveryCodes: string[] }>("/api/v1/auth/mfa/enable", { code });
  }

  async mfaDisable(password: string, code: string): Promise<void> {
    await this.api.post("/api/v1/auth/mfa/disable", { password, code });
  }
}
