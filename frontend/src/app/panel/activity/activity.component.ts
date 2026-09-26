import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, signal, untracked } from "@angular/core";
import { DatePipe } from "@angular/common";
import { MatButtonModule } from "@angular/material/button";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import type { WorkspaceActivityEvent } from "../../core/models";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { PageHeaderComponent } from "../page-header.component";
import { readActivityPage } from "./activity-page";
import { LatestRequest } from "../../core/services/latest-request";
import { RetryCountdown } from "../../core/retry-countdown";
import { resourceTypeLabel } from "../../core/resource-type-label";

type Context = { workspaceId: number; userId: number; name: string };
type State = { context: Context; events: WorkspaceActivityEvent[]; cursor: string | null; loading: boolean; error: string | null };

@Component({
  selector: "app-workspace-activity", standalone: true,
  imports: [DatePipe, MatButtonModule, MatProgressBarModule, PageHeaderComponent],
  templateUrl: "./activity.component.html", styleUrl: "./activity.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class ActivityComponent {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly workspaces = inject(WorkspaceService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly requests = new LatestRequest(this.destroyRef);
  private readonly state = signal<State | null>(null);
  // Account-wide advice survives workspace switches in this component. It is
  // merely UX: the backend enforces its own limit across sessions and tabs.
  private readonly waits = new RetryCountdown(this.destroyRef);
  readonly maximumEvents = 500;
  readonly pageSize = 25;
  readonly outcomeLabels = { completed: "Completado", pending: "Solicitud admitida", failed: "Fallido", unknown: "Resultado no confirmado" };
  readonly resourceLabel = resourceTypeLabel;
  readonly context = computed<Context | null>(() => {
    const user = this.auth.user();
    const workspace = this.workspaces.list().find((w) => w.id === this.workspaces.currentId());
    if (!user?.emailVerified || !workspace || !["owner", "admin"].includes(workspace.role ?? "")
      || !Number.isSafeInteger(workspace.id) || workspace.id < 1 || !Number.isSafeInteger(user.id) || user.id < 1) return null;
    // Object identity invalidates the view immediately when any context input
    // changes, including a refreshed account/role with otherwise identical IDs.
    return { workspaceId: workspace.id, userId: user.id, name: workspace.name };
  });
  private readonly current = computed(() => this.state()?.context === this.context() ? this.state() : null);
  readonly events = computed(() => this.current()?.events ?? []);
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
  readonly capped = computed(() => this.events().length >= this.maximumEvents);
  readonly hasMore = computed(() => !!this.current()?.cursor && !this.capped());

  constructor() {
    effect(() => {
      this.context();
      untracked(() => { void this.load(false); });
    });
    this.destroyRef.onDestroy(() => {
      this.state.set(null);
    });
  }

  reload(): Promise<void> { return this.load(false); }
  loadMore(): Promise<void> { return this.load(true); }

  private async load(append: boolean): Promise<void> {
    if (this.destroyRef.destroyed) return;
    const context = this.context();
    if (!context) { this.requests.invalidate(); this.state.set(null); return; }
    const previous = this.current();
    // Guard handlers as well as disabled buttons: rapid clicks cannot issue
    // parallel pages, reuse a cursor twice or accumulate an unbounded DOM.
    if (previous?.loading || (append && (!previous?.cursor || this.capped()))) return;
    const requestContext = `${context.userId}:${context.workspaceId}`;
    const request = this.requests.begin(requestContext);
    const reset = (error: string) => this.state.set({ context, events: [], cursor: null, loading: false, error });
    // The visible countdown is the state while it lasts: no premature request.
    // Fresh clock read: the wall clock can move without any signal change.
    if (this.waits.remaining(String(context.userId)) > 0) return;
    const cursor = append ? previous!.cursor : null;
    // A server may return a short page with more available. Bound the final
    // request by remaining capacity, not by a count of full-size pages.
    const limit = Math.min(this.pageSize, this.maximumEvents - (append ? previous!.events.length : 0));
    this.state.set({ context, events: append ? previous!.events : [], cursor, loading: true, error: null });
    const isCurrent = () => this.requests.isCurrent(request, requestContext) && this.context() === context;
    try {
      const raw = await this.api.get<unknown>(
        `/api/v1/workspaces/${context.workspaceId}/activity`,
        { limit, cursor },
        undefined,
        { signal: request.signal },
      );
      if (!isCurrent()) return;
      const page = readActivityPage(raw, context.workspaceId, limit);
      const existing = append ? previous!.events : [];
      const ids = new Set(existing.map((event) => event.id));
      if ((cursor !== null && page.nextCursor === cursor) || page.events.some((event) => ids.has(event.id))) {
        throw new Error("Activity pagination did not advance");
      }
      this.state.set({ context, events: [...existing, ...page.events], cursor: page.nextCursor, loading: false, error: null });
    } catch (error) {
      if (!isCurrent()) return;
      // A failed page also clears earlier pages: in particular, revoked access
      // must not leave previously authorized data rendered behind an error.
      const status = error instanceof ApiRequestError ? error.status : 0;
      // Server advice becomes a visible countdown keyed by account. It only
      // permits a new manual attempt when it expires and never schedules one;
      // missing or invalid advice invents no wait.
      if (status === 429 || status === 503) {
        this.waits.defer(String(context.userId), error instanceof ApiRequestError ? error.retryAfterSeconds : undefined);
      }
      reset(status === 401 || status === 403 ? "Ya no tienes acceso a esta actividad. Comprueba tu sesión y tus permisos."
        : status === 422 ? "La paginación ha caducado o no es válida. Actualiza para empezar desde el inicio."
        : status === 429 ? "Se ha alcanzado el límite de consultas. Espera antes de actualizar."
        : "No se pudo consultar la actividad. Puedes volver a intentarlo más tarde.");
      // No polling, automatic retries or automatic restart of expired cursors.
    }
  }
}
