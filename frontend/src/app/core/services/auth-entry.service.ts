import { Injectable, inject } from "@angular/core";
import { ApiService } from "./api.service";
import {
  decodeLoginOutcome,
  decodeLoginResponse,
  decodeMfaReauthentication,
  decodeMfaSessionStatus,
} from "./auth-response-decoders";
import type { LoginOutcome, LoginResponse, MfaSessionStatus } from "./auth-session-contracts";
import { decodePublicActionAcknowledgement } from "./public-action-response-decoders";

/** Entry and step-up transport; AuthService owns identity and transition guards. */
@Injectable({ providedIn: "root" })
export class AuthEntryService {
  private readonly api = inject(ApiService);

  login(email: string, password: string, captchaToken: string): Promise<LoginOutcome> {
    return this.api.post<LoginOutcome>("/api/v1/auth/login", { email, password, captchaToken }, decodeLoginOutcome);
  }

  verifyMfa(challenge: string, code: string): Promise<LoginResponse> {
    return this.api.post<LoginResponse>("/api/v1/auth/mfa/verify", { challenge, code }, decodeLoginResponse);
  }

  recoverMfa(challenge: string, code: string): Promise<LoginResponse> {
    return this.api.post<LoginResponse>("/api/v1/auth/mfa/recovery", { challenge, code }, decodeLoginResponse);
  }

  logout(): Promise<{ ok: true }> {
    return this.api.post("/api/v1/auth/logout", undefined, decodePublicActionAcknowledgement);
  }

  mfaSessionStatus(): Promise<MfaSessionStatus> {
    return this.api.get<MfaSessionStatus>("/api/v1/auth/mfa/session", undefined, decodeMfaSessionStatus);
  }

  reauthenticateMfa(password: string, factorCode: string): Promise<{ ok: true; verifiedAt: string; expiresAt: string }> {
    return this.api.post<{ ok: true; verifiedAt: string; expiresAt: string }>(
      "/api/v1/auth/mfa/reauthenticate",
      { password, factorCode },
      decodeMfaReauthentication,
    );
  }
}
