import { DestroyRef, Injectable, effect, inject, signal } from "@angular/core";
import { ApiService } from "./api.service";
import { WorkspaceService } from "./workspace.service";
import { AuthService } from "./auth.service";
import { LatestRequest } from "./latest-request";
import { decodeWorkflows } from "./link-workflow-decoders";
import type { LinkWorkflowCapabilities } from "../link-workflows";

@Injectable({ providedIn: "root" })
export class LinkWorkflowService {
  private readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly workspaces = inject(WorkspaceService);
  private readonly requests = new LatestRequest(inject(DestroyRef));
  readonly capabilities = signal<LinkWorkflowCapabilities | null>(null);
  private capabilityContext: string | null = null;
  private requestedContext: string | null = null;
  readonly enabled = () => this.capabilities()?.enabled === true && this.capabilityContext === this.context();
  constructor() {
    effect(() => {
      const context = this.context();
      if (context === this.requestedContext) return;
      this.requestedContext = context;
      this.requests.invalidate(); this.capabilityContext = null; this.capabilities.set(null);
      if (!this.auth.user?.() || this.workspaces.currentId() === null) return;
      const request = this.requests.begin(context);
      void this.api.get("/api/v1/link-workflows", undefined, decodeWorkflows, { signal: request.signal })
        .then(result => { if (this.requests.isCurrent(request, this.context())) { this.capabilityContext = context; this.capabilities.set(result); } }).catch(() => { /* Older deployments keep existing UI. */ });
    });
  }
  context(): string { return JSON.stringify([this.auth.user?.()?.id, this.auth.sessionGeneration(), this.workspaces.currentId(), this.workspaces.selectionGeneration(), this.workspaces.currentRole?.()]); }
}
