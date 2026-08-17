import type { Routes } from "@angular/router";

export const authRoutes: Routes = [
  { path: "", loadComponent: () => import("./auth.component").then((m) => m.AuthComponent) },
  {
    path: "verify-email",
    loadComponent: () => import("./verify-email.component").then((m) => m.VerifyEmailComponent),
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
    path: "invitations/accept",
    loadComponent: () => import("./invitation-accept.component").then((m) => m.InvitationAcceptComponent),
  },
];
