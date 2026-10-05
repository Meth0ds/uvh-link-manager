import { Injectable, inject } from "@angular/core";
import type { SessionList } from "../models";
import { ApiService, type ApiReadOptions } from "./api.service";
import { decodeSessionRevocation, decodeSessionsBulkRevocation, decodeSessionsResponse } from "./auth-response-decoders";

/** Session transport only; the auth facade owns identity and invalidation policy. */
@Injectable({ providedIn: "root" })
export class AccountSessionsService {
  private readonly api = inject(ApiService);

  list(options?: ApiReadOptions): Promise<SessionList> {
    return this.api.get<SessionList>("/api/v1/auth/sessions", undefined, decodeSessionsResponse, options);
  }

  revoke(id: string): Promise<{ ok: true; current?: boolean }> {
    return this.api.post<{ ok: true; current?: boolean }>(
      `/api/v1/auth/sessions/${encodeURIComponent(id)}/revoke`, undefined, decodeSessionRevocation,
    );
  }

  revokeOthers(): Promise<{ ok: true; revoked: number }> {
    return this.api.post<{ ok: true; revoked: number }>("/api/v1/auth/sessions/revoke-others", undefined, decodeSessionsBulkRevocation);
  }

  revokeAll(): Promise<{ ok: true; revoked: number }> {
    return this.api.post<{ ok: true; revoked: number }>("/api/v1/auth/sessions/revoke-all", undefined, decodeSessionsBulkRevocation);
  }
}
