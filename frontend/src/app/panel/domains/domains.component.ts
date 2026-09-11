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
import {
  decodeCreatedDomainResponse,
  decodeDomainsResponse,
  decodeDomainStateResponse,
} from "../../core/services/domain-response-decoders";

const STATE_LABEL: Record<DomainState, string> = {
  pending: "Pendiente",
  verifying: "Verificando…",
  verified: "Verificado",
  provisioning: "Emitiendo certificado…",
  active: "Activo",
  error: "Error",
  disabled: "Desactivado",
};

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
  private readonly loadRequests = new LatestRequest(inject(DestroyRef));
  private readonly pollRequests = new LatestRequest(inject(DestroyRef));

  readonly domains = signal<DomainDto[]>([]);
  readonly loading = signal(true);
  readonly adding = signal(false);
  readonly verifyingId = signal<number | null>(null);
  readonly actionId = signal<number | null>(null);
  readonly newDomain = signal("");
  readonly error = signal<string | null>(null);

  readonly canEdit = (): boolean => {
    const role = this.workspaces.currentRole();
    return role === "owner" || role === "admin" || role === "editor";
  };

  readonly stateLabel = (d: DomainDto): string => {
    if (this.isChecking(d)) return "Comprobando…";
    if (d.state === "active" && !d.edgeEligible) return "Revalidación necesaria";
    return STATE_LABEL[d.state];
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
      this.actionId.set(null);
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
    this.adding.set(true);
    try {
      const { domain: created } = await this.api.post<{ domain: DomainDto }>(
        "/api/v1/domains",
        { domain },
        decodeCreatedDomainResponse,
      );
      this.newDomain.set("");
      this.snackbar.open("Dominio añadido. Añade el registro TXT para verificar.", "Cerrar", { duration: 4000 });
      this.domains.update((d) => [created, ...d]);
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo añadir el dominio", "Cerrar", { duration: 4000 });
    } finally {
      this.adding.set(false);
    }
  }

  async verify(d: DomainDto): Promise<void> {
    if (this.actionId() || !this.canEdit()) return;
    const workspaceId = this.workspaces.currentId();
    if (workspaceId === null) return;
    this.actionId.set(d.id);
    this.verifyingId.set(d.id);
    try {
      const revalidation = d.state === "active" || d.state === "verified" || d.state === "disabled";
      const path = `/api/v1/domains/${d.id}/${revalidation ? "revalidate" : "verify"}`;
      const result = await this.api.post<{ state: DomainState }>(path, undefined, decodeDomainStateResponse);
      if (this.workspaces.currentId() !== workspaceId) return;
      this.snackbar.open("Verificación DNS iniciada. Actualizaremos el estado automáticamente.", "Cerrar", { duration: 4000 });
      this.domains.update((domains) => domains.map((item) => item.id === d.id ? { ...item, state: result.state } : item));
      void this.pollVerification(d.id);
    } catch (err) {
      if (this.workspaces.currentId() !== workspaceId) return;
      this.snackbar.open(
        err instanceof ApiRequestError ? err.message : "No se pudo verificar el dominio",
        "Cerrar",
        { duration: 5000 },
      );
      void this.load();
    } finally {
      if (this.workspaces.currentId() === workspaceId && this.actionId() === d.id) {
        this.verifyingId.set(null);
        this.actionId.set(null);
      }
    }
  }

  private async pollVerification(id: number): Promise<void> {
    const workspaceId = this.workspaces.currentId();
    if (workspaceId === null) return;
    const request = this.pollRequests.begin(workspaceId);
    const attempts = 15;
    for (let attempt = 0; attempt < attempts; attempt += 1) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 2000));
      if (!this.pollRequests.isCurrent(request, this.workspaces.currentId())) return;
      try {
        const { domains } = await this.api.get<{ domains: DomainDto[] }>("/api/v1/domains", undefined, (value) => decodeDomainsResponse(value, this.canEdit()), { signal: request.signal });
        if (!this.pollRequests.isCurrent(request, this.workspaces.currentId())) return;
        this.domains.set(domains);
        const current = domains.find((domain) => domain.id === id);
        if (!current) return;
        if (!this.isChecking(current)) return;
      } catch {
        return;
      }
    }
    if (this.pollRequests.isCurrent(request, this.workspaces.currentId())) {
      this.snackbar.open("La comprobación sigue en cola. Puedes actualizar el estado dentro de unos minutos.", "Cerrar", { duration: 5000 });
    }
  }

  async activate(d: DomainDto): Promise<void> {
    if (this.actionId() || !this.canEdit()) return;
    const workspaceId = this.workspaces.currentId();
    if (workspaceId === null) return;
    this.actionId.set(d.id);
    try {
      const result = await this.api.post<{ state: DomainState }>(
        `/api/v1/domains/${d.id}/activate`,
        undefined,
        decodeDomainStateResponse,
      );
      if (this.workspaces.currentId() !== workspaceId) return;
      this.domains.update((domains) => domains.map((item) => item.id === d.id ? { ...item, state: result.state } : item));
      if (result.state === "provisioning") {
        this.snackbar.open("Emitiendo y validando el certificado…", "Cerrar", { duration: 3500 });
        void this.pollActivation(d.id);
      } else {
        this.snackbar.open("Dominio activado", "Cerrar", { duration: 2500 });
      }
    } catch (err) {
      if (this.workspaces.currentId() !== workspaceId) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      if (this.workspaces.currentId() === workspaceId && this.actionId() === d.id) this.actionId.set(null);
    }
  }

  private async pollActivation(id: number): Promise<void> {
    const workspaceId = this.workspaces.currentId();
    if (workspaceId === null) return;
    const request = this.pollRequests.begin(workspaceId);
    for (let attempt = 0; attempt < 30; attempt += 1) {
      await new Promise<void>((resolve) => window.setTimeout(resolve, 2000));
      if (!this.pollRequests.isCurrent(request, this.workspaces.currentId())) return;
      try {
        const { domains } = await this.api.get<{ domains: DomainDto[] }>("/api/v1/domains", undefined, (value) => decodeDomainsResponse(value, this.canEdit()), { signal: request.signal });
        if (!this.pollRequests.isCurrent(request, this.workspaces.currentId())) return;
        this.domains.set(domains);
        const current = domains.find((domain) => domain.id === id);
        if (!current || current.state !== "provisioning") return;
      } catch {
        return;
      }
    }
    if (this.pollRequests.isCurrent(request, this.workspaces.currentId())) {
      this.snackbar.open("La emisión continúa en segundo plano. El estado se actualizará al terminar.", "Cerrar", { duration: 5000 });
    }
  }

  async disable(d: DomainDto): Promise<void> {
    if (this.actionId() || !this.canEdit()) return;
    this.actionId.set(d.id);
    try {
      await this.api.post(`/api/v1/domains/${d.id}/disable`);
      this.snackbar.open("Dominio desactivado", "Cerrar", { duration: 2500 });
      void this.load();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.actionId.set(null);
    }
  }

  async remove(d: DomainDto): Promise<void> {
    if (!this.canEdit()) return;
    const confirmed = await this.actions.confirm({
      title: "Eliminar dominio",
      message: `¿Quieres eliminar ${d.domain}? Antes debes haber reasignado todos sus enlaces, incluidos los que estén en la papelera.`,
      confirmLabel: "Eliminar dominio",
      destructive: true,
    });
    if (!confirmed || this.actionId()) return;
    this.actionId.set(d.id);
    try {
      await this.api.delete(`/api/v1/domains/${d.id}`);
      this.snackbar.open("Dominio eliminado", "Cerrar", { duration: 2500 });
      void this.load();
    } catch (err) {
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "Error", "Cerrar", { duration: 4000 });
    } finally {
      this.actionId.set(null);
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
