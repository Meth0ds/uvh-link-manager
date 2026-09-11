import type { Routes } from "@angular/router";

export const authRoutes: Routes = [
  { path: "", title: "Tu cuenta · UVH", loadComponent: () => import("./auth.component").then((m) => m.AuthComponent) },
  {
    path: "verify-email",
    title: "Verificar email · UVH",
    loadComponent: () => import("./verify-email.component").then((m) => m.VerifyEmailComponent),
  },
  {
    path: "confirm-email",
    title: "Confirmar nuevo email · UVH",
    loadComponent: () => import("./confirm-email-change.component").then((m) => m.ConfirmEmailChangeComponent),
  },
  {
    path: "confirm-export",
    title: "Preparar exportación · UVH",
    loadComponent: () => import("./confirm-data-export.component").then((m) => m.ConfirmDataExportComponent),
  },
  {
    path: "download-export",
    title: "Descargar tus datos · UVH",
    loadComponent: () => import("./download-data-export.component").then((m) => m.DownloadDataExportComponent),
  },
  {
    path: "confirm-account-deletion",
    title: "Confirmar eliminación · UVH",
    loadComponent: () => import("./confirm-account-deletion.component").then((m) => m.ConfirmAccountDeletionComponent),
  },
  {
    path: "cancel-account-deletion",
    title: "Conservar tu cuenta · UVH",
    loadComponent: () => import("./cancel-account-deletion.component").then((m) => m.CancelAccountDeletionComponent),
  },
  {
    path: "forgot-password",
    title: "Recuperar contraseña · UVH",
    loadComponent: () => import("./forgot-password.component").then((m) => m.ForgotPasswordComponent),
  },
  {
    path: "reset-password",
    title: "Nueva contraseña · UVH",
    loadComponent: () => import("./reset-password.component").then((m) => m.ResetPasswordComponent),
  },
  {
    path: "security-incident",
    title: "Proteger tu cuenta · UVH",
    loadComponent: () => import("./security-incident.component").then((m) => m.SecurityIncidentComponent),
  },
  {
    path: "account-recovery",
    title: "Recuperación reforzada · UVH",
    loadComponent: () => import("./account-recovery-request.component").then((m) => m.AccountRecoveryRequestComponent),
  },
  {
    path: "account-recovery/confirm",
    title: "Confirmar recuperación · UVH",
    loadComponent: () => import("./account-recovery-confirm.component").then((m) => m.AccountRecoveryConfirmComponent),
  },
  {
    path: "account-recovery/complete",
    title: "Finalizar recuperación · UVH",
    loadComponent: () => import("./account-recovery-complete.component").then((m) => m.AccountRecoveryCompleteComponent),
  },
  {
    path: "reauthenticate",
    title: "Verificación para administración · UVH",
    loadComponent: () => import("./mfa-reauthenticate.component").then((m) => m.MfaReauthenticateComponent),
  },
  {
    path: "invitations/accept",
    title: "Revisar invitación · UVH",
    loadComponent: () => import("./invitation-accept.component").then((m) => m.InvitationAcceptComponent),
  },
];
