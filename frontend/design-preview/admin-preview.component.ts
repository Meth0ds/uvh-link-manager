/** Real administration components with read-only, fictional continuity data. */
import { ChangeDetectionStrategy, Component } from "@angular/core";
import { AdminComponent } from "../src/app/panel/admin/admin.component";
import { ApiService } from "../src/app/core/services/api.service";
import { SessionContextService } from "../src/app/core/services/session-context.service";
import { blocked } from "./workspace-fixture";

const stamp = "2026-10-24T08:00:00Z";
const sha = "a".repeat(40);
function recoveryFixture() {
  const mode = new URLSearchParams(location.search).get("scenario") ?? "local";
  const failed = mode === "intervention";
  return {
    enabled: true, recoveryConfigured: true,
    maintenance: { maintenance: failed || mode === "progress", reason: failed ? "incident" : null },
    updatedAt: stamp,
    github: { from: sha, sha: "b".repeat(40), eligible: true, stale: false, checkedAt: stamp,
      checks: ["CI", "Quality", "Security"].map(workflow => ({ workflow, state: "passed" })),
      commits: [{ sha: "b".repeat(40), message: "Mejoras de estabilidad y recuperación" }] },
    operation: mode === "progress" || failed ? { id: "fixture-operation", action: "backup", state: failed ? "requires_intervention" : "running", phase: failed ? "restoring" : "verifying_backup",
      error: failed ? { message: "No se ha podido comprobar la recuperación. El entorno permanece protegido." } : null } : null,
    backups: [0, 1, 2].map(index => ({ id: `fixture-${index}`, sha, createdAt: stamp, restoredAt: index === 2 ? null : stamp, bytes: 7340032 })),
    destinations: mode === "local" ? [] : [{ id: "fixture-external", name: "Archivo externo", type: "folder", configured: true, status: mode === "external-error" ? "failed" : "ready" }],
    policy: { dailyRetention: 7, weeklyRetention: 4, updateRetention: 3 },
  };
}
const previewApi = {
  async get<T>(path: string, _params: unknown, decode: (value: unknown) => T): Promise<T> {
    let value: unknown;
    if (path === "/api/v1/admin/updates") value = recoveryFixture();
    else if (path.endsWith("/overview")) value = { users: 8, workspaces: 5, links: 21, clicks: 144, openReports: 0, blockedLinks: 0, domains: 3, registrationPaused: false };
    else if (path.endsWith("/operations")) value = {
      state: "healthy", environment: "local", generatedAt: stamp, registrationPaused: false, checks: [],
      metrics: { pendingJobs: 0, oldestJobAgeSeconds: null, failedJobs: 0, webhookDeliveries: {}, oldestPendingWebhookAgeSeconds: null,
        mailOutbox: {}, oldestPendingMailAgeSeconds: null, activeSessions: 2, pendingRegistrations: 0, domains: {}, oldestDnsCheckAgeSeconds: null,
        oldestTlsProvisioningAgeSeconds: null, events60m: {}, queueHeartbeatAgeSeconds: 10, schedulerHeartbeatAgeSeconds: 20, activePrivacyRequests: 0, overduePrivacyRequests: 0 },
    };
    else if (path.endsWith("/users")) value = { users: [], total: 0, page: 1, perPage: 25 };
    else return blocked();
    return decode(value);
  },
  post: blocked, patch: blocked, delete: blocked,
};

@Component({
  selector: "app-admin-preview", standalone: true, imports: [AdminComponent],
  providers: [SessionContextService, { provide: ApiService, useValue: previewApi }],
  template: `<p class="fixture-notice">Vista de diseño · datos ficticios · operaciones bloqueadas</p><app-admin />`,
  styles: `.fixture-notice { padding: 10px; border: 1px dashed var(--uvh-muted); color: var(--uvh-muted); font-size: 12px; }`,
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class AdminPreviewComponent {
  constructor(session: SessionContextService) {
    session.user.set({ id: 900001, name: "Administración de ejemplo", email: "admin@example.invalid", isAdmin: true, emailVerified: true, mfaEnabled: true });
  }
}
