export type RegisterStep = 1 | 2;

/** Display context only: the server still validates its signed edit cookie. */
export type VerificationSource = "browser-registration" | "unverified-account" | "recovery";

/** Each screen keeps only its own context; MFA methods share one challenge. */
export type AuthFlowState =
  | { readonly kind: "login" }
  | { readonly kind: "register"; readonly stage: RegisterStep; readonly mode: "new" }
  | {
    readonly kind: "register";
    readonly stage: RegisterStep;
    readonly mode: "correct-email";
    readonly originalEmail: string;
  }
  | { readonly kind: "verify-pending"; readonly email: string; readonly source: VerificationSource }
  | {
    readonly kind: "mfa" | "recovery";
    readonly challenge: string;
    readonly recoveryAvailable: boolean;
  };
