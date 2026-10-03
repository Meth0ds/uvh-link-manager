import { Injectable, inject } from "@angular/core";
import type { AuthUser } from "../models";
import { ApiService } from "./api.service";
import { decodeAuthUserResponse } from "./auth-response-decoders";

/** Profile transport; the auth facade owns identity publication and transitions. */
@Injectable({ providedIn: "root" })
export class AccountProfileService {
  private readonly api = inject(ApiService);

  async updateName(name: string): Promise<AuthUser> {
    const { user } = await this.api.patch<{ user: AuthUser }>("/api/v1/auth/profile", { name }, decodeAuthUserResponse);
    return user;
  }

  async requestEmail(newEmail: string, password: string, factorCode?: string): Promise<AuthUser> {
    const { user } = await this.api.post<{ user: AuthUser }>("/api/v1/auth/change-email", {
      newEmail, password, ...(factorCode ? { factorCode } : {}),
    }, decodeAuthUserResponse);
    return user;
  }

  async cancelEmail(password: string, factorCode?: string): Promise<AuthUser> {
    const { user } = await this.api.post<{ user: AuthUser }>("/api/v1/auth/change-email/cancel", {
      password, ...(factorCode ? { factorCode } : {}),
    }, decodeAuthUserResponse);
    return user;
  }
}
