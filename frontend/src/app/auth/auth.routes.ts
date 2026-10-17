import type { Routes } from "@angular/router";

export const authRoutes: Routes = [
  { path: "login", pathMatch: "full", redirectTo: "" },
  { path: "", title: $localize`:@@ui.40aae9bb4a4805:Tu cuenta · UVH`, data: { renewAuthContext: true }, loadComponent: () => import("./auth.component").then((m) => m.AuthComponent) },
  {
    path: "verify-email",
    data: { renewAuthContext: true },
    title: $localize`:@@ui.72098ddc75eb9b:Verificar email · UVH`,
    loadComponent: () => import("./verify-email.component").then((m) => m.VerifyEmailComponent),
  },
  {
    path: "confirm-email",
    data: { renewAuthContext: true },
    title: $localize`:@@ui.c17fd14391ba94:Confirmar nuevo email · UVH`,
    loadComponent: () => import("./confirm-email-change.component").then((m) => m.ConfirmEmailChangeComponent),
  },
  {
    path: "confirm-account-deletion",
    data: { renewAuthContext: true },
    title: $localize`:@@ui.ba828563fcf880:Confirmar eliminación · UVH`,
    loadComponent: () => import("./confirm-account-deletion.component").then((m) => m.ConfirmAccountDeletionComponent),
  },
  {
    path: "cancel-account-deletion",
    data: { renewAuthContext: true },
    title: $localize`:@@ui.9ee6209ce21f50:Conservar tu cuenta · UVH`,
    loadComponent: () => import("./cancel-account-deletion.component").then((m) => m.CancelAccountDeletionComponent),
  },
  {
    path: "forgot-password",
    title: $localize`:@@ui.ae8c95fba787e3:Recuperar contraseña · UVH`,
    loadComponent: () => import("./forgot-password.component").then((m) => m.ForgotPasswordComponent),
  },
  {
    path: "reset-password",
    data: { renewAuthContext: true },
    title: $localize`:@@ui.e55a1cf26594c1:Nueva contraseña · UVH`,
    loadComponent: () => import("./reset-password.component").then((m) => m.ResetPasswordComponent),
  },
  {
    path: "security-incident",
    data: { renewAuthContext: true },
    title: $localize`:@@ui.8b23fca4eff21d:Proteger tu cuenta · UVH`,
    loadComponent: () => import("./security-incident.component").then((m) => m.SecurityIncidentComponent),
  },
  {
    path: "account-recovery",
    title: $localize`:@@ui.e99c06cecc780a:Recuperación reforzada · UVH`,
    loadComponent: () => import("./account-recovery-request.component").then((m) => m.AccountRecoveryRequestComponent),
  },
  {
    path: "account-recovery/confirm",
    data: { renewAuthContext: true },
    title: $localize`:@@ui.27f6f5c05d1d63:Confirmar recuperación · UVH`,
    loadComponent: () => import("./account-recovery-confirm.component").then((m) => m.AccountRecoveryConfirmComponent),
  },
  {
    path: "account-recovery/complete",
    data: { renewAuthContext: true },
    title: $localize`:@@ui.b772c79228be14:Finalizar recuperación · UVH`,
    loadComponent: () => import("./account-recovery-complete.component").then((m) => m.AccountRecoveryCompleteComponent),
  },
  {
    path: "reauthenticate",
    data: { renewAuthContext: true },
    title: $localize`:@@ui.21983f5a3ebd27:Verificación de identidad · UVH`,
    loadComponent: () => import("./mfa-reauthenticate.component").then((m) => m.MfaReauthenticateComponent),
  },
  {
    path: "invitations/accept",
    data: { renewAuthContext: true },
    title: $localize`:@@ui.d1be9b396a5b1b:Revisar invitación · UVH`,
    loadComponent: () => import("./invitation-accept.component").then((m) => m.InvitationAcceptComponent),
  },
];
