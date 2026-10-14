import { Injectable, inject, signal } from "@angular/core";
import { MatDialog } from "@angular/material/dialog";
import { ApiService } from "./api.service";
import { AuthService } from "./auth.service";
import { WorkspaceService } from "./workspace.service";
import type { AnalyticsReport, ReportLink } from "../sharing";
import { decodeReportList, decodeReportResponse } from "./sharing-decoders";
import { record } from "./response-decoder-helpers";
@Injectable({ providedIn: "root" })
export class SharingService {
  readonly api = inject(ApiService);
  private readonly auth = inject(AuthService);
  private readonly workspaces = inject(WorkspaceService);
  private readonly dialog = inject(MatDialog);
  readonly reportsEnabled = signal(false);
  readonly socialEnabled = signal(false);
  readonly context = () =>
    JSON.stringify([
      this.auth.sessionGeneration(),
      this.auth.user()?.id,
      this.workspaces.currentId(),
      this.workspaces.selectionGeneration(),
      this.workspaces.currentRole(),
    ]);
  private capabilitiesRequest?: Promise<void>;
  refreshCapabilities(): Promise<void> {
    return (this.capabilitiesRequest ??= this.api
      .get("/api/v1/config", undefined, (v) => {
        const s = record(v, "config");
        const f =
          s["sharingFeatures"] === undefined
            ? {}
            : record(s["sharingFeatures"], "sharing features");
        return {
          reports: f["sharedReports"] === true,
          social: f["socialPreviews"] === true,
        };
      })
      .then((f) => {
        this.reportsEnabled.set(f.reports);
        this.socialEnabled.set(f.social);
      })
      .catch(() => undefined));
  }
  canPublish(): boolean {
    return (
      this.reportsEnabled() &&
      this.auth.user()?.emailVerified === true &&
      ["owner", "admin"].includes(this.workspaces.currentRole() ?? "")
    );
  }
  list(page = 1, signal?: AbortSignal) {
    return this.api.get(
      "/api/v1/analytics-reports",
      { page: String(page) },
      decodeReportList,
      { signal },
    );
  }
  save(body: unknown, key: string, report?: AnalyticsReport) {
    return report
      ? this.api.patch(
          "/api/v1/analytics-reports/" + report.id,
          body,
          decodeReportResponse,
          { "Idempotency-Key": key },
        )
      : this.api.post("/api/v1/analytics-reports", body, decodeReportResponse, {
          "Idempotency-Key": key,
        });
  }
  action(
    report: AnalyticsReport,
    action: "revoke" | "rotate-access",
    key: string,
  ) {
    return this.api.post(
      `/api/v1/analytics-reports/${report.id}/${action}`,
      { version: report.version },
      decodeReportResponse,
      { "Idempotency-Key": key },
    );
  }
  private reportOpening = false;
  async open(
    initial: ReportLink[] = [],
    report?: AnalyticsReport,
  ): Promise<boolean> {
    if (this.reportOpening || !this.canPublish()) return false;
    this.reportOpening = true;
    const context = this.context();
    try {
      const { ReportDialogComponent } =
        await import("../../panel/analytics/reports/report-dialog.component");
      if (context !== this.context() || !this.canPublish()) return false;
      return await new Promise<boolean>((resolve) =>
        this.dialog
          .open(ReportDialogComponent, {
            data: { initial, report },
            width: "960px",
            maxWidth: "calc(100vw - 24px)",
            maxHeight: "calc(100dvh - 24px)",
            autoFocus: "input[name=title]",
          })
          .afterClosed()
          .subscribe((result) => resolve(result === true)),
      );
    } finally {
      this.reportOpening = false;
    }
  }
}
