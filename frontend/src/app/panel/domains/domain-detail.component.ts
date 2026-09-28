import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from "@angular/core";
import { AsyncPoller } from "../../core/async-poller";
import { takeUntilDestroyed } from "@angular/core/rxjs-interop";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSelectModule } from "@angular/material/select";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { dateTimeMediumLabel } from "../../core/date-time-label";
import type { DomainDetailResponse, DomainDto, DomainState } from "../../core/models";
import { IdempotentIntent } from "../../core/idempotent-intent";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { decodeDomainDetailResponse, decodeDomainStateResponse } from "../../core/services/domain-response-decoders";
import { LatestRequest } from "../../core/services/latest-request";
import { OwnedMutations } from "../../core/services/owned-mutations";
import { WorkspaceService } from "../../core/services/workspace.service";
import { parseRouteId } from "../../core/strict-wire";
import { targetWorkspace } from "../../core/services/workspace-target";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";
import { domainStateLabel } from "../../core/domain-state-label";

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
  imports: [RouterLink, FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatProgressBarModule, MatSelectModule, MatSnackBarModule, PageHeaderComponent, PanelSkeletonComponent],
  templateUrl: "./domain-detail.component.html",
  styleUrl: "./domain-detail.component.scss",
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class DomainDetailComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly workspaces = inject(WorkspaceService);
  private readonly snackbar = inject(MatSnackBar);
  private readonly destroyRef = inject(DestroyRef);
  private readonly requests = new LatestRequest(inject(DestroyRef));

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
  readonly loading = signal(true);
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
    this.route.paramMap.pipe(takeUntilDestroyed()).subscribe(() => this.domainId.set(this.paramId()));

    effect(() => {
      const workspaceId = this.workspaces.currentId();
      const role = this.workspaces.currentRole();
      const domainId = this.domainId();
      const context = workspaceId === null || role === null ? null : `${workspaceId}:${role}:${domainId}`;
      if (context === this.loadedContext) return;
      this.loadedContext = context;
      this.requests.invalidate();
      this.domain.set(null);
      this.error.set(null);
      this.surfaceDirty.set(false);
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
    return workspaceId === null || role === null ? null : `${workspaceId}:${role}:${this.domainId()}`;
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

    const request = this.requests.begin(`${workspaceId}:${role}:${domainId}`);
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
      this.syncSurface(response.domain);
      this.error.set(null);
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

  async startDnsCheck(): Promise<void> {
    const current = this.domain();
    if (!current || !this.canEdit() || this.actionBusy()) return;
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
    if (!current || current.state !== "verified" || current.dnsCheckInProgress || !this.canEdit() || this.actionBusy()) return;
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
      this.surfaceDirty.set(false);
      this.domain.set(response.domain);
      this.syncSurface(response.domain);
      this.snackbar.open("Preferencias de visitante guardadas", "Cerrar", { duration: 2500 });
    } catch (err) {
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudieron guardar las preferencias", "Cerrar", { duration: 5000 });
    } finally {
      this.mutations.settle(action);
    }
  }

  readonly stateLabel = domainStateLabel;
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

  copy(value: string | null, label: string): void {
    if (!value) return;
    const pending = navigator.clipboard?.writeText(value);
    if (!pending) {
      this.snackbar.open("El navegador no permite copiar automáticamente", "Cerrar", { duration: 2500 });
      return;
    }
    void pending.then(
      () => this.snackbar.open(`${label} copiado`, "Cerrar", { duration: 2000 }),
      () => this.snackbar.open("No se pudo copiar", "Cerrar", { duration: 2500 }),
    );
  }
}
