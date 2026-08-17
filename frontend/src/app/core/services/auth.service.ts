import { Injectable, computed, inject, signal } from "@angular/core";
import { ApiService } from "./api.service";
import { WorkspaceService } from "./workspace.service";
import type { AuthUser, Session, Workspace } from "../models";

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

  /** Load /auth/me + workspaces once at startup. */
  async init(): Promise<void> {
    try {
      const { user } = await this.api.get<{ user: AuthUser }>("/api/v1/auth/me");
      this.user.set(user);
      await this.refreshWorkspaces();
    } catch {
      this.user.set(null);
    } finally {
      this.loaded.set(true);
    }
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
    const res = await this.api.post<LoginOutcome>("/api/v1/auth/login", { email, password });
    if (res.mfaRequired) return res;
    this.user.set(res.user);
    await this.refreshWorkspaces();
    return res;
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

  async register(name: string, email: string, password: string): Promise<AuthUser> {
    const res = await this.api.post<LoginResponse>("/api/v1/auth/register", { name, email, password });
    return res.user;
  }

  async logout(): Promise<void> {
    try {
      await this.api.post("/api/v1/auth/logout");
    } finally {
      this.user.set(null);
      this.workspaces.setList([]);
      this.workspaces.select(null);
    }
  }

  async me(): Promise<AuthUser> {
    const { user } = await this.api.get<{ user: AuthUser }>("/api/v1/auth/me");
    this.user.set(user);
    return user;
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

  async revokeSession(id: string): Promise<void> {
    await this.api.post(`/api/v1/auth/sessions/${encodeURIComponent(id)}/revoke`);
  }

  async mfaSetup(password: string): Promise<{ secret: string; uri: string }> {
    return this.api.post<{ secret: string; uri: string }>("/api/v1/auth/mfa/setup", { password });
  }

  async mfaEnable(code: string): Promise<{ recoveryCodes: string[] }> {
    return this.api.post<{ recoveryCodes: string[] }>("/api/v1/auth/mfa/enable", { code });
  }

  async mfaDisable(password: string): Promise<void> {
    await this.api.post("/api/v1/auth/mfa/disable", { password });
  }
}
