import { ApplicationConfig } from "@angular/core";
import { provideRouter, withComponentInputBinding, withInMemoryScrolling, withViewTransitions, type Routes } from "@angular/router";
import { provideHttpClient, withFetch, withInterceptors } from "@angular/common/http";
import { provideAnimationsAsync } from "@angular/platform-browser/animations/async";
import { apiInterceptor } from "./core/interceptors/api.interceptor";

export const routes: Routes = [
  {
    path: "",
    loadComponent: () => import("./landing/landing.component").then((m) => m.LandingComponent),
  },
  {
    path: "auth",
    loadChildren: () => import("./auth/auth.routes").then((m) => m.authRoutes),
  },
  {
    path: "legal",
    loadChildren: () => import("./legal/legal.routes").then((m) => m.legalRoutes),
  },
  {
    path: "help",
    loadComponent: () => import("./help/help.component").then((m) => m.HelpComponent),
  },
  {
    path: "status",
    loadComponent: () => import("./public-status/public-status.component").then((m) => m.PublicStatusComponent),
  },
  {
    // Canonical invitation URL used by email links. Keep the legacy root alias
    // so invitations already delivered before the cutover remain valid.
    path: "invitations/accept",
    loadComponent: () => import("./auth/invitation-accept.component").then((m) => m.InvitationAcceptComponent),
  },
  {
    path: "forbidden",
    data: { kind: "forbidden" },
    loadComponent: () => import("./status-page.component").then((m) => m.StatusPageComponent),
  },
  {
    path: "not-found",
    data: { kind: "not-found" },
    loadComponent: () => import("./status-page.component").then((m) => m.StatusPageComponent),
  },
  {
    path: "app",
    loadChildren: () => import("./panel/panel.routes").then((m) => m.panelRoutes),
  },
  {
    path: "**",
    redirectTo: "not-found",
  },
];

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(
      routes,
      withComponentInputBinding(),
      withInMemoryScrolling({ scrollPositionRestoration: "enabled", anchorScrolling: "enabled" }),
      // The first route must paint immediately.  Applying a document view
      // transition to initial navigation can leave a blank snapshot visible
      // while lazy chunks and the session probe are still resolving.
      withViewTransitions({ skipInitialTransition: true }),
    ),
    provideHttpClient(withFetch(), withInterceptors([apiInterceptor])),
    provideAnimationsAsync(),
  ],
};
