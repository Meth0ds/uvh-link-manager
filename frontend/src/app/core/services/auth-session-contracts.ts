import type { AuthUser } from "../models";

export interface LoginResponse {
  mfaRequired?: false;
  user: AuthUser;
}
export interface MfaRequiredResponse {
  mfaRequired: true;
  challenge: string;
  recoveryAvailable: boolean;
}
export type LoginOutcome = LoginResponse | MfaRequiredResponse;

export interface MfaSessionStatus {
  enabled: boolean;
  fresh: boolean;
  verifiedAt: string | null;
  expiresAt: string | null;
}
