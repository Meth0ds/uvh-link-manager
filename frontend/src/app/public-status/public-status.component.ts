import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, DestroyRef, OnInit, computed, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import type { PublicServiceStatus, PublicStatusSnapshot } from "../core/models";
import { ApiService } from "../core/services/api.service";
import { LatestRequest } from "../core/services/latest-request";
import { decodePublicStatus } from "../core/services/public-status-response";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { PublicThemeToggleComponent } from "../core/public-theme-toggle.component";

@Component({
  selector: "app-public-status",
  standalone: true,
  imports: [DatePipe, RouterLink, MatButtonModule, MatIconModule, MatProgressBarModule, PublicThemeToggleComponent],
  templateUrl: "./public-status.component.html",
  styleUrl: "./public-status.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicStatusComponent implements OnInit {
  private readonly api = inject(ApiService);
  private readonly requests = new LatestRequest(inject(DestroyRef));
  readonly loading = signal(true);
  readonly snapshot = signal<PublicStatusSnapshot | null>(null);
  readonly unavailable = signal(false);
  readonly year = new Date().getFullYear();
  // Unknown is also a valid server projection, not only a transport failure.
  // A stale snapshot must never keep the page painted as currently healthy.
  readonly unknown = computed(() => {
    const snapshot = this.snapshot();
    return this.unavailable() || !snapshot || snapshot.stale
      || snapshot.overall === "unknown" || snapshot.source !== "external_monitor";
  });

  ngOnInit(): void { void this.refresh(); }

  /** Manual refresh avoids a public page becoming an unbounded polling client. */
  async refresh(): Promise<void> {
    const request = this.requests.begin("public-status");
    this.loading.set(true);
    this.unavailable.set(false);
    try {
      const snapshot = await this.api.get(
        "/api/v1/public-status",
        undefined,
        decodePublicStatus,
        { signal: request.signal },
      );
      // Cancellation saves transport work; this identity check also rejects a
      // late response that was already queued when a newer refresh began.
      if (!this.requests.isCurrent(request, "public-status")) return;
      this.snapshot.set(snapshot);
    } catch {
      if (!this.requests.isCurrent(request, "public-status")) return;
      // A failed or stale independent monitor must be shown as unknown, never
      // inferred as healthy from the fact that this page itself loaded.
      this.snapshot.set(null);
      this.unavailable.set(true);
    } finally {
      if (this.requests.isCurrent(request, "public-status")) this.loading.set(false);
    }
  }

  statusLabel(status: PublicServiceStatus): string {
    return ({ operational: "Operativo", degraded: "Rendimiento degradado", major_outage: "Interrupción importante", maintenance: "Mantenimiento", unknown: "Estado desconocido" })[status];
  }

  statusIcon(status: PublicServiceStatus): string {
    return { operational: "check", degraded: "warning_amber", major_outage: "error_outline", maintenance: "build", unknown: "help_outline" }[status];
  }

  incidentLabel(status: PublicStatusSnapshot["incidents"][number]["status"]): string {
    return { investigating: "En investigación", identified: "Causa identificada", monitoring: "En observación", resolved: "Resuelto" }[status];
  }
}
