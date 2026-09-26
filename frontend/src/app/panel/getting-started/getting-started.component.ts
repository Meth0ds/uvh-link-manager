import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from "@angular/core";
import { RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { WorkspaceGettingStarted } from "../../core/models";
import { decodeWorkspaceDismissal, decodeWorkspaceGettingStarted } from "../../core/services/workspace-response-decoders";
import { LatestRequest } from "../../core/services/latest-request";
import { PageHeaderComponent } from "../page-header.component";
import { gettingStartedSteps } from "./getting-started.steps";

type LoadState = { key: string; loading: boolean; error: string | null; data: WorkspaceGettingStarted | null };

@Component({
  selector: "app-getting-started",
  standalone: true,
  imports: [RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, PageHeaderComponent],
  templateUrl: "./getting-started.component.html",
  styleUrl: "./getting-started.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class GettingStartedComponent {
  readonly compact = input(false);
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly workspaces = inject(WorkspaceService);
  private readonly destroyRef = inject(DestroyRef);
  private readonly requests = new LatestRequest(this.destroyRef);
  private readonly state = signal<LoadState | null>(null);
  // Local override of the server-side presentation preference. A mutation's
  // result always wins over a GET that was already in flight when it happened.
  private readonly preference = signal<{ key: string; hidden: boolean } | null>(null);
  readonly reviewing = signal(false);
  readonly preferenceError = signal(false);

  readonly context = computed(() => {
    const user = this.auth.user();
    const workspace = this.workspaces.list().find((w) => w.id === this.workspaces.currentId());
    if (!user || !workspace?.role) return null;
    return {
      workspaceId: workspace.id, name: workspace.name,
      // Role/MFA changes invalidate display immediately, before the effect runs.
      key: `${user.id}:${workspace.id}:${workspace.role}:${user.mfaEnabled}`,
    };
  });
  private readonly currentState = computed(() => this.state()?.key === this.context()?.key ? this.state() : null);
  readonly data = computed(() => this.currentState()?.data ?? null);
  readonly loading = computed(() => this.context() !== null && (this.currentState()?.loading ?? true));
  readonly error = computed(() => this.currentState()?.error ?? null);
  readonly hidden = computed(() => {
    const context = this.context();
    const preference = this.preference();
    if (context && preference?.key === context.key) return preference.hidden;
    return this.currentState()?.data?.dismissedAt != null;
  });
  readonly steps = computed(() => this.data() ? gettingStartedSteps(this.data()!) : []);
  readonly observed = computed(() => this.steps().filter((s) => !s.optional && s.observed).length);
  readonly complete = computed(() => this.data() !== null && this.steps().filter((s) => !s.optional).every((s) => s.observed));

  constructor() {
    effect(() => {
      this.context(); // Register the dependency that triggers a reload.
      untracked(() => {
        this.reviewing.set(false);
        this.preferenceError.set(false);
        this.preference.set(null);
        void this.reload();
      });
    });
  }

  async reload(): Promise<void> {
    const context = this.context();
    const request = this.requests.begin(context?.key ?? null);
    this.state.set(context ? { key: context.key, loading: true, error: null, data: null } : null);
    if (!context || this.destroyRef.destroyed) return;
    const isCurrent = () => this.requests.isCurrent(request, context.key) && context.key === this.context()?.key;
    try {
      const data = await this.api.get<WorkspaceGettingStarted>(
        `/api/v1/workspaces/${context.workspaceId}/getting-started`,
        undefined,
        (value) => decodeWorkspaceGettingStarted(value, context.workspaceId),
        { signal: request.signal },
      );
      if (!isCurrent()) return;
      // Keep a local context assertion as defence in depth and for test doubles
      // that do not execute ApiService's decoder callback.
      if (data.workspaceId !== context.workspaceId) throw new Error("Invalid onboarding response");
      this.state.set({ key: context.key, loading: false, error: null, data });
    } catch (error) {
      if (!isCurrent()) return;
      this.state.set({ key: context.key, loading: false, data: null,
        error: error instanceof ApiRequestError ? error.message : "No se pudo comprobar el estado de la guía." });
    }
  }

  async dismiss(): Promise<void> {
    await this.setHidden(true);
    this.reviewing.set(false);
  }

  async resume(): Promise<void> {
    await this.setHidden(false);
    this.reviewing.set(true);
    void this.reload();
  }

  /**
   * Persist only the presentation preference, never facts, email, token or a
   * completion bit. Closing the guide cannot change server-side progress: the
   * flag lives on the caller's membership row, so it follows the account across
   * devices instead of this browser's `localStorage` alone.
   */
  private async setHidden(hidden: boolean): Promise<void> {
    const context = this.context();
    if (!context) return;
    this.preference.set({ key: context.key, hidden });
    try {
      const result = await this.api.patch<{ ok: true; dismissedAt: string | null }>(
        `/api/v1/workspaces/${context.workspaceId}/getting-started`,
        { hidden },
        decodeWorkspaceDismissal,
      );
      this.preference.set({ key: context.key, hidden: result.dismissedAt != null });
      this.preferenceError.set(false);
    } catch {
      // The server keeps its own truth: fall back to it and warn instead of
      // claiming a dismissal that never happened.
      this.preference.set(null);
      this.preferenceError.set(true);
    }
  }
}
