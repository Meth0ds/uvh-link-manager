import { ApplicationConfig, inject, provideAppInitializer } from "@angular/core";
import { provideRouter, withComponentInputBinding, withInMemoryScrolling, type RouterFeatures, type Routes } from "@angular/router";
import { provideHttpClient, withFetch, withInterceptors } from "@angular/common/http";
import { provideAnimationsAsync } from "@angular/platform-browser/animations/async";
import { MatPaginatorIntl } from "@angular/material/paginator";
import { apiInterceptor } from "./core/interceptors/api.interceptor";
import { SpanishPaginatorIntl } from "./core/paginator-intl";
import { PendingHandoffService } from "./core/services/pending-handoff.service";

export const routes: Routes = [
  {
    path: "",
    title: "UVH · Enlaces con recorrido",
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
    title: "Ayuda técnica · UVH",
    loadComponent: () => import("./help/help.component").then((m) => m.HelpComponent),
  },
  {
    path: "status",
    title: "Estado del servicio · UVH",
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
    title: "403 · Acceso restringido · UVH",
    data: { kind: "forbidden" },
    loadComponent: () => import("./status-page.component").then((m) => m.StatusPageComponent),
  },
  {
    path: "not-found",
    title: "404 · Página no encontrada · UVH",
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

/**
 * Router features, exported so navigation policy is one readable list that a
 * test can exercise without booting the application shell.
 *
 * Deliberately absent: `withViewTransitions`. Navigation is not a view
 * transition owner in this application. A browser that exposes
 * `startViewTransition` can still skip every transition — a frame that is not
 * being composited (an occluded or offscreen window), a hidden tab, reduced
 * motion, two navigations in flight — and it reports the skip by rejecting
 * `ViewTransition.ready` with `InvalidStateError`. Angular's helper attaches its
 * own `.catch(console.error)` to all three transition promises in development
 * and offers no hook to treat that skip as the normal outcome it is, so every
 * route change left an error in the console with no application defect behind
 * it. The designed transition is the theme change, which owns its snapshot in
 * `PublicThemeTransitionService` and already swallows those rejections itself.
 */
export const routerFeatures: RouterFeatures[] = [
  withComponentInputBinding(),
  withInMemoryScrolling({ scrollPositionRestoration: "enabled", anchorScrolling: "enabled" }),
];

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, ...routerFeatures),
    provideHttpClient(withFetch(), withInterceptors([apiInterceptor])),
    provideAnimationsAsync(),
    // Material ships the paginator in English; the panel is in Spanish, so its
    // labels are replaced once instead of per screen.
    { provide: MatPaginatorIntl, useClass: SpanishPaginatorIntl },
    // Ask which handoffs this browser is holding, once, before the first route
    // renders. The promise is deliberately not returned: a slow or unreachable
    // answer must not delay the first paint, and a screen that has not heard
    // back yet shows the neutral option (no pending handoff) instead of a CTA
    // that may not work.
    provideAppInitializer(() => {
      void inject(PendingHandoffService).refresh();
    }),
  ],
};
