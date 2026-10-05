import { Injectable, inject } from "@angular/core";
import { ApiService } from "./api.service";
import { decodeMfaAcknowledgement, decodeMfaSetup, decodeRecoveryCodes } from "./auth-response-decoders";

/** Configuration transport only; login, identity and step-up policy stay with auth. */
@Injectable({ providedIn: "root" })
export class AccountMfaService {
  private readonly api = inject(ApiService);

  setup(password: string, code?: string): Promise<{ secret: string; uri: string }> {
    return this.api.post("/api/v1/auth/mfa/setup", { password, code }, decodeMfaSetup);
  }

  enable(code: string): Promise<{ recoveryCodes: string[] }> {
    return this.api.post("/api/v1/auth/mfa/enable", { code }, decodeRecoveryCodes);
  }

  async cancelSetup(): Promise<void> {
    await this.api.post("/api/v1/auth/mfa/cancel-setup", undefined, decodeMfaAcknowledgement);
  }

  regenerate(password: string, factorCode: string): Promise<{ recoveryCodes: string[] }> {
    return this.api.post("/api/v1/auth/mfa/recovery-codes/regenerate", { password, factorCode }, decodeRecoveryCodes);
  }

  async disable(password: string, code: string): Promise<void> {
    await this.api.post("/api/v1/auth/mfa/disable", { password, code }, decodeMfaAcknowledgement);
  }
}
