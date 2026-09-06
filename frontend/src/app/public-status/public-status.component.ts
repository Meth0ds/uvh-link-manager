import { DatePipe } from "@angular/common";
import { ChangeDetectionStrategy, Component, OnInit, inject, signal } from "@angular/core";
import { RouterLink } from "@angular/router";
import type { PublicServiceStatus, PublicStatusSnapshot } from "../core/models";
import { ApiService } from "../core/services/api.service";
import { decodePublicStatus } from "../core/services/public-status-response";

@Component({
  selector: "app-public-status",
  standalone: true,
  imports: [DatePipe, RouterLink],
  templateUrl: "./public-status.component.html",
  styleUrl: "./public-status.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class PublicStatusComponent implements OnInit {
  private readonly api = inject(ApiService);
  readonly loading = signal(true);
  readonly snapshot = signal<PublicStatusSnapshot | null>(null);
  readonly unavailable = signal(false);
  readonly year = new Date().getFullYear();

  ngOnInit(): void { void this.refresh(); }

  /** Manual refresh avoids a public page becoming an unbounded polling client. */
  async refresh(): Promise<void> {
    this.loading.set(true);
    this.unavailable.set(false);
    try {
      this.snapshot.set(await this.api.get("/api/v1/public-status", undefined, decodePublicStatus));
    } catch {
      // A failed or stale independent monitor must be shown as unknown, never
      // inferred as healthy from the fact that this page itself loaded.
      this.snapshot.set(null);
      this.unavailable.set(true);
    } finally {
      this.loading.set(false);
    }
  }

  statusLabel(status: PublicServiceStatus): string {
    return ({ operational: "Operativo", degraded: "Rendimiento degradado", major_outage: "Interrupción importante", maintenance: "Mantenimiento", unknown: "Estado desconocido" })[status];
  }
}
