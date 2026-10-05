import { Injectable, inject } from "@angular/core";
import type { DataExportStatus } from "../models";
import { ApiService, type ApiReadOptions } from "./api.service";
import { decodeDataExportHistoryResponse, decodeDataExportStatusResponse, decodeRequiredDataExportResponse } from "./auth-response-decoders";
import { decodePublicActionAcknowledgement } from "./public-action-response-decoders";

/** Export transport only; the auth facade and callers retain ownership policy. */
@Injectable({ providedIn: "root" })
export class AccountDataExportService {
  private readonly api = inject(ApiService);

  status(options?: ApiReadOptions): Promise<{ export: DataExportStatus | null }> {
    return this.api.get<{ export: DataExportStatus | null }>("/api/v1/auth/data-export", undefined, decodeDataExportStatusResponse, options);
  }

  history(options?: ApiReadOptions): Promise<{ exports: DataExportStatus[] }> {
    return this.api.get<{ exports: DataExportStatus[] }>("/api/v1/auth/data-export/history", undefined, decodeDataExportHistoryResponse, options);
  }

  request(password: string, factorCode?: string): Promise<{ export: DataExportStatus }> {
    return this.api.post<{ export: DataExportStatus }>("/api/v1/auth/data-export", {
      password,
      ...(factorCode ? { factorCode } : {}),
    }, decodeRequiredDataExportResponse);
  }

  download(password: string, factorCode?: string): Promise<Blob> {
    return this.api.postBlob("/api/v1/auth/data-export/download", {
      password,
      ...(factorCode ? { factorCode } : {}),
    });
  }

  acknowledge(): Promise<{ ok: true }> {
    return this.api.post("/api/v1/auth/data-export/download/acknowledge", undefined, decodePublicActionAcknowledgement);
  }

  cancel(): Promise<{ ok: true }> {
    return this.api.post("/api/v1/auth/data-export/cancel", undefined, decodePublicActionAcknowledgement);
  }
}
