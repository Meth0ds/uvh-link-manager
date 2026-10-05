import { Injectable, inject } from "@angular/core";
import type { AccountDeletionImpact } from "../models";
import { ApiService, type ApiReadOptions } from "./api.service";
import { decodeAccountDeletionImpact, decodeAccountDeletionRequest } from "./auth-response-decoders";

/** Deletion transport only; auth and callers retain identity and dialog policy. */
@Injectable({ providedIn: "root" })
export class AccountDeletionService {
  private readonly api = inject(ApiService);

  impact(options?: ApiReadOptions): Promise<AccountDeletionImpact> {
    return this.api.get<AccountDeletionImpact>("/api/v1/auth/account-deletion", undefined, decodeAccountDeletionImpact, options);
  }

  request(password: string, confirmation: string, factorCode?: string): Promise<{ status: "requested"; confirmationExpiresAt: string }> {
    return this.api.post<{ status: "requested"; confirmationExpiresAt: string }>("/api/v1/auth/account-deletion", {
      password,
      confirmation,
      ...(factorCode ? { factorCode } : {}),
    }, decodeAccountDeletionRequest);
  }
}
