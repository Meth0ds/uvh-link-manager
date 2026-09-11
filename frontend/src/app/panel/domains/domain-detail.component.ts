import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal } from "@angular/core";
import { ActivatedRoute, RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatSnackBar, MatSnackBarModule } from "@angular/material/snack-bar";
import type { DomainDetailResponse, DomainDto, DomainState } from "../../core/models";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { decodeDomainDetailResponse, decodeDomainStateResponse } from "../../core/services/domain-response-decoders";
import { LatestRequest } from "../../core/services/latest-request";
import { WorkspaceService } from "../../core/services/workspace.service";
import { PageHeaderComponent } from "../page-header.component";
import { PanelSkeletonComponent } from "../panel-skeleton.component";

const STATE_LABEL: Record<DomainState, string> = {
  pending: "Pendiente de verificación",
  verifying: "Comprobando DNS",
  verified: "DNS verificado",
  provisioning: "Preparando HTTPS",
  active: "Activo",
  error: "Requiere atención",
  disabled: "Desactivado",
};

const DNS_ERROR: Record<string, string> = {
  ownership_and_routing_missing: "No encontramos ni el TXT de propiedad ni el CNAME de tráfico.",
  ownership_missing: "No encontramos el TXT de propiedad.",
  routing_missing: "El CNAME todavía no apunta al destino esperado.",
  resolver_unavailable: "El resolvedor DNS no respondió. El sistema volverá a intentarlo.",
  queue_unavailable: "La comprobación no pudo entrar en cola. Puedes reintentarlo.",
  queue_timeout: "La comprobación superó el tiempo previsto. Puedes iniciarla de nuevo.",
  verification_cancelled: "La comprobación se canceló porque cambió la autorización.",
};

const TLS_ERROR: Record<string, string> = {
  certificate_provisioning_failed: "No se pudo emitir o validar el certificado. Revisa DNS y los registros CAA.",
  queue_unavailable: "La emisión del certificado no pudo entrar en cola.",
  provisioning_cancelled: "La emisión del certificado se canceló.",
  provisioning_timeout: "La emisión superó el tiempo previsto. Revisa DNS antes de reintentar.",
};

@Component({
  selector: "app-domain-detail",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, MatSnackBarModule, PageHeaderComponent, PanelSkeletonComponent],
  templateUrl: "./domain-detail.component.html",
  styleUrl: "./domain-detail.component.scss",
  changeDetection: ChangeDetectionStrategy.Eager,
})
export class DomainDetailComponent {
  private readonly api = inject(ApiService);
  private readonly route = inject(ActivatedRoute);
  private readonly workspaces = inject(WorkspaceService);
  private readonly snackbar = inject(MatSnackBar);
  private readonly requests = new LatestRequest(inject(DestroyRef));

  readonly domain = signal<DomainDto | null>(null);
  readonly loading = signal(true);
  readonly actionBusy = signal(false);
  readonly error = signal<string | null>(null);
  readonly canEdit = computed(() => {
    const role = this.workspaces.currentRole();
    return role === "owner" || role === "admin" || role === "editor";
  });

  private readonly domainId = Number(this.route.snapshot.paramMap.get("id"));
  private loadedContext: string | null = null;

  constructor() {
    if (!Number.isSafeInteger(this.domainId) || this.domainId < 1) {
      this.error.set("El identificador del dominio no es válido");
      this.loading.set(false);
      return;
    }

    effect(() => {
      const workspaceId = this.workspaces.currentId();
      const role = this.workspaces.currentRole();
      const context = workspaceId === null || role === null ? null : `${workspaceId}:${role}`;
      if (context === this.loadedContext) return;
      this.loadedContext = context;
      this.requests.invalidate();
      this.domain.set(null);
      this.error.set(null);
      if (context === null) {
        this.loading.set(false);
        return;
      }
      void this.load();
    });
  }

  async load(): Promise<void> {
    const workspaceId = this.workspaces.currentId();
    const role = this.workspaces.currentRole();
    if (workspaceId === null || role === null) {
      this.requests.invalidate();
      this.domain.set(null);
      this.loading.set(false);
      return;
    }

    const request = this.requests.begin(`${workspaceId}:${role}`);
    this.loading.set(true);
    this.error.set(null);
    try {
      const response = await this.api.get<DomainDetailResponse>(
        `/api/v1/domains/${this.domainId}`,
        undefined,
        (value) => decodeDomainDetailResponse(value, this.domainId, this.canEdit()),
        { signal: request.signal },
      );
      if (!this.requests.isCurrent(request, `${this.workspaces.currentId()}:${this.workspaces.currentRole()}`)) return;
      this.domain.set(response.domain);
    } catch (err) {
      if (!this.requests.isCurrent(request, `${this.workspaces.currentId()}:${this.workspaces.currentRole()}`)) return;
      this.domain.set(null);
      this.error.set(err instanceof ApiRequestError && (err.status === 401 || err.status === 403)
        ? "Ya no tienes acceso a este diagnóstico. Recarga tu sesión o selecciona otro workspace."
        : err instanceof ApiRequestError ? err.message : "No se pudo cargar el diagnóstico del dominio");
    } finally {
      if (this.requests.isCurrent(request, `${this.workspaces.currentId()}:${this.workspaces.currentRole()}`)) this.loading.set(false);
    }
  }

  async startDnsCheck(): Promise<void> {
    const current = this.domain();
    if (!current || !this.canEdit() || this.actionBusy()) return;
    const workspaceId = this.workspaces.currentId();
    if (workspaceId === null) return;
    const revalidate = current.state === "active" || current.state === "verified" || current.state === "disabled";
    this.actionBusy.set(true);
    try {
      await this.api.post<{ state: DomainState }>(
        `/api/v1/domains/${current.id}/${revalidate ? "revalidate" : "verify"}`,
        undefined,
        decodeDomainStateResponse,
      );
      if (this.workspaces.currentId() !== workspaceId) return;
      this.snackbar.open("Comprobación DNS iniciada", "Cerrar", { duration: 3000 });
      await this.load();
    } catch (err) {
      if (this.workspaces.currentId() !== workspaceId) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo iniciar la comprobación", "Cerrar", { duration: 5000 });
    } finally {
      if (this.workspaces.currentId() === workspaceId) this.actionBusy.set(false);
    }
  }

  async activate(): Promise<void> {
    const current = this.domain();
    if (!current || current.state !== "verified" || !this.canEdit() || this.actionBusy()) return;
    const workspaceId = this.workspaces.currentId();
    if (workspaceId === null) return;
    this.actionBusy.set(true);
    try {
      await this.api.post<{ state: DomainState }>(`/api/v1/domains/${current.id}/activate`, undefined, decodeDomainStateResponse);
      if (this.workspaces.currentId() !== workspaceId) return;
      this.snackbar.open("Preparación HTTPS iniciada", "Cerrar", { duration: 3000 });
      await this.load();
    } catch (err) {
      if (this.workspaces.currentId() !== workspaceId) return;
      this.snackbar.open(err instanceof ApiRequestError ? err.message : "No se pudo activar el dominio", "Cerrar", { duration: 5000 });
    } finally {
      if (this.workspaces.currentId() === workspaceId) this.actionBusy.set(false);
    }
  }

  stateLabel(state: DomainState): string { return STATE_LABEL[state]; }
  dnsErrorLabel(error: string | null): string | null { return error ? (DNS_ERROR[error] ?? "No se pudo confirmar la configuración DNS.") : null; }
  tlsErrorLabel(error: string | null): string | null { return error ? (TLS_ERROR[error] ?? "No se pudo completar la preparación HTTPS.") : null; }

  formatDate(value: string | null): string {
    if (!value) return "Todavía no disponible";
    return new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" }).format(new Date(value));
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
