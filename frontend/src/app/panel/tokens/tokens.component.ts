import { Component, computed, DestroyRef, effect, inject, signal, ChangeDetectionStrategy, HostListener, ElementRef, viewChild, afterNextRender, Injector, untracked, NgZone } from "@angular/core";

import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import type { ApiTokenDto } from "../../core/models";
import { WorkspaceService } from "../../core/services/workspace.service";
import { AuthService } from "../../core/services/auth.service";
import { ActionDialogService } from "../action-dialog.service";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";
import { LatestRequest } from "../../core/services/latest-request";
import { SessionContextService } from "../../core/services/session-context.service";
import { decodeApiTokensResponse, decodeCreatedApiTokenResponse } from "../../core/services/credential-response-decoders";
import { localDateTimeIso } from "../../core/strict-wire";
import {
  apiTokenState,
  tokenExpiryTick,
  tokenActionAriaLabel,
  tokenActionLabel,
  tokenStateIcon,
  tokenStateLabel,
} from "../../core/api-token-label";

import { ReadDeadline } from "../../core/read-deadline";
import { dateTimeLabel } from "../../core/date-time-label";
import { decodePublicActionAcknowledgement } from "../../core/services/public-action-response-decoders";

const SCOPES = [
  { value: "links:read", label: "Consultar enlaces", description: "Ver los enlaces y sus destinos." },
  { value: "links:write", label: "Gestionar enlaces", description: "Crear, editar, cambiar estado, eliminar y restaurar enlaces." },
  { value: "analytics:read", label: "Consultar analítica", description: "Ver las estadísticas de uso de los enlaces." },
  { value: "domains:read", label: "Consultar dominios", description: "Ver la configuración y el estado de los dominios." },
  { value: "domains:write", label: "Gestionar dominios", description: "Crear, configurar, verificar, activar, desactivar y eliminar dominios." },
] as const;

@Component({
  selector: "app-tokens",
  standalone: true,
  imports: [
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatCheckboxModule,
    MatProgressBarModule,
    MatSnackBarModule,
    PageHeaderComponent,
    PanelSkeletonComponent,
  ],
  templateUrl: "./tokens.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./tokens.component.scss",
})
export class TokensComponent {
  private api = inject(ApiService);
  private workspaces = inject(WorkspaceService);
  private snackbar = inject(MatSnackBar);
  private actions = inject(ActionDialogService);
  private auth = inject(AuthService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly sessionContext = inject(SessionContextService);
  private readonly injector = inject(Injector);
  private readonly requests = new LatestRequest(this.destroyRef);
  private readonly mutations = new LatestRequest(this.destroyRef);
  private readonly clipboardRequests = new LatestRequest(this.destroyRef);
  private readonly nameInput = viewChild<unknown, ElementRef<HTMLInputElement>>("nameInput", { read: ElementRef });
  private readonly createButton = viewChild<unknown, ElementRef<HTMLButtonElement>>("createButton", { read: ElementRef });
  private readonly issuedSection = viewChild<unknown, ElementRef<HTMLElement>>("issuedSection", { read: ElementRef });

  private readonly clockRevision = signal(0);
  private readonly expiryDeadline = new ReadDeadline(this.destroyRef, inject(NgZone), () => this.refreshClock());
  readonly formatDate = dateTimeLabel;
  readonly timeZone = Intl.DateTimeFormat().resolvedOptions().timeZone;
  readonly tokens = signal<ApiTokenDto[]>([]);
  /** The server held token rows back, so this list is not the whole registry. */
  readonly truncated = signal(false);
  readonly loading = signal(true);
  readonly creating = signal(false);
  readonly revokingId = signal<number | null>(null);
  readonly plainToken = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly registryNeedsRefresh = signal(false);
  readonly formOpen = signal(false);
  readonly issuedName = signal("");
  readonly issueError = signal<string | null>(null);
  readonly creationUnconfirmed = signal(false);
  readonly creationReviewed = signal(false);
  private issuedTokenId: number | null = null;
  readonly copyBusy = signal(false);
  readonly copyFeedback = signal<string | null>(null);
  private readonly confirmedRevocations = signal<number[]>([]);
  readonly canManage = computed(() => this.workspaces.currentId() !== null && this.user()?.emailVerified === true
    && ["owner", "admin", "editor"].includes(this.workspaces.currentRole() ?? ""));
  readonly mutationBusy = computed(() => this.creating() || this.revokingId() !== null);
  readonly nameInvalid = computed(() => {
    const name = this.name().trim();
    const length = Array.from(name).length;
    return name !== "" && (length < 2 || length > 80 || /[\u0000-\u001f\u007f]/.test(name));
  });

  readonly name = signal("");
  readonly expiresAt = signal("");
  readonly selectedScopes = signal<string[]>([]);
  readonly password = signal("");
  readonly factorCode = signal("");
  readonly user = this.auth.user;
  readonly scopeOptions = SCOPES;

  private renderedContext: string | null = null;

  /** Read live: selection generations and DestroyRef are not signals. */
  private contextKey(): string {
    const user = this.user();
    return JSON.stringify([this.workspaces.currentId(), this.workspaces.selectionGeneration(),
      this.workspaces.currentRole(), this.sessionContext.generation(), user?.id, user?.emailVerified, user?.mfaEnabled]);
  }

  private currentView(): boolean {
    return !this.destroyRef.destroyed && this.canManage() && this.renderedContext === this.contextKey();
  }

  constructor() {
    // Share deadline scheduling with mounted session readers; distant dates
    // do not keep Angular unstable and hidden tabs do not poll.
    effect(() => {
      this.clockRevision();
      const now = Date.now();
      const future = this.tokens().filter((token) => token.revokedAt === null)
        .map((token) => tokenExpiryTick(token.expiresAt)).filter((value): value is number => value !== null && value > now);
      this.expiryDeadline.schedule(future.length ? Math.min(...future) : null);
    });
    effect(() => {
      const context = this.contextKey();
      if (context === this.renderedContext) return;
      untracked(() => {
        this.renderedContext = context;
        this.requests.invalidate();
        this.mutations.invalidate();
        this.tokens.set([]);
        this.truncated.set(false);
        this.confirmedRevocations.set([]);
        this.error.set(null);
        this.registryNeedsRefresh.set(false);
        this.clearIssued();
        this.clearDraft();
        this.formOpen.set(false);
        this.creating.set(false);
        this.revokingId.set(null);
        this.issueError.set(null);
        this.creationUnconfirmed.set(false);
        this.creationReviewed.set(false);
        this.loading.set(false);
        if (this.canManage()) void this.load();
      });
    });
    this.destroyRef.onDestroy(() => {
      this.clearIssued();
      this.password.set("");
      this.factorCode.set("");
    });
  }

  async load(): Promise<void> {
    if (!this.currentView()) return;
    const request = this.requests.begin(this.contextKey());
    this.loading.set(true);
    this.error.set(null);
    try {
      const { tokens, truncated } = await this.api.get<{ tokens: ApiTokenDto[]; truncated: boolean }>(
        "/api/v1/tokens", undefined, decodeApiTokensResponse, { signal: request.signal });
      if (!this.requests.isCurrent(request, this.contextKey())) return;
      this.tokens.set(tokens);
      if (this.issuedTokenId !== null && tokens.some(token => token.id === this.issuedTokenId && this.isRevoked(token))) {
        const origin = document.activeElement;
        const focusedIssuedSection = origin !== null && this.issuedSection()?.nativeElement.contains(origin);
        this.clearIssued();
        if (focusedIssuedSection) this.focusAfterRender(() => this.createButton()?.nativeElement, origin);
      }
      this.registryNeedsRefresh.set(false);
      this.truncated.set(truncated);
      if (this.creationUnconfirmed()) this.creationReviewed.set(true);
      // A confirmed ACK stays authoritative if a replica/read still lags it.
      this.confirmedRevocations.update(ids => ids.filter(id => tokens.some(t => t.id === id && !t.revokedAt)));
    } catch (err) {
      if (!this.requests.isCurrent(request, this.contextKey())) return;
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar los tokens");
    } finally {
      if (this.requests.isCurrent(request, this.contextKey())) this.loading.set(false);
    }
  }

  openCreate(event?: Event): void {
    if (!this.currentView() || this.mutationBusy() || this.plainToken() || this.creationUnconfirmed()) return;
    this.formOpen.set(true);
    this.issueError.set(null);
    this.focusAfterRender(() => this.nameInput()?.nativeElement, this.focusOrigin(event));
  }

  cancelCreate(event?: Event): void {
    if (this.mutationBusy()) return;
    const origin = this.focusOrigin(event);
    this.clearDraft();
    if (!this.creationUnconfirmed()) this.issueError.set(null);
    this.formOpen.set(false);
    this.focusAfterRender(() => this.createButton()?.nativeElement, origin);
  }

  private clearDraft(): void {
    this.name.set(""); this.expiresAt.set(""); this.selectedScopes.set([]);
    this.password.set(""); this.factorCode.set("");
  }

  finishIssued(event?: Event): void {
    if (!this.currentView() || !this.plainToken()) return;
    const origin = this.focusOrigin(event);
    this.clearIssued();
    this.focusAfterRender(() => this.createButton()?.nativeElement, origin);
  }

  private clearIssued(): void {
    this.clipboardRequests.invalidate();
    this.plainToken.set(null); this.issuedName.set(""); this.copyFeedback.set(null); this.copyBusy.set(false);
    this.issuedTokenId = null;
  }

  acknowledgeUnconfirmed(): void {
    if (!this.currentView() || this.loading() || this.error() || !this.creationReviewed()) return;
    this.creationUnconfirmed.set(false);
    this.creationReviewed.set(false);
    this.issueError.set(null);
  }

  private focusOrigin(event?: Event): Element | null {
    return event?.currentTarget instanceof HTMLElement ? event.currentTarget : document.activeElement;
  }

  private focusAfterRender(target: () => HTMLElement | undefined, origin: Element | null): void {
    const context = this.contextKey();
    afterNextRender(() => {
      if (!this.currentView() || context !== this.contextKey()) return;
      const relinquished = document.activeElement === document.body
        && (!origin?.isConnected || (origin instanceof HTMLButtonElement && origin.disabled));
      if (document.activeElement === origin || relinquished) target()?.focus();
    }, { injector: this.injector });
  }

  expiryError(): string | null {
    const raw = this.expiresAt().trim();
    if (!raw) return null;
    const iso = localDateTimeIso(raw);
    if (iso === null) return "Introduce una fecha y hora válidas.";
    const now = Date.now();
    const latest = new Date(now); latest.setFullYear(latest.getFullYear() + 1);
    const instant = Date.parse(iso);
    return instant <= now || instant > latest.getTime() ? "Elige una caducidad futura, dentro de un año." : null;
  }

  canCreate(): boolean {
    return this.currentView() && !this.mutationBusy() && !this.plainToken() && !this.creationUnconfirmed()
      && !!this.name().trim() && !this.nameInvalid() && this.selectedScopes().length > 0
      && this.selectedScopes().every(scope => SCOPES.some(option => option.value === scope))
      && new Set(this.selectedScopes()).size === this.selectedScopes().length
      && !!this.password() && new TextEncoder().encode(this.password()).length <= 72
      && (!this.user()?.mfaEnabled || !!this.factorCode().trim())
      && new TextEncoder().encode(this.factorCode().trim()).length <= 24 && !this.expiryError();
  }

  toggleScope(scope: string): void {
    this.selectedScopes.update((s) => (s.includes(scope) ? s.filter((x) => x !== scope) : [...s, scope]));
  }

  async create(event?: Event): Promise<void> {
    if (!this.canCreate()) return;
    const request = this.mutations.begin(this.contextKey());
    const current = () => this.mutations.isCurrent(request, this.contextKey());
    const origin = this.focusOrigin(event);
    const draft = { name: this.name(), scopes: [...this.selectedScopes()], expiresAt: this.expiresAt(),
      password: this.password(), factorCode: this.factorCode() };
    this.creating.set(true);
    this.issueError.set(null);
    try {
      const { token, plainToken } = await this.auth.accountStepUp(() => this.api.post<{ token: ApiTokenDto; plainToken: string }>("/api/v1/tokens", {
        name: draft.name.trim(), scopes: draft.scopes, expiresAt: this.expiresAtIso(), password: draft.password,
        ...(draft.factorCode.trim() ? { factorCode: draft.factorCode.trim() } : {}),
      }, decodeCreatedApiTokenResponse));
      if (!current()) return;
      // A registry read admitted before this ACK cannot erase the new row.
      const registryWasUnsettled = this.loading() || !!this.error() || this.registryNeedsRefresh();
      this.requests.invalidate(); this.loading.set(false);
      this.registryNeedsRefresh.set(registryWasUnsettled);
      this.tokens.update(rows => {
        const next = [token, ...rows.filter(row => row.id !== token.id)];
        if (next.length > 100) this.truncated.set(true);
        return next.slice(0, 100);
      });
      this.plainToken.set(plainToken); this.issuedName.set(token.name); this.issuedTokenId = token.id;
      if (this.name() === draft.name) this.name.set("");
      if (this.expiresAt() === draft.expiresAt) this.expiresAt.set("");
      if (JSON.stringify(this.selectedScopes()) === JSON.stringify(draft.scopes)) this.selectedScopes.set([]);
      this.password.set(""); this.factorCode.set(""); this.formOpen.set(false);
      this.focusAfterRender(() => this.issuedSection()?.nativeElement, origin);
      try {
        await this.auth.refreshUser();
      } catch {
        if (current()) this.snackbar.open("Token creado. Actualiza Ajustes para revisar el estado de recuperación.", "Cerrar", { duration: 4000 });
      }
    } catch (err) {
      if (!current()) return;
      const uncertain = err instanceof ApiRequestError && (err.status === 0 || err.status === 502);
      this.creationUnconfirmed.set(uncertain);
      if (uncertain) { this.requireRegistryRefresh(); this.creationReviewed.set(false); }
      this.issueError.set(uncertain
        ? "No pudimos confirmar la creación. El token puede haberse creado sin que recibieras el secreto. Actualiza el registro y revoca cualquier credencial que no puedas utilizar antes de crear otra."
        : err instanceof ApiRequestError ? err.message : "No se pudo crear el token");
    } finally {
      if (current()) this.creating.set(false);
    }
  }

  /** The chosen expiry as an instant, or null when there is none to send. */
  private expiresAtIso(): string | null {
    const raw = this.expiresAt().trim();
    if (raw === "") return null;
    // canCreate revalidates the instant and range immediately before dispatch.
    return localDateTimeIso(raw);
  }

  /** An earlier GET cannot resolve a command whose outcome is unknown. */
  private requireRegistryRefresh(): void {
    this.requests.invalidate();
    this.loading.set(false);
    this.registryNeedsRefresh.set(true);
  }

  async revoke(t: ApiTokenDto): Promise<void> {
    const live = this.tokens().find(row => row.id === t.id);
    if (!this.currentView() || this.mutationBusy() || this.loading() || this.error() || this.registryNeedsRefresh() || !live || this.isRevoked(live)) return;
    const context = this.contextKey();
    const confirmed = await this.actions.confirm({
      title: "Revocar token",
      message: `¿Revocar el token “${live.name}”? Las integraciones que lo usen dejarán de autenticarse y esta acción no se puede deshacer.`,
      confirmLabel: "Revocar token", destructive: true,
    });
    const selected = this.tokens().find(row => row.id === live.id);
    if (!confirmed || !this.currentView() || context !== this.contextKey() || this.mutationBusy()
      || this.loading() || this.error() || this.registryNeedsRefresh() || !selected || this.isRevoked(selected)) return;
    const request = this.mutations.begin(context);
    const current = () => this.mutations.isCurrent(request, this.contextKey());
    this.revokingId.set(selected.id);
    try {
      await this.api.delete(`/api/v1/tokens/${selected.id}`, undefined, decodePublicActionAcknowledgement);
      if (!current()) return;
      this.requests.invalidate();
      this.confirmedRevocations.update(ids => [...ids, selected.id]);
      if (this.issuedTokenId === selected.id) {
        this.clearIssued();
      }
      this.snackbar.open("Token revocado", "Cerrar", { duration: 2500 });
      // The backend retains revoked rows as history. Do not invent a persisted
      // revocation timestamp or promise that revoking exposes older pages.
      void this.load();
    } catch (err) {
      if (!current()) return;
      const uncertain = err instanceof ApiRequestError && (err.status === 0 || err.status === 502);
      if (uncertain) this.requireRegistryRefresh();
      this.snackbar.open(uncertain
        ? "No pudimos confirmar la revocación. Actualiza el registro para comprobar si el token sigue activo antes de reintentarlo."
        : err instanceof ApiRequestError ? err.message : "No se pudo revocar el token", "Cerrar", { duration: 4000 });
    } finally {
      if (current()) this.revokingId.set(null);
    }
  }

  async copyPlain(): Promise<void> {
    const plain = this.plainToken();
    if (!plain || !this.currentView() || this.copyBusy()) return;
    const request = this.clipboardRequests.begin(this.contextKey());
    const current = () => this.clipboardRequests.isCurrent(request, this.contextKey()) && this.plainToken() === plain;
    this.copyBusy.set(true); this.copyFeedback.set(null);
    try {
      if (!navigator.clipboard) throw new Error("Clipboard unavailable");
      await navigator.clipboard.writeText(plain);
      if (current()) this.copyFeedback.set("Token copiado");
    } catch {
      if (current()) this.copyFeedback.set("No se pudo copiar. Selecciona el token y cópialo manualmente.");
    } finally {
      if (current()) this.copyBusy.set(false);
    }
  }

  isRevoked(token: ApiTokenDto): boolean {
    return !!token.revokedAt || this.confirmedRevocations().includes(token.id);
  }

  trackByToken(_i: number, t: ApiTokenDto): number {
    return t.id;
  }

  @HostListener("document:visibilitychange")
  refreshClock(): void {
    this.clockRevision.update((revision) => revision + 1);
  }

  state(token: ApiTokenDto) {
    this.clockRevision();
    return this.isRevoked(token) ? "revoked" : apiTokenState(token, Date.now());
  }

  readonly stateLabel = (t: ApiTokenDto) => tokenStateLabel(this.state(t));
  readonly stateIcon = (t: ApiTokenDto) => tokenStateIcon(this.state(t));
  readonly actionLabel = (t: ApiTokenDto) => tokenActionLabel(this.isRevoked(t));
  readonly actionAriaLabel = (t: ApiTokenDto) => tokenActionAriaLabel(this.isRevoked(t), t.name);
}
