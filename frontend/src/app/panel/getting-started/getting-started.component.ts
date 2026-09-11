import { ChangeDetectionStrategy, Component, DestroyRef, computed, effect, inject, input, signal, untracked } from "@angular/core";
import { RouterLink } from "@angular/router";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { ApiRequestError, ApiService } from "../../core/services/api.service";
import { AuthService } from "../../core/services/auth.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { WorkspaceGettingStarted } from "../../core/models";
import { decodeWorkspaceGettingStarted } from "../../core/services/workspace-response-decoders";
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
  private readonly preference = signal<{ key: string; hidden: boolean } | null>(null);
  readonly reviewing = signal(false);
  readonly storageWarning = signal(false);

  readonly context = computed(() => {
    const user = this.auth.user();
    const workspace = this.workspaces.list().find((w) => w.id === this.workspaces.currentId());
    if (!user || !workspace?.role) return null;
    return {
      workspaceId: workspace.id, name: workspace.name,
      // Role/MFA changes invalidate display immediately, before the effect runs.
      key: `${user.id}:${workspace.id}:${workspace.role}:${user.mfaEnabled}`,
      preferenceKey: `uvh.getting-started.hidden.v1:${user.id}:${workspace.id}`,
    };
  });
  private readonly currentState = computed(() => this.state()?.key === this.context()?.key ? this.state() : null);
  readonly data = computed(() => this.currentState()?.data ?? null);
  readonly loading = computed(() => this.context() !== null && (this.currentState()?.loading ?? true));
  readonly error = computed(() => this.currentState()?.error ?? null);
  readonly hidden = computed(() => this.preference()?.key === this.context()?.preferenceKey && this.preference()?.hidden === true);
  readonly steps = computed(() => this.data() ? gettingStartedSteps(this.data()!) : []);
  readonly observed = computed(() => this.steps().filter((s) => !s.optional && s.observed).length);
  readonly complete = computed(() => this.data() !== null && this.steps().filter((s) => !s.optional).every((s) => s.observed));

  constructor() {
    effect(() => {
      const context = this.context();
      untracked(() => {
        this.reviewing.set(false);
        this.storageWarning.set(false);
        let hidden = false;
        if (context) {
          try { hidden = localStorage.getItem(context.preferenceKey) === "1"; }
          catch { this.storageWarning.set(true); }
        }
        this.preference.set(context ? { key: context.preferenceKey, hidden } : null);
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

  dismiss(): void {
    this.setHidden(true);
    this.reviewing.set(false);
  }

  resume(): void {
    this.setHidden(false);
    this.reviewing.set(true);
    void this.reload();
  }

  private setHidden(hidden: boolean): void {
    const context = this.context();
    if (!context) return;
    // Persist only presentation preference, never facts, email, token or a
    // completion bit. Closing the guide cannot change server-side progress.
    this.preference.set({ key: context.preferenceKey, hidden });
    try {
      if (hidden) localStorage.setItem(context.preferenceKey, "1");
      else localStorage.removeItem(context.preferenceKey);
      this.storageWarning.set(false);
    } catch { this.storageWarning.set(true); }
  }
}
