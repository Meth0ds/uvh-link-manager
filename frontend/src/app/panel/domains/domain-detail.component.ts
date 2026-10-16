import { DomainAppProfileComponent } from "./domain-app-profile.component";
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from "@angular/core";
import { AsyncPoller } from "../../core/async-poller";
import { RetryCountdown, formatWaitLabel } from "../../core/retry-countdown";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { ActivatedRoute, Router, RouterLink } from "@angular/router";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSelectModule } from "@angular/material/select";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { dateTimeMediumLabel } from "../../core/date-time-label";
import type { DomainActivityEvent, DomainActivityResponse, DomainDetailResponse, DomainDto, DomainState, DomainTrafficStatus } from "../../core/models";
import { IdempotentIntent } from "../../core/idempotent-intent";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { decodeDomainActivityResponse, decodeDomainDetailResponse, decodeDomainStateResponse } from "../../core/services/domain-response-decoders";
import { LatestRequest } from "../../core/services/latest-request";
import { OwnedMutations } from "../../core/services/owned-mutations";
import { WorkspaceService } from "../../core/services/workspace.service";
import { parseRouteId } from "../../core/strict-wire";
import { targetWorkspace } from "../../core/services/workspace-target";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";
import { domainStateLabel } from "../../core/domain-state-label";
import { SessionContextService } from "../../core/services/session-context.service";
import { DomainRemovalDialogService } from "./domain-removal-dialog.service";
import { domainSetupAdvice, domainSetupSteps } from "./domain-setup";

const DNS_ERROR: Record<string, string> = {
  ownership_and_routing_missing: "No encontramos ni el TXT de propiedad ni el CNAME de tráfico.",
  ownership_missing: "No encontramos el TXT de propiedad.",
  routing_missing: "El CNAME todavía no apunta al destino esperado.",
  domain_claimed_elsewhere: "Otro workspace demostró la propiedad de este nombre. Tu solicitud no llegará a servirlo.",
  resolver_unavailable: "El resolvedor DNS no respondió. El sistema volverá a intentarlo.",
  queue_unavailable: "La comprobación no pudo entrar en cola. Puedes reintentarlo.",
  queue_timeout: "La comprobación superó el tiempo previsto. Puedes iniciarla de nuevo.",
  verification_cancelled: "La comprobación se canceló porque cambió la autorización.",
};

/** Qué hace el dominio con el tráfico ahora mismo; el usuario no necesita el modelo interno. */
const TRAFFIC_LABEL: Record<DomainTrafficStatus, string> = {
  online: "En línea",
  degraded: "En línea, requiere atención",
  provisioning: "Preparando HTTPS",
  offline: "Fuera de servicio",
};

const ACTIVITY_LABEL: Record<string, string> = {
  "domain.claimed": "Propiedad del dominio obtenida",
  "domain.claim_transferred": "Propiedad transferida a otro workspace",
  "domain.verified": "Dominio verificado",
  "domain.degraded": "Configuración DNS degradada",
  "domain.offline": "Dominio fuera de servicio",
  "domain.recovered": "Dominio recuperado",
  "domain.activated": "Dominio activado",
  "domain.disabled": "Dominio desactivado",
  "domain.tls_failed": "Certificado HTTPS retirado",
  "domain.tls_expiring": "Certificado por caducar",
  "domain.deleted": "Dominio eliminado",
};

const TLS_ERROR: Record<string, string> = {
  certificate_provisioning_failed: "No se pudo emitir o validar el certificado. Revisa DNS y los registros CAA.",
  certificate_expired: "El certificado caducó sin renovarse. El dominio está fuera de servicio hasta reemitirlo.",
  certificate_probe_failed: "Las comprobaciones del certificado siguen fallando y el dominio se retiró del servicio.",
  certificate_check_failed: "La última comprobación del certificado falló. El dominio sigue sirviendo mientras se reintenta.",
  queue_unavailable: "La emisión del certificado no pudo entrar en cola.",
  provisioning_cancelled: "La emisión del certificado se canceló.",
  provisioning_timeout: "La emisión superó el tiempo previsto. Revisa DNS antes de reintentar.",
};

@Component({
  selector: "app-domain-detail",
  standalone: true,
  imports: [DomainAppProfileComponent, RouterLink, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatSelectModule, MatSnackBarModule, PageHeaderComponent, PanelSkeletonComponent],
  templateUrl: "./domain-detail.component.html",
  styleUrl: "./domain-detail.component.scss",
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class DomainDetailComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly workspaces = inject(WorkspaceService);
  private readonly session = inject(SessionContextService);
  private readonly removal = inject(DomainRemovalDialogService);
  private readonly router = inject(Router);
  private removalAbort?: AbortController;
  private readonly snackbar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private readonly requests = new LatestRequest(inject(DestroyRef));
  private readonly retry = new RetryCountdown(this.destroyRef);
  readonly dnsWait = computed(() => this.retry.remaining(`${this.currentContext()}:dns`));
  readonly tlsWait = computed(() => this.retry.remaining(`${this.currentContext()}:tls`));
  readonly waitLabel = formatWaitLabel;

  /**
   * Live diagnostics: while a DNS check or a TLS issuance is in flight the
   * page follows it on a saturating ladder, resilient to transient read
   * failures. Silent refreshes only — the progress bar is for real loads.
   */
  private readonly poller = new AsyncPoller({
    destroyRef: this.destroyRef,
    delays: [2_000, 2_000, 4_000, 8_000],
    wantsMore: () => this.inTransition(),
    attempt: async () => {
      await this.load(true);
      if (this.inTransition()) this.poller.schedule();
    },
  });

  private inTransition(): boolean {
    const d = this.domain();
    return d !== null && (d.dnsCheckInProgress || d.tlsStatus === "provisioning");
  }

  readonly domain = signal<DomainDto | null>(null);
  readonly provider = signal<"generic" | "cloudflare">("generic");
  readonly copyStatus = signal("");
  readonly setupSteps = computed(() => this.domain() ? domainSetupSteps(this.domain()!) : []);
  readonly setupAdvice = computed(() => this.domain() ? domainSetupAdvice(this.domain()!) : "");
  readonly canAdmin = computed(() => ["owner", "admin"].includes(this.workspaces.currentRole() ?? ""));
  readonly loading = signal(true);
  /** Historial del dominio: los mismos eventos que las integraciones reciben, proyectados. */
  readonly activity = signal<DomainActivityEvent[]>([]);
  readonly activityLoading = signal(false);
  readonly activityError = signal<string | null>(null);
  private readonly activityRequests = new LatestRequest(inject(DestroyRef));
  /** La única mutación en vuelo y su dueño; ver `OwnedMutations`. */
  private readonly mutations = new OwnedMutations();
  /** Clave de idempotencia por intención para la activación. */
  private readonly intent = new IdempotentIntent();
  readonly actionBusy = this.mutations.busy;
  readonly error = signal<string | null>(null);
  readonly canEdit = computed(() => {
    const role = this.workspaces.currentRole();
    return role === "owner" || role === "admin" || role === "editor";
  });

  // Superficie de visitante: edición local mientras el usuario teclea. Las
  // recargas silenciosas del diagnóstico no deben pisar lo que está escribiendo.
  readonly rootDestinationInput = signal("");
  readonly notFoundModeInput = signal<"platform" | "redirect" | "branded">("platform");
  readonly surfaceDirty = signal(false);

  /**
   * The route's `:id`, kept reactive.
   *
   * Angular reuses this component when only the parameter changes, so an id
   * captured once from the snapshot would keep showing — and acting on — the
   * domain the view was first opened with while the URL names another one.
   */
  private readonly domainId = signal(this.paramId());
  private loadedContext: string | null = null;

  constructor() {
    this.destroyRef.onDestroy(() => this.removalAbort?.abort());
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(() => this.domainId.set(this.paramId()));

    effect(() => {
      const workspaceId = this.workspaces.currentId();
      const role = this.workspaces.currentRole();
      const domainId = this.domainId();
      const context = workspaceId === null || role === null ? null : this.currentContext();
      if (context === this.loadedContext) return;
      this.loadedContext = context;
      this.removalAbort?.abort();
      this.requests.invalidate();
      this.activityRequests.invalidate();
      this.domain.set(null);
      this.error.set(null);
      this.activity.set([]);
      this.activityError.set(null);
      this.surfaceDirty.set(false);
      this.provider.set("generic");
      this.copyStatus.set("");
      // An action still in flight belongs to the context that left the screen;
      // its guarded `finally` will not clear the flag here, so the new context
      // starts unblocked instead of inheriting a stuck busy state.
      this.mutations.reset();
      if (domainId === null) {
        this.error.set("El identificador del dominio no es válido");
        this.loading.set(false);
        return;
      }
      if (context === null) {
        this.loading.set(false);
        return;
      }
      void this.load();
    });
  }

  private paramId(): number | null {
    return parseRouteId(this.route.snapshot.paramMap.get("id"));
  }

  /** The identity a request must still match to be applied to this view. */
  private currentContext(): string | null {
    const workspaceId = this.workspaces.currentId();
    const role = this.workspaces.currentRole();
    return workspaceId === null || role === null ? null : `${workspaceId}:${role}:${this.domainId()}:${this.session.user()?.id ?? ""}:${this.session.generation()}`;
  }

  async load(silent = false): Promise<void> {
    const workspaceId = this.workspaces.currentId();
    const role = this.workspaces.currentRole();
    const domainId = this.domainId();
    if (workspaceId === null || role === null || domainId === null) {
      this.requests.invalidate();
      this.domain.set(null);
      this.loading.set(false);
      return;
    }

    const request = this.requests.begin(this.currentContext());
    if (!silent) {
      this.loading.set(true);
      this.error.set(null);
    }
    try {
      const response = await this.api.get<DomainDetailResponse>(
        `/api/v1/domains/${domainId}`,
        undefined,
        (value) => decodeDomainDetailResponse(value, domainId, this.canEdit()),
        { signal: request.signal },
      );
      if (!this.requests.isCurrent(request, this.currentContext())) return;
      this.domain.set(response.domain);
      if (response.domain.tlsNextRetryAt) {
        this.retry.defer(`${this.currentContext()}:tls`, Math.ceil((Date.parse(response.domain.tlsNextRetryAt) - Date.now()) / 1000));
      }
      this.syncSurface(response.domain);
      this.error.set(null);
      if (!silent) void this.loadActivity();
    } catch (err) {
      if (!this.requests.isCurrent(request, this.currentContext())) return;
      if (silent && this.domain() !== null) {
        // A transient read failure must not blank diagnostics that are on
        // screen, nor kill the follow-up: the poller retries on its ladder.
        return;
      }
      this.domain.set(null);
      this.error.set(err instanceof ApiRequestError && (err.status === 401 || err.status === 403)
        ? "Ya no tienes acceso a este diagnóstico. Recarga tu sesión o selecciona otro workspace."
        : err instanceof ApiRequestError ? err.message : "No se pudo cargar el diagnóstico del dominio");
    } finally {
      if (this.requests.isCurrent(request, this.currentContext())) this.loading.set(false);
      // A manual load kicks the follow-up; `schedule()` is a no-op once
      // nothing is in flight. The silent path chains through the poller's own
      // attempt so a failed read cannot strand the ladder.
      if (!silent) this.poller.schedule();
    }
  }

  /** La línea de tiempo del dominio. Los errores son propios: el diagnóstico no depende de ellos. */
  async loadActivity(): Promise<void> {
    const workspaceId = this.workspaces.currentId();
    const role = this.workspaces.currentRole();
    const domainId = this.domainId();
    if (workspaceId === null || role === null || domainId === null) return;
    const request = this.activityRequests.begin(this.currentContext());
    this.activityLoading.set(true);
    try {
      const response = await this.api.get<DomainActivityResponse>(
        `/api/v1/domains/${domainId}/activity`,
        undefined,
        decodeDomainActivityResponse,
        { signal: request.signal },
      );
      if (!this.activityRequests.isCurrent(request, this.currentContext())) return;
      this.activity.set(response.events);
      this.activityError.set(null);
    } catch {
      if (!this.activityRequests.isCurrent(request, this.currentContext())) return;
      // Una lectura fallida del historial no debe empañar el diagnóstico.
      if (this.activity().length === 0) this.activityError.set("No se pudo cargar la actividad del dominio");
    } finally {
      if (this.activityRequests.isCurrent(request, this.currentContext())) this.activityLoading.set(false);
    }
  }

  async startDnsCheck(): Promise<void> {
    const current = this.domain();
    if (!current || !this.canEdit() || this.actionBusy() || this.dnsWait() > 0 || current.dnsCheckInProgress || current.tlsStatus === "provisioning") return;
    const target = targetWorkspace(this.workspaces);
    if (target.workspaceId === null) return;
    const action = this.mutations.begin(0);
    const revalidate = current.state === "active" || current.state === "verified" || current.state === "disabled";
    try {
      await this.api.post<{ state: DomainState }>(
        `/api/v1/domains/${current.id}/${revalidate ? "revalidate" : "verify"}`,
        undefined,
        decodeDomainStateResponse,
      );
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open("Comprobación DNS iniciada", "Cerrar", { duration: 3000 });
      await this.load();
    } catch (err) {
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo iniciar la comprobación", "Cerrar", { duration: 5000 });
      if (err instanceof ApiRequestError && err.status === 429) this.retry.defer(`${this.currentContext()}:dns`, err.retryAfterSeconds);
      // 409 = ya hay una comprobación en vuelo; el estado avanza igualmente y
      // el refresco inmediato lo muestra sin esperar al siguiente sondeo.
      if (err instanceof ApiRequestError && err.status === 409) {
        await this.load();
      }
    } finally {
      this.mutations.settle(action);
    }
  }

  async activate(): Promise<void> {
    const current = this.domain();
    // The client-side mirror of the server's race guard: a revalidation in
    // flight keeps `state` at "verified", but its result could still demote
    // the domain, so preparing HTTPS now would waste an issuance on a row the
    // check is about to change.
    if (!current || current.state !== "verified" || current.dnsCheckInProgress || !this.canEdit() || this.actionBusy() || this.tlsWait() > 0) return;
    const target = targetWorkspace(this.workspaces);
    if (target.workspaceId === null) return;
    const action = this.mutations.begin(0);
    try {
      await this.intent.run(`domains.activate:${current.id}`, (key) =>
        this.api.post<{ state: DomainState }>(`/api/v1/domains/${current.id}/activate`, undefined, decodeDomainStateResponse, { "Idempotency-Key": key }),
      );
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open("Preparación HTTPS iniciada", "Cerrar", { duration: 3000 });
      await this.load();
    } catch (err) {
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo activar el dominio", "Cerrar", { duration: 5000 });
      if (err instanceof ApiRequestError && err.status === 429) this.retry.defer(`${this.currentContext()}:tls`, err.retryAfterSeconds);
      // Misma lectura que en la comprobación: un 409 es trabajo en curso.
      if (err instanceof ApiRequestError && err.status === 409) {
        await this.load();
      }
    } finally {
      this.mutations.settle(action);
    }
  }

  onRootChange(value: string): void {
    this.surfaceDirty.set(true);
    this.rootDestinationInput.set(value);
  }

  onModeChange(value: "platform" | "redirect" | "branded"): void {
    this.surfaceDirty.set(true);
    this.notFoundModeInput.set(value);
  }

  surfaceModeLabel(mode: string | null): string {
    return mode === "redirect"
      ? "Redirigir al destino raíz"
      : mode === "branded" ? "Aviso con la marca del dominio" : "Aviso de la plataforma";
  }

  private syncSurface(d: DomainDto): void {
    if (this.surfaceDirty()) return;
    const mode = d.notFoundMode;
    this.rootDestinationInput.set(d.rootDestination ?? "");
    this.notFoundModeInput.set(mode === "redirect" || mode === "branded" ? mode : "platform");
  }

  /** Guarda qué hace el dominio fuera de los enlaces: raíz y rutas desconocidas. */
  async saveSurface(): Promise<void> {
    const current = this.domain();
    if (!current || !this.canEdit() || this.actionBusy()) return;
    const root = this.rootDestinationInput().trim();
    const mode = this.notFoundModeInput();
    // El mismo contrato del servidor, anticipado para no gastar un viaje.
    if (mode === "redirect" && root === "") {
      this.snackbar.open("Configura antes un destino raíz para redirigir las rutas desconocidas", "Cerrar", { duration: 4500 });
      return;
    }
    const target = targetWorkspace(this.workspaces);
    if (target.workspaceId === null) return;
    const action = this.mutations.begin(0);
    try {
      const response = await this.api.patch<DomainDetailResponse>(
        `/api/v1/domains/${current.id}`,
        { rootDestination: root === "" ? null : root, notFoundMode: mode },
        (value) => decodeDomainDetailResponse(value, current.id, this.canEdit()),
      );
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      // A successful save confirms the submitted values, not a newer draft.
      const unchanged = this.rootDestinationInput().trim() === root && this.notFoundModeInput() === mode;
      this.domain.set(response.domain);
      if (unchanged) {
        this.surfaceDirty.set(false);
        this.syncSurface(response.domain);
      }
      this.snackbar.open("Preferencias de visitante guardadas", "Cerrar", { duration: 2500 });
    } catch (err) {
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudieron guardar las preferencias", "Cerrar", { duration: 5000 });
    } finally {
      this.mutations.settle(action);
    }
  }

  readonly stateLabel = domainStateLabel;

  /** «Tráfico: En línea» — el estado derivado que el usuario necesita, no `edgeEligible`. */
  trafficStatusLabel(d: DomainDto): string {
    return TRAFFIC_LABEL[d.trafficStatus];
  }

  activityLabel(event: string): string {
    return ACTIVITY_LABEL[event] ?? "Evento de dominio";
  }

  activityIcon(entry: DomainActivityEvent): string {
    const tone = this.activityTone(entry);
    return tone === "bad" ? "error_outline" : tone === "warn" ? "warning" : tone === "good" ? "check_circle" : "info";
  }

  activityTone(entry: DomainActivityEvent): "good" | "warn" | "bad" | "neutral" {
    if (entry.event === "domain.offline" || entry.event === "domain.tls_failed" || entry.event === "domain.claim_transferred") return "bad";
    if (entry.event === "domain.degraded" || entry.event === "domain.tls_expiring") return "warn";
    if (entry.event === "domain.recovered" || entry.event === "domain.verified" || entry.event === "domain.claimed" || entry.event === "domain.activated") return "good";
    return "neutral";
  }

  /** El detalle proyectado del evento, en una frase; nunca campos internos. */
  activityDetail(entry: DomainActivityEvent): string | null {
    const parts: string[] = [];
    if (entry.payload.reason) parts.push(this.activityReasonLabel(entry.payload.reason));
    if (entry.payload.daysRemaining !== undefined) parts.push(`quedan ${entry.payload.daysRemaining} días`);
    if (entry.payload.failureCount !== undefined && entry.payload.failureCount > 1) {
      parts.push(`${entry.payload.failureCount} comprobaciones fallidas`);
    }
    return parts.length ? parts.join(" · ") : null;
  }

  private activityReasonLabel(reason: string): string {
    return DNS_ERROR[reason] ?? TLS_ERROR[reason] ?? (reason === "claim_transferred"
      ? "Otro workspace probó el control del nombre."
      : "La configuración DNS dejó de ser válida.");
  }

  dnsErrorLabel(error: string | null): string | null { return error ? (DNS_ERROR[error] ?? "No se pudo confirmar la configuración DNS.") : null; }
  tlsErrorLabel(error: string | null): string | null { return error ? (TLS_ERROR[error] ?? "No se pudo completar la preparación HTTPS.") : null; }

  formatDate(value: string | null): string {
    return dateTimeMediumLabel(value, "Todavía no disponible");
  }

  /** The grace countdown for a degraded-but-serving domain. */
  graceLabel(): string | null {
    const d = this.domain();
    if (!d?.graceExpiresAt || d.trafficStatus !== "degraded") return null;
    const remainingMs = Date.parse(d.graceExpiresAt) - Date.now();
    if (!Number.isFinite(remainingMs)) return null;
    if (remainingMs <= 0) return "El periodo de seguridad está terminando; el dominio puede dejar de servir enlaces en cualquier momento.";
    const minutes = Math.round(remainingMs / 60_000);
    return minutes >= 90
      ? `Sigue funcionando durante el periodo de seguridad. Podría desconectarse en aproximadamente ${Math.round(minutes / 60)} h.`
      : `Sigue funcionando durante el periodo de seguridad. Podría desconectarse en aproximadamente ${Math.max(1, minutes)} min.`;
  }

  /**
   * What the resolver answered versus what was expected — the sentence that
   * turns "routing_missing" into an instruction. Null when nothing was
   * observed yet (never checked, or the resolver failed wholesale).
   */
  observedRoutingLabel(): string | null {
    const d = this.domain();
    if (!d?.dnsObservedAt) return null;
    if (d.routingObservedTarget !== null) {
      const ttl = d.routingObservedTtl === null ? "" : ` (TTL ${d.routingObservedTtl} s)`;
      if (d.routingStatus === "healthy") return `El CNAME apunta a «${d.routingObservedTarget}»${ttl}.`;
      return `Esperábamos «${d.cnameTarget ?? "el destino indicado"}», pero el resolvedor devuelve «${d.routingObservedTarget}»${ttl}.`;
    }
    if (d.routingObservedAddresses?.length) {
      return `No hay CNAME en este nombre; responde con direcciones (${d.routingObservedAddresses.join(", ")}). Suele indicar un proxy o flattening, que este flujo no soporta.`;
    }
    return "No encontramos ningún CNAME en este nombre.";
  }

  /** CAA guidance: the exact record to add, not just «revisa tu CAA». */
  caaLabel(): string | null {
    const d = this.domain();
    if (!d) return null;
    if (d.caaAllowsIssuer === false) {
      const observed = d.caaRecords?.map((r) => `${r.tag} «${r.value}»`).join(", ");
      return `Un registro CAA no permite a ${d.acmeIssuer} emitir el certificado${observed ? ` (observado: ${observed})` : ""}. Añade «issue "${d.acmeIssuer}"» o elimina la restricción.`;
    }
    if (d.caaAllowsIssuer === true) return `CAA permite expresamente a ${d.acmeIssuer} emitir el certificado.`;
    return null;
  }

  /** Certificate lifetime: the expiry Caddy must beat, in human terms. */
  tlsExpiryLabel(): string | null {
    const d = this.domain();
    if (!d?.tlsNotAfter) return null;
    const days = d.tlsDaysRemaining;
    const base = `Caduca el ${this.formatDate(d.tlsNotAfter)}`;
    if (days === null) return base + ".";
    return days <= 20
      ? `${base} — quedan ${days} días. Si no se renueva pronto, el dominio dejará de servir.`
      : `${base} — quedan ${days} días.`;
  }

  async remove(): Promise<void> {
    const domain = this.domain();
    const context = this.currentContext();
    if (!domain || !this.canAdmin() || this.actionBusy()) return;
    const action = this.mutations.begin(domain.id);
    const lifetime = new AbortController();
    this.removalAbort = lifetime;
    try {
      const result = await this.removal.open(domain, { signal: lifetime.signal });
      if (this.currentContext() !== context || !this.mutations.isCurrent(action) || !this.canAdmin()) return;
      if (result?.deleted) {
        this.snackbar.open("Dominio eliminado", "Cerrar", { duration: 2500 });
        await this.router.navigate(["/app/domains"]);
      } else await this.load();
    } catch (error) {
      if (this.currentContext() === context && this.mutations.isCurrent(action)) {
        this.snackbar.open(error instanceof ApiRequestError ? error.message : "No se pudo abrir la revisión del dominio", "Cerrar", { duration: 4000 });
      }
    } finally { lifetime.abort(); this.mutations.settle(action); }
  }

  copy(value: string | null, label: string): void {
    if (!value) return;
    const pending = navigator.clipboard?.writeText(value);
    if (!pending) {
      this.snackbar.open("El navegador no permite copiar automáticamente", "Cerrar", { duration: 2500 });
      return;
    }
    const context = this.currentContext();
    void pending.then(
      () => { if (this.currentContext() === context && !this.destroyRef.destroyed) { this.copyStatus.set(`${label} copiado`); this.snackbar.open(`${label} copiado`, "Cerrar", { duration: 2000 }); } },
      () => { if (this.currentContext() === context && !this.destroyRef.destroyed) { this.copyStatus.set("No se pudo copiar"); this.snackbar.open("No se pudo copiar", "Cerrar", { duration: 2500 }); } },
    );
  }
}
