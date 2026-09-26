import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from "@angular/core";
import { RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import type { WorkspaceRole, WorkspaceUsage, WorkspaceUsageQuota } from "../../core/models";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { RetryCountdown } from "../../core/retry-countdown";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { WORKSPACE_ROLE_LABEL } from "../../core/workspace-role-label";
import { PageHeaderComponent } from "../page-header.component";
import { decodeWorkspaceUsage } from "./usage-response";
import { LatestRequest } from "../../core/services/latest-request";

type UsageContext = { workspaceId: number; userId: number; name: string; role: WorkspaceRole };
type UsageState = { context: UsageContext; data: WorkspaceUsage | null; loading: boolean; error: string | null };
type ResourceKey = keyof WorkspaceUsage["resources"];

interface UsageCard {
  key: ResourceKey;
  label: string;
  icon: string;
  quota: WorkspaceUsageQuota;
  route: string;
  action: string;
  guidance: string;
  percent: number | null;
}

const RESOURCE_COPY: Record<ResourceKey, Omit<UsageCard, "key" | "quota" | "percent" | "guidance"> & { release: string }> = {
  links: { label: "Enlaces", icon: "link", route: "/app/links", action: "Gestionar enlaces", release: "Mueve a la papelera enlaces que ya no necesites." },
  domains: { label: "Dominios", icon: "language", route: "/app/domains", action: "Gestionar dominios", release: "Elimina dominios que ya no pertenezcan al workspace." },
  members: { label: "Miembros", icon: "group", route: "/app/team", action: "Ver equipo", release: "Revisa el equipo y retira accesos que ya no correspondan." },
  tokens: { label: "Tokens API", icon: "key", route: "/app/tokens", action: "Gestionar tokens", release: "Revoca tokens activos que ya no utilicen las integraciones." },
  webhooks: { label: "Webhooks", icon: "webhook", route: "/app/webhooks", action: "Gestionar webhooks", release: "Elimina webhooks que ya no deban recibir eventos." },
  invitations: { label: "Invitaciones pendientes", icon: "forward_to_inbox", route: "/app/team", action: "Gestionar invitaciones", release: "Cancela invitaciones pendientes que ya no sean necesarias." },
};

@Component({
  selector: "app-usage",
  standalone: true,
  imports: [DatePipe, RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, PageHeaderComponent],
  templateUrl: "./usage.component.html",
  styleUrl: "./usage.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class UsageComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly workspaces = inject(WorkspaceService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly requests = new LatestRequest(this.destroyRef);
  private readonly state = signal<UsageState | null>(null);
  // Account-wide advice survives workspace switches in this component. It is
  // merely UX: the backend enforces its own limit across sessions and tabs.
  private readonly waits = new RetryCountdown(this.destroyRef);

  readonly roleLabels = WORKSPACE_ROLE_LABEL;
  readonly context = computed<UsageContext | null>(() => {
    const user = this.auth.user();
    const workspace = this.workspaces.list().find((item) => item.id === this.workspaces.currentId());
    if (!user?.emailVerified || !workspace?.role || !Number.isSafeInteger(user.id) || user.id < 1
      || !Number.isSafeInteger(workspace.id) || workspace.id < 1) return null;
    return { workspaceId: workspace.id, userId: user.id, name: workspace.name, role: workspace.role };
  });
  private readonly current = computed(() => this.state()?.context === this.context() ? this.state() : null);
  readonly data = computed(() => this.current()?.data ?? null);
  readonly loading = computed(() => this.current()?.loading ?? this.context() !== null);
  /** Cuenta atrás de la espera por cuenta; 0 cuando no hay espera activa. */
  readonly waitSeconds = computed(() => {
    const context = this.context();
    return context ? this.waits.remaining(String(context.userId)) : 0;
  });
  /**
   * Mientras queda espera, el mensaje cuenta hacia abajo y sólo permite un
   * nuevo intento manual cuando caduca; nada se reintenta solo.
   */
  readonly error = computed(() => {
    const wait = this.waitSeconds();
    return wait > 0 ? `Espera ${wait} segundos antes de volver a consultar.` : this.current()?.error ?? null;
  });
  readonly cards = computed<UsageCard[]>(() => {
    const data = this.data();
    if (!data) return [];
    return (Object.keys(RESOURCE_COPY) as ResourceKey[]).flatMap((key) => {
      const quota = data.resources[key];
      if (quota === null) return [];
      const copy = RESOURCE_COPY[key];
      const percent = quota.limit === null ? null : Math.min(100, quota.limit === 0 ? 100 : Math.round((quota.used / quota.limit) * 100));
      const guidance = quota.policy === "unavailable"
        ? "La configuración de esta cuota no está disponible. No se asume capacidad libre."
        : quota.policy === "not_configured"
          ? "No existe un límite configurado; este recuento es informativo."
          : quota.reached
            ? quota.canManage ? copy.release : "Se alcanzó el límite. Pide a un rol con permisos que libere capacidad."
            : quota.canManage ? copy.release : "Puedes consultar el consumo; la gestión requiere un rol con más permisos.";
      return [{ key, ...copy, quota, guidance, percent }];
    });
  });

  constructor() {
    effect(() => {
      this.context();
      untracked(() => { void this.reload(); });
    });
    this.destroyRef.onDestroy(() => {
      this.state.set(null);
    });
  }

  async reload(): Promise<void> {
    if (this.destroyRef.destroyed) return;
    const context = this.context();
    if (!context) { this.requests.invalidate(); this.state.set(null); return; }
    if (this.current()?.loading) return;
    const requestContext = `${context.userId}:${context.workspaceId}:${context.role}`;
    const request = this.requests.begin(requestContext);
    const isCurrent = () => this.requests.isCurrent(request, requestContext) && this.context() === context;
    const fail = (message: string) => this.state.set({ context, data: null, loading: false, error: message });
    // The visible countdown is the state while it lasts: no premature request.
    // Fresh clock read: the wall clock can move without any signal change.
    if (this.waits.remaining(String(context.userId)) > 0) return;
    this.state.set({ context, data: null, loading: true, error: null });
    try {
      const data = await this.api.get(
        `/api/v1/workspaces/${context.workspaceId}/usage`,
        undefined,
        (value) => decodeWorkspaceUsage(value, context.workspaceId, context.role),
        { signal: request.signal },
      );
      if (!isCurrent()) return;
      this.state.set({ context, data, loading: false, error: null });
    } catch (error) {
      if (!isCurrent()) return;
      const status = error instanceof ApiRequestError ? error.status : 0;
      // Server advice becomes a visible countdown keyed by account. It only
      // permits a new manual attempt when it expires and never schedules one;
      // missing or invalid advice invents no wait.
      if (status === 429 || status === 503) {
        this.waits.defer(String(context.userId), error instanceof ApiRequestError ? error.retryAfterSeconds : undefined);
      }
      fail(status === 401 || status === 403
        ? "Ya no tienes acceso al uso de este workspace. Comprueba tu sesión y tus permisos."
        : status === 429
          ? "Se ha alcanzado el límite de consultas. Espera antes de actualizar."
          : "No se pudo consultar el uso. Puedes volver a intentarlo más tarde.");
    }
  }
}
