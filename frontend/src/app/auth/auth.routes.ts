import type { Routes } from "@angular/router";

export const authRoutes: Routes = [
  { path: "", title: "Tu cuenta · UVH", data: { renewAuthContext: true }, loadComponent: () => import("./auth.component").then((m) => m.AuthComponent) },
  {
    path: "verify-email",
    data: { renewAuthContext: true },
    title: "Verificar email · UVH",
    loadComponent: () => import("./verify-email.component").then((m) => m.VerifyEmailComponent),
  },
  {
    path: "confirm-email",
    data: { renewAuthContext: true },
    title: "Confirmar nuevo email · UVH",
    loadComponent: () => import("./confirm-email-change.component").then((m) => m.ConfirmEmailChangeComponent),
  },
  {
    path: "confirm-account-deletion",
    data: { renewAuthContext: true },
    title: "Confirmar eliminación · UVH",
    loadComponent: () => import("./confirm-account-deletion.component").then((m) => m.ConfirmAccountDeletionComponent),
  },
  {
    path: "cancel-account-deletion",
    data: { renewAuthContext: true },
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
    data: { renewAuthContext: true },
    title: "Nueva contraseña · UVH",
    loadComponent: () => import("./reset-password.component").then((m) => m.ResetPasswordComponent),
  },
  {
    path: "security-incident",
    data: { renewAuthContext: true },
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
    data: { renewAuthContext: true },
    title: "Confirmar recuperación · UVH",
    loadComponent: () => import("./account-recovery-confirm.component").then((m) => m.AccountRecoveryConfirmComponent),
  },
  {
    path: "account-recovery/complete",
    data: { renewAuthContext: true },
    title: "Finalizar recuperación · UVH",
    loadComponent: () => import("./account-recovery-complete.component").then((m) => m.AccountRecoveryCompleteComponent),
  },
  {
    path: "reauthenticate",
    data: { renewAuthContext: true },
    title: "Verificación de identidad · UVH",
    loadComponent: () => import("./mfa-reauthenticate.component").then((m) => m.MfaReauthenticateComponent),
  },
  {
    path: "invitations/accept",
    data: { renewAuthContext: true },
    title: "Revisar invitación · UVH",
    loadComponent: () => import("./invitation-accept.component").then((m) => m.InvitationAcceptComponent),
  },
];
