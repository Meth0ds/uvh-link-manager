import type { Routes } from "@angular/router";

export const authRoutes: Routes = [
  { path: "", loadComponent: () => import("./auth.component").then((m) => m.AuthComponent) },
  {
    path: "verify-email",
    loadComponent: () => import("./verify-email.component").then((m) => m.VerifyEmailComponent),
  },
  {
    path: "confirm-email",
    loadComponent: () => import("./confirm-email-change.component").then((m) => m.ConfirmEmailChangeComponent),
  },
  {
    path: "confirm-export",
    loadComponent: () => import("./confirm-data-export.component").then((m) => m.ConfirmDataExportComponent),
  },
  {
    path: "download-export",
    loadComponent: () => import("./download-data-export.component").then((m) => m.DownloadDataExportComponent),
  },
  {
    path: "confirm-account-deletion",
    loadComponent: () => import("./confirm-account-deletion.component").then((m) => m.ConfirmAccountDeletionComponent),
  },
  {
    path: "cancel-account-deletion",
    loadComponent: () => import("./cancel-account-deletion.component").then((m) => m.CancelAccountDeletionComponent),
  },
  {
    path: "forgot-password",
    loadComponent: () => import("./forgot-password.component").then((m) => m.ForgotPasswordComponent),
  },
  {
    path: "reset-password",
    loadComponent: () => import("./reset-password.component").then((m) => m.ResetPasswordComponent),
  },
  {
    path: "security-incident",
    loadComponent: () => import("./security-incident.component").then((m) => m.SecurityIncidentComponent),
  },
  {
    path: "account-recovery",
    loadComponent: () => import("./account-recovery-request.component").then((m) => m.AccountRecoveryRequestComponent),
  },
  {
    path: "account-recovery/confirm",
    loadComponent: () => import("./account-recovery-confirm.component").then((m) => m.AccountRecoveryConfirmComponent),
  },
  {
    path: "account-recovery/complete",
    loadComponent: () => import("./account-recovery-complete.component").then((m) => m.AccountRecoveryCompleteComponent),
  },
  {
    path: "reauthenticate",
    loadComponent: () => import("./mfa-reauthenticate.component").then((m) => m.MfaReauthenticateComponent),
  },
  {
    path: "invitations/accept",
    loadComponent: () => import("./invitation-accept.component").then((m) => m.InvitationAcceptComponent),
  },
];
