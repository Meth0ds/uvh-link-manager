import { DestroyRef, Injectable, computed, inject, signal } from "@angular/core";
import { ApiRequestError, ApiService, type ApiReadOptions } from "./api.service";
import { AuthEntryService } from "./auth-entry.service";
import { RegistrationService } from "./registration.service";
import type { LoginOutcome, MfaSessionStatus } from "./auth-session-contracts";
import { WorkspaceService } from "./workspace.service";
import { SessionContextService } from "./session-context.service";
import { LatestRequest, type ViewRequest } from "./latest-request";
import { AccountProfileService } from "./account-profile.service";
import { AccountMfaService } from "./account-mfa.service";
import { AccountSessionsService } from "./account-sessions.service";
import { AccountDataExportService } from "./account-data-export.service";
import { AccountDeletionService } from "./account-deletion.service";
import { AuthUserMutations } from "./auth-user-mutations";
import {
  decodeAuthUserResponse,
  decodeWorkspacesResponse,
} from "./auth-response-decoders";
import type { AccountDeletionImpact, AuthUser, DataExportStatus, SessionList, Workspace } from "../models";

import { decodePublicActionAcknowledgement } from "./public-action-response-decoders";

const AUTH_INVALIDATION_KEY = "uvh.auth.invalidated";

export type { LoginResponse, MfaRequiredResponse, LoginOutcome, MfaSessionStatus } from "./auth-session-contracts";
type MfaConfigurationOperation = "setup" | "replace-setup" | "enable" | "cancel" | "regenerate" | "disable";

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
  private readonly entry = inject(AuthEntryService);
  private readonly registration = inject(RegistrationService);
  private readonly accountProfile = inject(AccountProfileService);
  private readonly accountMfa = inject(AccountMfaService);
  private readonly accountSessions = inject(AccountSessionsService);
  private readonly accountDataExport = inject(AccountDataExportService);
  private readonly accountDeletion = inject(AccountDeletionService);
  private workspaces = inject(WorkspaceService);

  private readonly sessionContext = inject(SessionContextService);
  readonly user = this.sessionContext.user;
  readonly loaded = signal(false);
  /**
   * True once the startup probe has answered, whether it confirmed a session,
   * rejected it, or failed transiently. Entry views wait for this instead of
   * painting a login form at a visitor whose session state is still unknown.
   */
  readonly probeSettled = signal(false);
  readonly authenticated = computed(() => this.user() !== null);
  /** True when the server rejected the session and the panel must close. */
  readonly sessionInvalidated = signal(false);
  readonly adminMfaReauthenticationRequired = signal(false);
  /** A command was confirmed, but its authoritative projection still needs a read. */
  readonly userRefreshRequired = signal(false);
  /** An ambiguous security response requires inspection, without claiming a commit. */
  readonly userMutationUnconfirmed = signal(false);
  /** Delivery of write-only recovery credentials cannot be resolved by /me. */
  readonly mfaRecoveryIssueUnconfirmed = signal(false);
  private initPromise?: Promise<void>;
  private get generation(): number {
    return this.sessionContext.generation();
  }
  private workspaceRequest = 0;
  private readonly destroyRef = inject(DestroyRef);
  private readonly identityRequests = new LatestRequest(this.destroyRef);
  private readonly userMutations = new AuthUserMutations(
    (generation, account) => this.assertUserContext(generation, account),
    (user) => this.publishUser(user),
    (generation, account) => this.reconcileUserMutations(generation, account),
  );

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
      this.destroyRef.onDestroy(() => window.removeEventListener("storage", this.onStorage));
    }
  }

  /** Clear the local identity before waiting on the network. */
  private clearLocalAuth(): void {
    this.user.set(null);
    this.userRefreshRequired.set(false);
    this.userMutationUnconfirmed.set(false);
    this.mfaRecoveryIssueUnconfirmed.set(false);
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
    this.identityRequests.invalidate();
    return this.sessionContext.advance();
  }

  private isCurrent(generation: number): boolean {
    return generation === this.generation;
  }

  private assertCurrent(generation: number): void {
    if (!this.isCurrent(generation)) throw new AuthOperationSupersededError();
  }

  /** Confirmed DTO writes take precedence over identity reads begun earlier. */
  private publishUser(user: AuthUser): void {
    this.identityRequests.invalidate();
    this.user.set(user);
    this.userRefreshRequired.set(false);
    this.userMutationUnconfirmed.set(false);
    if (!user.mfaEnabled) this.mfaRecoveryIssueUnconfirmed.set(false);
  }

  private assertUserContext(generation: number, account: number | null): void {
    this.assertCurrent(generation);
    if (this.destroyRef.destroyed || (this.user()?.id ?? null) !== account) throw new AuthOperationSupersededError();
  }

  private async reconcileUserMutations(generation: number, account: number | null): Promise<void> {
    this.assertUserContext(generation, account);
    this.userRefreshRequired.set(true);
    try {
      await this.me();
    } catch {
      // The command remains confirmed. Preserve the last known projection and
      // the explicit refresh notice; a later owned identity read can clear it.
    }
  }

  private applyUserMutation(command: () => Promise<AuthUser>): Promise<AuthUser> {
    // Capture intent before the transport/CSRF boundary can yield.
    return this.userMutations.run(this.generation, this.user()?.id ?? null, command, this.userRefreshRequired());
  }

  private markUserProjectionStale(unconfirmed = false): void {
    // A confirmed security ACK can change fields even without a User DTO.
    // It supersedes earlier probes and any overlapping profile/email snapshot.
    this.identityRequests.invalidate();
    this.userMutations.identityRead();
    this.userRefreshRequired.set(true);
    this.userMutationUnconfirmed.set(unconfirmed);
  }

  private async confirmedMfaMutation<T>(operation: MfaConfigurationOperation, command: () => Promise<T>): Promise<T> {
    const generation = this.generation;
    const account = this.user()?.id ?? null;
    const affectsUser = operation !== "setup" && operation !== "cancel";
    const issuesCodes = operation === "enable" || operation === "regenerate";
    let result: T;
    try {
      result = await command();
    } catch (error) {
      if (affectsUser && account !== null && error instanceof ApiRequestError && (error.status === 502 || error.status === 0)) {
        this.assertUserContext(generation, account);
        // The response cannot prove whether a write committed. Freeze the
        // projection for an explicit read instead of replaying the command.
        this.markUserProjectionStale(true);
        if (issuesCodes) this.mfaRecoveryIssueUnconfirmed.set(true);
      }
      throw error;
    }
    this.assertUserContext(generation, account);
    if (affectsUser && account !== null) this.markUserProjectionStale();
    if (issuesCodes || operation === "disable") this.mfaRecoveryIssueUnconfirmed.set(false);
    return result;
  }

  /** A new observed account invalidates all guards captured for the old one. */
  private adoptObservedUser(user: AuthUser): { generation: number; changed: boolean } {
    const previous = this.user();
    const changed = previous?.id !== user.id;
    if (changed) {
      this.nextGeneration();
      // Preserve the stored workspace preference during the initial probe.
      // An actual account replacement must discard the previous owner's list.
      if (previous !== null) this.clearLocalAuth();
    }
    this.userMutations.identityRead();
    this.publishUser(user);
    this.sessionInvalidated.set(false);
    this.loaded.set(true);
    this.probeSettled.set(true);
    return { generation: this.generation, changed };
  }

  private assertIdentityCurrent(request: ViewRequest): void {
    if (!this.identityRequests.isCurrent(request, this.generation)) throw new AuthOperationSupersededError();
  }

  private async readIdentity(request: ViewRequest): Promise<AuthUser> {
    try {
      const { user } = await this.api.get<{ user: AuthUser }>(
        "/api/v1/auth/me", undefined, decodeAuthUserResponse, { signal: request.signal },
      );
      this.assertIdentityCurrent(request);
      return user;
    } catch (error) {
      // Cancellation alone is insufficient when a response is already queued.
      if (!this.identityRequests.isCurrent(request, this.generation)) throw new AuthOperationSupersededError();
      // A replacement /me also owns startup settlement if it cancelled init.
      // A definitive anonymous answer is loaded; transient failures can retry.
      this.probeSettled.set(true);
      if (!this.loaded() && error instanceof ApiRequestError && error.status === 401) {
        this.clearLocalAuth();
        this.loaded.set(true);
      }
      throw error;
    }
  }

  /** Load /auth/me + workspaces once at startup, coalescing concurrent guards. */
  init(): Promise<void> {
    if (this.loaded()) return Promise.resolve();
    if (this.initPromise) return this.initPromise;

    let generation = this.generation;
    this.userMutations.identityRead();
    const request = this.identityRequests.begin(generation);
    const operation = (async () => {
      try {
        const user = await this.readIdentity(request);
        this.assertIdentityCurrent(request);
        generation = this.adoptObservedUser(user).generation;
        // The identity is resolved here. Guards and the /auth redirect must not
        // wait for the workspace list: the panel refreshes it on its own, and
        // keeping it inside the "loaded" gate added a whole extra round-trip to
        // every redirect for a visitor who was already signed in.
        this.loaded.set(true);
        this.probeSettled.set(true);
        await this.refreshWorkspaces(generation);
        this.assertCurrent(generation);
      } catch (error) {
        if (!this.isCurrent(generation) || error instanceof AuthOperationSupersededError) return;
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
        // Either way the probe answered. Entry views can stop waiting and show
        // the form rather than hang on a session that may never be confirmed.
        this.probeSettled.set(true);
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
      const res = await this.entry.login(email, password, captchaToken);
      this.assertCurrent(generation);
      this.loaded.set(true);
      if (res.mfaRequired) return res;
      this.publishUser(res.user);
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
    const res = await this.entry.verifyMfa(challenge, code);
    this.assertCurrent(generation);
    this.publishUser(res.user);
    this.loaded.set(true);
    this.adminMfaReauthenticationRequired.set(false);
    await this.refreshWorkspaces(generation);
    this.assertCurrent(generation);
  }

  async recoverMfa(challenge: string, code: string): Promise<void> {
    const generation = this.nextGeneration();
    const res = await this.entry.recoverMfa(challenge, code);
    this.assertCurrent(generation);
    this.publishUser(res.user);
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
    await this.registration.register(name, email, password, antiBot);
  }

  async resendVerification(email: string | undefined, captchaToken: string): Promise<void> {
    await this.registration.resendVerification(email, captchaToken);
  }

  /**
   * Corrige la dirección de un registro sin verificar.
   *
   * No manda contraseña: la autoridad es la cookie `REGISTRATION_EDIT_COOKIE`
   * que el servidor emitió al navegador que creó el registro, y que el cliente
   * HTTP adjunta sola (HttpOnly, `withCredentials`). La contraseña propuesta ya
   * no autoriza nada en el servidor, así que pedirla aquí sería pedir un dato
   * que nadie va a leer.
   */
  async changeRegistrationEmail(
    currentEmail: string,
    newEmail: string,
    antiBot: { captchaToken: string; website?: string },
  ): Promise<void> {
    await this.registration.changeRegistrationEmail(currentEmail, newEmail, antiBot);
  }

  /** Confirm server-side revocation before representing the session as closed. */
  async logout(): Promise<void> {
    const generation = this.nextGeneration();
    this.sessionInvalidated.set(false);
    await this.entry.logout();
    this.assertCurrent(generation);
    this.clearLocalAuth();
    this.loaded.set(true);
    this.probeSettled.set(true);
    this.announceInvalidation();
  }

  /** Called by the HTTP interceptor when a previously live session is revoked. */
  sessionExpired(expectedGeneration = this.generation): void {
    if (!this.isCurrent(expectedGeneration)) return;
    this.invalidateLocalSession(true);
  }

  /** The cookie belongs to another account; close only this tab's projection. */
  sessionContextChanged(expectedGeneration: number): void {
    if (!this.isCurrent(expectedGeneration)) return;
    this.invalidateLocalSession(false);
  }

  /** Reconcile a confirmed cookie/session revocation without erasing a newer login. */
  accountSignedOut(expectedGeneration = this.generation): boolean {
    if (!this.isCurrent(expectedGeneration)) return false;
    this.nextGeneration();
    this.sessionInvalidated.set(false);
    this.clearLocalAuth();
    this.loaded.set(true);
    this.probeSettled.set(true);
    this.announceInvalidation();
    return true;
  }

  private invalidateLocalSession(announce: boolean): void {
    this.nextGeneration();
    this.sessionInvalidated.set(true);
    this.clearLocalAuth();
    this.loaded.set(true);
    this.probeSettled.set(true);
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
    this.userMutations.identityRead();
    const request = this.identityRequests.begin(this.generation);
    const user = await this.readIdentity(request);
    this.assertIdentityCurrent(request);
    const { generation, changed } = this.adoptObservedUser(user);
    if (changed) void this.refreshWorkspaces(generation);
    return user;
  }

  /** Refresh the local identity after security-sensitive account changes. */
  async refreshUser(): Promise<void> {
    if (this.user()) this.userRefreshRequired.set(true);
    await this.me();
  }

  async mfaSessionStatus(): Promise<MfaSessionStatus> {
    const generation = this.generation;
    const status = await this.entry.mfaSessionStatus();
    this.assertCurrent(generation);
    if (status.fresh) this.adminMfaReauthenticationRequired.set(false);
    return status;
  }

  async reauthenticateMfa(password: string, factorCode: string): Promise<{ verifiedAt: string; expiresAt: string }> {
    const generation = this.generation;
    const result = await this.entry.reauthenticateMfa(password, factorCode);
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
    return this.applyUserMutation(() => this.accountProfile.updateName(name));
  }

  async changePassword(current: string, newPassword: string, factorCode?: string): Promise<void> {
    const generation = this.generation;
    await this.api.post("/api/v1/auth/change-password", {
      current,
      newPassword,
      ...(factorCode ? { factorCode } : {}),
    }, decodePublicActionAcknowledgement);
    this.assertCurrent(generation);
  }

  async requestEmailChange(newEmail: string, password: string, factorCode?: string): Promise<AuthUser> {
    return this.applyUserMutation(() => this.accountProfile.requestEmail(newEmail, password, factorCode));
  }

  async cancelEmailChange(password: string, factorCode?: string): Promise<AuthUser> {
    return this.applyUserMutation(() => this.accountProfile.cancelEmail(password, factorCode));
  }

  async dataExportStatus(options?: ApiReadOptions): Promise<DataExportStatus | null> {
    const generation = this.generation;
    const { export: status } = await this.accountDataExport.status(options);
    this.assertCurrent(generation);
    return status;
  }

  /** Historial acotado: las últimas diez exportaciones, sin rutas de artefacto. */
  async dataExportHistory(options?: ApiReadOptions): Promise<DataExportStatus[]> {
    const generation = this.generation;
    const { exports } = await this.accountDataExport.history(options);
    this.assertCurrent(generation);
    return exports;
  }

  async requestDataExport(password: string, factorCode?: string): Promise<DataExportStatus> {
    const generation = this.generation;
    const { export: status } = await this.accountDataExport.request(password, factorCode);
    this.assertCurrent(generation);
    return status;
  }

  /**
   * Descarga con step-up: el artefacto se entrega a la sesión que acaba de
   * demostrar contraseña y segundo factor. Repetir la llamada es seguro hasta
   * que el navegador acusa la recepción completa.
   */
  async downloadDataExport(password: string, factorCode?: string): Promise<Blob> {
    const generation = this.generation;
    const blob = await this.accountDataExport.download(password, factorCode);
    this.assertCurrent(generation);
    return blob;
  }

  /** Consume la exportación: marca `downloaded` y purga el artefacto. */
  async acknowledgeDataExportDownload(): Promise<void> {
    const generation = this.generation;
    await this.accountDataExport.acknowledge();
    this.assertCurrent(generation);
  }

  async cancelDataExport(): Promise<void> {
    const generation = this.generation;
    await this.accountDataExport.cancel();
    this.assertCurrent(generation);
  }

  async accountDeletionImpact(options?: ApiReadOptions): Promise<AccountDeletionImpact> {
    const generation = this.generation;
    const impact = await this.accountDeletion.impact(options);
    this.assertCurrent(generation);
    return impact;
  }

  async requestAccountDeletion(password: string, confirmation: string, factorCode?: string): Promise<{ status: "requested"; confirmationExpiresAt: string }> {
    const generation = this.generation;
    const result = await this.accountDeletion.request(password, confirmation, factorCode);
    this.assertCurrent(generation);
    return result;
  }

  /**
   * The session registry is bounded server-side. `truncated` travels with the
   * rows so a caller can tell a complete registry from a window onto it, which
   * matters here: an omitted active session cannot be revoked from the panel.
   */
  async listSessions(options?: ApiReadOptions): Promise<SessionList> {
    const generation = this.generation;
    const decoded = await this.accountSessions.list(options);
    this.assertCurrent(generation);
    return decoded;
  }

  async revokeSession(id: string, current = false): Promise<boolean> {
    const generation = this.generation;
    const result = await this.accountSessions.revoke(id);
    this.assertCurrent(generation);
    if (current || result.current) this.sessionExpired();
    return result.current === true || current;
  }

  /**
   * Cierre masivo conservando esta sesión: devuelve cuántas sesiones más se
   * cerraron (cero si no había ninguna). Idempotente y sin tocar credenciales.
   */
  async revokeOtherSessions(): Promise<number> {
    const generation = this.generation;
    const result = await this.accountSessions.revokeOthers();
    this.assertCurrent(generation);
    return result.revoked;
  }

  /** Cierre total, incluida la actual: la cuenta queda fuera y esta sesión local expira. */
  async revokeAllSessions(): Promise<number> {
    const generation = this.generation;
    const result = await this.accountSessions.revokeAll();
    this.assertCurrent(generation);
    this.sessionExpired();
    return result.revoked;
  }

  async mfaSetup(password: string, code?: string): Promise<{ secret: string; uri: string }> {
    return this.confirmedMfaMutation(code ? "replace-setup" : "setup", () => this.accountMfa.setup(password, code));
  }

  async mfaEnable(code: string): Promise<{ recoveryCodes: string[] }> {
    return this.confirmedMfaMutation("enable", () => this.accountMfa.enable(code));
  }

  async mfaCancelSetup(): Promise<void> {
    await this.confirmedMfaMutation("cancel", () => this.accountMfa.cancelSetup());
  }

  async mfaRegenerateRecoveryCodes(password: string, factorCode: string): Promise<{ recoveryCodes: string[] }> {
    return this.confirmedMfaMutation("regenerate", () => this.accountMfa.regenerate(password, factorCode));
  }

  async mfaDisable(password: string, code: string): Promise<void> {
    await this.confirmedMfaMutation("disable", () => this.accountMfa.disable(password, code));
  }
}
