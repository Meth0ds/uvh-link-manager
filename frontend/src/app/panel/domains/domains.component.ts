import { Component, DestroyRef, effect, inject, signal, ChangeDetectionStrategy } from "@angular/core";
import { RouterLink } from "@angular/router";

import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatInputModule } from "@angular/material/input";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import { ApiService, ApiRequestError } from "../../core/services/api.service";
import type { DomainDto, DomainState } from "../../core/models";
import { WorkspaceService } from "../../core/services/workspace.service";
import { ActionDialogService } from "../action-dialog.service";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";
import { LatestRequest } from "../../core/services/latest-request";
import { AsyncPoller } from "../../core/async-poller";
import { IdempotentIntent } from "../../core/idempotent-intent";
import { OwnedMutations } from "../../core/services/owned-mutations";
import { targetWorkspace } from "../../core/services/workspace-target";
import { countLabel } from "../../core/count-label";
import { domainStateLabel } from "../../core/domain-state-label";
import {
  decodeCreatedDomainResponse,
  decodeDomainsResponse,
  decodeDomainStateResponse,
} from "../../core/services/domain-response-decoders";

const TLS_ERROR_LABEL: Record<string, string> = {
  certificate_provisioning_failed: "No se pudo emitir o validar el certificado. Revisa DNS y CAA antes de reintentar.",
  queue_unavailable: "La emisión no pudo entrar en cola. Vuelve a intentarlo.",
  provisioning_cancelled: "La emisión del certificado se canceló.",
  provisioning_timeout: "La emisión superó el tiempo previsto. Revisa DNS y vuelve a intentarlo.",
};

const DNS_ERROR_LABEL: Record<string, string> = {
  ownership_and_routing_missing: "No encontramos el TXT de propiedad ni el CNAME de tráfico.",
  ownership_missing: "No encontramos el TXT de propiedad.",
  routing_missing: "El CNAME todavía no apunta al destino indicado.",
  resolver_unavailable: "El resolvedor DNS no respondió. Volveremos a intentarlo.",
  queue_unavailable: "La comprobación no pudo entrar en cola. Vuelve a intentarlo.",
  queue_timeout: "La comprobación tardó demasiado. Vuelve a iniciarla.",
  verification_cancelled: "La comprobación se canceló porque cambiaron tus permisos.",
};

@Component({
  selector: "app-domains",
  standalone: true,
  imports: [
    RouterLink,
    FormsModule,
    MatButtonModule,
    MatIconModule,
    MatInputModule,
    MatFormFieldModule,
    MatProgressBarModule,
    MatSnackBarModule,
    PageHeaderComponent,
    PanelSkeletonComponent,
  ],
  templateUrl: "./domains.component.html",
  changeDetection: ChangeDetectionStrategy.Eager,
  styleUrl: "./domains.component.scss",
})
export class DomainsComponent {
  private api = inject(ApiService);
  private workspaces = inject(WorkspaceService);
  private snackbar = inject(MatSnackBar);
  private actions = inject(ActionDialogService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly loadRequests = new LatestRequest(inject(DestroyRef));
  private readonly pollRequests = new LatestRequest(inject(DestroyRef));

  readonly domains = signal<DomainDto[]>([]);
  readonly loading = signal(true);
  /** La creación en vuelo y su dueño; ver `OwnedMutations`. */
  private readonly addMutation = new OwnedMutations();
  readonly adding = this.addMutation.busy;
  readonly verifyingId = signal<number | null>(null);
  /** La única mutación en vuelo y su dueño; ver `OwnedMutations`. */
  private readonly mutations = new OwnedMutations();
  /** Clave de idempotencia por intención para crear/activar/desactivar. */
  private readonly intent = new IdempotentIntent();
  readonly actionId = this.mutations.value;
  readonly newDomain = signal("");
  readonly error = signal<string | null>(null);

  readonly canEdit = (): boolean => {
    const role = this.workspaces.currentRole();
    return role === "owner" || role === "admin" || role === "editor";
  };

  /** Desactivar/Eliminar apagan o borran todos los enlaces del dominio: admin+. */
  readonly canAdmin = (): boolean => {
    const role = this.workspaces.currentRole();
    return role === "owner" || role === "admin";
  };

  /** «1 enlace» / «137 enlaces»: el impacto de cada acción sobre el dominio. */
  readonly linksLabel = (d: DomainDto): string => countLabel(d.linksCount, "enlace", "enlaces");

  readonly stateLabel = (d: DomainDto): string => {
    if (this.isChecking(d)) return "Comprobando DNS…";
    // Degraded keeps serving on grace — the label must say "act now", not
    // pretend the green state still applies.
    if (d.trafficStatus === "degraded") return "Requiere atención";
    if (d.state === "active" && !d.edgeEligible) return "Revalidación necesaria";
    return domainStateLabel(d.state);
  };

  /**
   * The grace countdown: a degraded domain still serves, and the owner needs
   * to know for how long before links on it go dark.
   */
  readonly graceLabel = (d: DomainDto): string | null => {
    if (!d.graceExpiresAt || d.trafficStatus !== "degraded") return null;
    const remainingMs = Date.parse(d.graceExpiresAt) - Date.now();
    if (!Number.isFinite(remainingMs)) return null;
    if (remainingMs <= 0) {
      return "El periodo de seguridad está terminando. El dominio puede dejar de servir enlaces en cualquier momento.";
    }
    const minutes = Math.round(remainingMs / 60_000);
    const human = minutes >= 90 ? `aproximadamente ${Math.round(minutes / 60)} h` : `aproximadamente ${Math.max(1, minutes)} min`;
    return `El dominio sigue funcionando durante el periodo de seguridad. Podría desconectarse en ${human}.`;
  };

  readonly dnsErrorLabel = (error: string | null): string | null => error
    ? (DNS_ERROR_LABEL[error] ?? "No se pudo confirmar la configuración DNS.")
    : null;

  readonly tlsErrorLabel = (error: string | null): string | null => error
    ? (TLS_ERROR_LABEL[error] ?? "No se pudo completar la preparación HTTPS.")
    : null;

  readonly isChecking = (d: DomainDto): boolean => {
    if (!d.dnsCheckStartedAt) return d.state === "verifying";
    if (!d.dnsCheckCompletedAt) return true;
    return Date.parse(d.dnsCheckStartedAt) > Date.parse(d.dnsCheckCompletedAt);
  };

  private loadedWorkspaceId: number | null | undefined;

  constructor() {
    effect(() => {
      const workspaceId = this.workspaces.currentId();
      if (workspaceId === this.loadedWorkspaceId) return;
      this.loadedWorkspaceId = workspaceId;
      this.loadRequests.invalidate();
      this.pollRequests.invalidate();
      this.domains.set([]);
      this.error.set(null);
      // Una acción en vuelo pertenece al workspace que dejó la pantalla; su
      // `finally` no va a liberar este hueco, así que lo libera el contexto.
      // Vale igual para la creación: su hueco y su derecho a publicar mueren
      // con el contexto que la inició.
      this.mutations.reset();
      this.addMutation.reset();
      this.verifyingId.set(null);
      if (workspaceId === null) {
        this.loading.set(false);
        return;
      }
      void this.load();
    });
  }

  async load(): Promise<void> {
    const workspaceId = this.workspaces.currentId();
    if (workspaceId === null) {
      this.loadRequests.invalidate();
      this.domains.set([]);
      this.loading.set(false);
      return;
    }
    const request = this.loadRequests.begin(workspaceId);
    this.loading.set(true);
    this.error.set(null);
    try {
      const { domains } = await this.api.get<{ domains: DomainDto[]}>("/api/v1/domains", undefined, (value) => decodeDomainsResponse(value, this.canEdit()), { signal: request.signal });
      if (!this.loadRequests.isCurrent(request, this.workspaces.currentId())) return;
      this.domains.set(domains);
    } catch (err) {
      if (!this.loadRequests.isCurrent(request, this.workspaces.currentId())) return;
      this.error.set(err instanceof ApiRequestError ? err.message : "No se pudieron cargar los dominios");
    } finally {
      if (this.loadRequests.isCurrent(request, this.workspaces.currentId())) this.loading.set(false);
    }
  }

  async add(): Promise<void> {
    const domain = this.newDomain().trim();
    if (!domain || this.adding() || !this.canEdit()) return;
    const target = targetWorkspace(this.workspaces);
    if (target.workspaceId === null) return;
    // The create carries an operation identity too: comparing only the context
    // still leaves the ABA —create 1 in flight, switch away and back, create 2
    // starts, create 1 lands late and `isCurrent()` is true again— where the
    // first result would publish over the second and clear ITS busy slot.
    const action = this.addMutation.begin(0);
    try {
      const { domain: created } = await this.intent.run(`domains.create:${domain}`, (key) =>
        this.api.post<{ domain: DomainDto }>(
          "/api/v1/domains",
          { domain },
          decodeCreatedDomainResponse,
          { "Idempotency-Key": key },
        ),
      );
      // The created row carries a one-time ownership TXT token. Publish it only
      // into the workspace it was created for AND only if this create still
      // owns the slot: a selection change or a newer create in flight must not
      // move it into another tenant's list or another operation's result.
      if (!target.isCurrent() || !this.addMutation.isCurrent(action)) return;
      this.newDomain.set("");
      this.snackbar.open("Dominio añadido. Añade el registro TXT para verificar.", "Cerrar", { duration: 4000 });
      this.domains.update((d) => [created, ...d]);
    } catch (err) {
      if (!target.isCurrent() || !this.addMutation.isCurrent(action)) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo añadir el dominio", "Cerrar", { duration: 4000 });
    } finally {
      // Only the operation that still owns the slot may clear it.
      this.addMutation.settle(action);
    }
  }

  async verify(d: DomainDto): Promise<void> {
    // El botón se desactiva mientras hay una comprobación; el método lo espeja
    // para que ningún llamante encole una revalidación inútil detrás de otra.
    if (this.actionId() || !this.canEdit() || this.isChecking(d) || d.dnsCheckInProgress) return;
    const target = targetWorkspace(this.workspaces);
    if (target.workspaceId === null) return;
    const action = this.mutations.begin(d.id);
    this.verifyingId.set(d.id);
    try {
      const revalidation = d.state === "active" || d.state === "verified" || d.state === "disabled";
      const path = `/api/v1/domains/${d.id}/${revalidation ? "revalidate" : "verify"}`;
      const result = await this.api.post<{ state: DomainState }>(path, undefined, decodeDomainStateResponse);
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open("Verificación DNS iniciada. Actualizaremos el estado automáticamente.", "Cerrar", { duration: 4000 });
      this.domains.update((domains) => domains.map((item) => item.id === d.id ? { ...item, state: result.state } : item));
      this.pollVerification(d.id);
    } catch (err) {
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open(
        err instanceof ApiRequestError ? err.message : "No se pudo verificar el dominio",
        "Cerrar",
        { duration: 5000 },
      );
      // 409 = ya hay una comprobación en vuelo (la del planificador o la de
      // otro miembro): el estado ya evoluciona solo y el panel lo sigue en
      // vez de quedarse esperando otra pulsación.
      if (err instanceof ApiRequestError && err.status === 409) {
        this.pollVerification(d.id);
      }
      void this.load();
    } finally {
      if (target.isCurrent() && this.mutations.isCurrent(action)) {
        this.verifyingId.set(null);
      }
      this.mutations.settle(action);
    }
  }

  private pollVerification(id: number): void {
    this.pollDomainState(id, {
      attempts: 30,
      // The chain follows DNS into TLS on its own: a check that proves both
      // records starts auto-TLS in the same breath, so "settled" is only true
      // once nothing is in flight — not merely when the DNS answer landed.
      settled: (domain) => !this.isChecking(domain) && domain.tlsStatus !== "provisioning",
      exhausted: "La operación sigue en curso. Puedes actualizar el estado dentro de unos minutos.",
    });
  }

  /**
   * Sonda única por operación: refresca el estado hasta que se asienta o se
   * agotan los intentos. La espera vive en `AsyncPoller`: una sola espera
   * armada, pausa con la pestaña oculta, reanudación al volver y corte al
   * cambiar de workspace (el guardián `pollRequests` manda sobre la sonda).
   *
   * Un fallo de red no mata la sonda: el aviso de «actualizaremos el estado
   * automáticamente» se cumple con reintento y backoff, y sólo el presupuesto
   * de intentos agotado —no un 502 transitorio— termina la espera.
   */
  private pollDomainState(
    id: number,
    options: { attempts: number; settled: (domain: DomainDto) => boolean; exhausted: string },
  ): void {
    const workspaceId = this.workspaces.currentId();
    if (workspaceId === null) return;
    const request = this.pollRequests.begin(workspaceId);
    let remaining = options.attempts;
    const poller = new AsyncPoller({
      destroyRef: this.destroyRef,
      // 2s, 2s, 4s, 8s… saturando en 8s: el estado DNS tarda lo que tarda el
      // worker, y un error transitorio no debe costar un intento entero.
      delays: [2_000, 2_000, 4_000, 8_000],
      wantsMore: () => remaining > 0,
      attempt: async () => {
        remaining -= 1;
        if (!this.pollRequests.isCurrent(request, this.workspaces.currentId())) return;
        let settled = false;
        try {
          const { domains } = await this.api.get<{ domains: DomainDto[] }>("/api/v1/domains", undefined, (value) => decodeDomainsResponse(value, this.canEdit()), { signal: request.signal });
          if (!this.pollRequests.isCurrent(request, this.workspaces.currentId())) return;
          this.domains.set(domains);
          const current = domains.find((domain) => domain.id === id);
          settled = !current || options.settled(current);
        } catch {
          // A failed read is not a settled operation: keep polling until the
          // budget runs out instead of silently abandoning the promise.
        }
        if (settled) return;
        if (remaining <= 0) {
          if (this.pollRequests.isCurrent(request, this.workspaces.currentId())) {
            this.snackbar.open(options.exhausted, "Cerrar", { duration: 5000 });
          }
          return;
        }
        poller.schedule();
      },
    });
    poller.schedule();
  }

  async activate(d: DomainDto): Promise<void> {
    // Espejo cliente de la guardia de carrera del servidor: mientras una
    // comprobación DNS corre, su resultado puede degradar el dominio, y
    // preparar HTTPS ahora gastaría una emisión en una fila a punto de cambiar.
    if (this.actionId() || !this.canEdit() || this.isChecking(d) || d.dnsCheckInProgress) return;
    const target = targetWorkspace(this.workspaces);
    if (target.workspaceId === null) return;
    const action = this.mutations.begin(d.id);
    try {
      const result = await this.intent.run(`domains.activate:${d.id}`, (key) =>
        this.api.post<{ state: DomainState }>(
          `/api/v1/domains/${d.id}/activate`,
          undefined,
          decodeDomainStateResponse,
          { "Idempotency-Key": key },
        ),
      );
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.domains.update((domains) => domains.map((item) => item.id === d.id ? { ...item, state: result.state } : item));
      if (result.state === "provisioning") {
        this.snackbar.open("Emitiendo y validando el certificado…", "Cerrar", { duration: 3500 });
        this.pollActivation(d.id);
      } else {
        this.snackbar.open("Dominio activado", "Cerrar", { duration: 2500 });
      }
    } catch (err) {
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
      // Misma lectura que en verify: un 409 significa trabajo en curso cuyo
      // estado conviene seguir, no un final.
      if (err instanceof ApiRequestError && err.status === 409) {
        this.pollVerification(d.id);
      }
    } finally {
      this.mutations.settle(action);
    }
  }

  private pollActivation(id: number): void {
    this.pollDomainState(id, {
      attempts: 30,
      settled: (domain) => domain.tlsStatus !== "provisioning",
      exhausted: "La emisión continúa en segundo plano. El estado se actualizará al terminar.",
    });
  }

  async disable(d: DomainDto): Promise<void> {
    if (this.actionId() || !this.canAdmin()) return;
    const target = targetWorkspace(this.workspaces);
    if (target.workspaceId === null) return;
    // Desactivar apaga todos los enlaces del dominio a la vez: la confirmación
    // dice cuántos y que ninguno se elimina.
    const confirmed = await this.actions.confirm({
      title: "Desactivar dominio",
      message: `¿Quieres desactivar ${d.domain}? ${d.linksCount === 1 ? "1 enlace dejará" : `${d.linksCount} enlaces dejarán`} de responder mientras el dominio esté desactivado. Los enlaces no se eliminarán.`,
      confirmLabel: "Desactivar dominio",
      destructive: true,
    });
    if (!confirmed || this.actionId() || !target.isCurrent()) return;
    const action = this.mutations.begin(d.id);
    try {
      await this.intent.run(`domains.disable:${d.id}`, (key) =>
        this.api.post(`/api/v1/domains/${d.id}/disable`, undefined, undefined, { "Idempotency-Key": key }),
      );
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open("Dominio desactivado", "Cerrar", { duration: 2500 });
      void this.load();
    } catch (err) {
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      // Only the operation that still owns the slot may clear it: a stale
      // action landing late must not re-enable the rows of a newer one.
      this.mutations.settle(action);
    }
  }

  /**
   * Marca (o desmarca) el dominio como predeterminado del workspace: el que
   * preseleccionan los enlaces nuevos. Requiere que esté sirviendo de verdad,
   * la misma regla que para crear un enlace sobre él.
   */
  async setDefault(d: DomainDto, isDefault: boolean): Promise<void> {
    if (this.actionId() || !this.canEdit()) return;
    const target = targetWorkspace(this.workspaces);
    if (target.workspaceId === null) return;
    const action = this.mutations.begin(d.id);
    try {
      await this.api.patch(`/api/v1/domains/${d.id}`, { isDefault });
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open(
        isDefault ? "Dominio predeterminado para los enlaces nuevos" : "Preferencia eliminada",
        "Cerrar",
        { duration: 2500 },
      );
      void this.load();
    } catch (err) {
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.mutations.settle(action);
    }
  }

  async remove(d: DomainDto): Promise<void> {
    if (!this.canAdmin()) return;
    const target = targetWorkspace(this.workspaces);
    const confirmed = await this.actions.confirm({
      title: "Eliminar dominio",
      message: `¿Quieres eliminar ${d.domain}? Antes debes haber reasignado todos sus enlaces, incluidos los que estén en la papelera.`,
      confirmLabel: "Eliminar dominio",
      destructive: true,
    });
    if (!confirmed || this.actionId() || !target.isCurrent()) return;
    const action = this.mutations.begin(d.id);
    try {
      await this.api.delete(`/api/v1/domains/${d.id}`);
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open("Dominio eliminado", "Cerrar", { duration: 2500 });
      void this.load();
    } catch (err) {
      if (!target.isCurrent() || !this.mutations.isCurrent(action)) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      // Only the operation that still owns the slot may clear it: a stale
      // action landing late must not re-enable the rows of a newer one.
      this.mutations.settle(action);
    }
  }

  copy(value: string | null, label = "Registro"): void {
    if (!value) return;
    const write = navigator.clipboard?.writeText(value);
    if (!write) {
      this.snackbar.open("El navegador no permite copiar automáticamente", "Cerrar", { duration: 2500 });
      return;
    }
    void write.then(
      () => this.snackbar.open(`${label} copiado`, "Cerrar", { duration: 2000 }),
      () => this.snackbar.open("No se pudo copiar", "Cerrar", { duration: 2500 }),
    );
  }

  trackByDomain(_i: number, d: DomainDto): number {
    return d.id;
  }
}
