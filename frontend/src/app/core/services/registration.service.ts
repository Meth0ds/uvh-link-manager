import { Injectable, inject } from "@angular/core";
import { ApiService } from "./api.service";
import { decodeRegistrationResponse } from "./auth-response-decoders";
import { decodePublicActionAcknowledgement } from "./public-action-response-decoders";

/** Sessionless registration transport; edit authority remains in the server cookie. */
@Injectable({ providedIn: "root" })
export class RegistrationService {
  private readonly api = inject(ApiService);

  async register(
    name: string,
    email: string,
    password: string,
    antiBot: {
      captchaToken: string;
      website?: string;
      acceptTerms: boolean;
      termsVersion: string;
      privacyVersion: string;
    },
  ): Promise<void> {
    await this.api.post<{ user: null }>("/api/v1/auth/register", {
      name,
      email,
      password,
      ...antiBot,
    }, decodeRegistrationResponse);
  }

  async resendVerification(email: string | undefined, captchaToken: string): Promise<void> {
    await this.api.post("/api/v1/auth/resend-verification", { email, captchaToken }, decodePublicActionAcknowledgement);
  }

  async changeRegistrationEmail(
    currentEmail: string,
    newEmail: string,
    antiBot: { captchaToken: string; website?: string },
  ): Promise<void> {
    await this.api.post<{ ok: true }>("/api/v1/auth/change-registration-email", {
      currentEmail,
      newEmail,
      ...antiBot,
    }, decodePublicActionAcknowledgement);
  }
}
