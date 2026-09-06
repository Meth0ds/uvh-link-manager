import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from "@angular/core";
import { RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import type { WorkspaceRole, WorkspaceUsage, WorkspaceUsageQuota } from "../../core/models";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { PageHeaderComponent } from "../page-header.component";
import { decodeWorkspaceUsage } from "./usage-response";

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
  private readonly state = signal<UsageState | null>(null);
  private requestNumber = 0;
  private wait: { userId: number; until: number } | null = null;

  readonly roleLabels: Record<WorkspaceRole, string> = {
    owner: "Propietario", admin: "Administrador", editor: "Editor", viewer: "Visualizador",
  };
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
  readonly error = computed(() => this.current()?.error ?? null);
  readonly cards = computed<UsageCard[]>(() => {
    const data = this.data();
    if (!data) return [];
    return (Object.keys(RESOURCE_COPY) as ResourceKey[]).flatMap((key) => {
      const quota = data.resources[key];
      if (quota === null) return [];
      const copy = RESOURCE_COPY[key];
      const percent = quota.limit === null ? null : Math.min(100, quota.limit === 0 ? 100 : Math.round((quota.used / quota.limit) * 100));
      let guidance = quota.policy === "unavailable"
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
      ++this.requestNumber;
      this.state.set(null);
      this.wait = null;
    });
  }

  async reload(): Promise<void> {
    if (this.destroyRef.destroyed) return;
    const context = this.context();
    if (!context) { ++this.requestNumber; this.state.set(null); return; }
    if (this.current()?.loading) return;
    const request = ++this.requestNumber;
    const isCurrent = () => !this.destroyRef.destroyed && request === this.requestNumber && this.context() === context;
    const fail = (message: string) => this.state.set({ context, data: null, loading: false, error: message });
    if (this.wait?.userId === context.userId && this.wait.until > Date.now()) {
      fail(`Espera ${Math.ceil((this.wait.until - Date.now()) / 1000)} segundos antes de volver a consultar.`);
      return;
    }
    this.state.set({ context, data: null, loading: true, error: null });
    try {
      const data = await this.api.get(
        `/api/v1/workspaces/${context.workspaceId}/usage`,
        undefined,
        (value) => decodeWorkspaceUsage(value, context.workspaceId, context.role),
      );
      if (!isCurrent()) return;
      this.state.set({ context, data, loading: false, error: null });
    } catch (error) {
      if (!isCurrent()) return;
      const status = error instanceof ApiRequestError ? error.status : 0;
      const seconds = error instanceof ApiRequestError ? error.retryAfterSeconds : undefined;
      if ((status === 429 || status === 503) && seconds !== undefined && Number.isSafeInteger(seconds) && seconds >= 0) {
        this.wait = { userId: context.userId, until: Date.now() + seconds * 1000 };
      }
      fail(status === 401 || status === 403
        ? "Ya no tienes acceso al uso de este workspace. Comprueba tu sesión y tus permisos."
        : status === 429
          ? "Se ha alcanzado el límite de consultas. Espera antes de actualizar."
          : "No se pudo consultar el uso. Puedes volver a intentarlo más tarde.");
    }
  }
}
