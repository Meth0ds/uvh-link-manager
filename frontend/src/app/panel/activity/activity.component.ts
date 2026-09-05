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
  private readonly state = signal<State | null>(null);
  private requestNumber = 0;
  // Account-wide advice survives workspace switches in this component. It is
  // merely UX: the backend enforces its own limit across sessions and tabs.
  private wait: { userId: number; until: number } | null = null;
  readonly maximumEvents = 500;
  readonly pageSize = 25;
  readonly outcomeLabels = { completed: "Completado", pending: "Solicitud admitida", failed: "Fallido", unknown: "Resultado no confirmado" };
  readonly resourceLabels = { link: "Enlace", domain: "Dominio", api_token: "Token API", webhook: "Webhook", workspace: "Workspace" };
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
  readonly error = computed(() => this.current()?.error ?? null);
  readonly capped = computed(() => this.events().length >= this.maximumEvents);
  readonly hasMore = computed(() => !!this.current()?.cursor && !this.capped());

  constructor() {
    effect(() => {
      this.context();
      untracked(() => { void this.load(false); });
    });
    this.destroyRef.onDestroy(() => {
      ++this.requestNumber;
      this.state.set(null);
      this.wait = null;
    });
  }

  reload(): Promise<void> { return this.load(false); }
  loadMore(): Promise<void> { return this.load(true); }

  private async load(append: boolean): Promise<void> {
    if (this.destroyRef.destroyed) return;
    const context = this.context();
    if (!context) { ++this.requestNumber; this.state.set(null); return; }
    const previous = this.current();
    // Guard handlers as well as disabled buttons: rapid clicks cannot issue
    // parallel pages, reuse a cursor twice or accumulate an unbounded DOM.
    if (previous?.loading || (append && (!previous?.cursor || this.capped()))) return;
    const request = ++this.requestNumber;
    const reset = (error: string) => this.state.set({ context, events: [], cursor: null, loading: false, error });
    if (this.wait?.userId === context.userId && this.wait.until > Date.now()) {
      reset(`Espera ${Math.ceil((this.wait.until - Date.now()) / 1000)} segundos antes de volver a consultar.`);
      return;
    }
    const cursor = append ? previous!.cursor : null;
    // A server may return a short page with more available. Bound the final
    // request by remaining capacity, not by a count of full-size pages.
    const limit = Math.min(this.pageSize, this.maximumEvents - (append ? previous!.events.length : 0));
    this.state.set({ context, events: append ? previous!.events : [], cursor, loading: true, error: null });
    const isCurrent = () => !this.destroyRef.destroyed && request === this.requestNumber && this.context() === context;
    try {
      const raw = await this.api.get<unknown>(`/api/v1/workspaces/${context.workspaceId}/activity`, { limit, cursor });
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
      const seconds = error instanceof ApiRequestError ? error.retryAfterSeconds : undefined;
      if ((status === 429 || status === 503) && seconds !== undefined && Number.isSafeInteger(seconds) && seconds >= 0
        && Number.isSafeInteger(Date.now() + seconds * 1000)) {
        this.wait = { userId: context.userId, until: Date.now() + seconds * 1000 };
      }
      reset(status === 401 || status === 403 ? "Ya no tienes acceso a esta actividad. Comprueba tu sesión y tus permisos."
        : status === 422 ? "La paginación ha caducado o no es válida. Actualiza para empezar desde el inicio."
        : status === 429 ? "Se ha alcanzado el límite de consultas. Espera antes de actualizar."
        : "No se pudo consultar la actividad. Puedes volver a intentarlo más tarde.");
      // No polling, automatic retries or automatic restart of expired cursors.
    }
  }
}
