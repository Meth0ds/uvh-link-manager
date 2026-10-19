import { LocaleUrlSerializer } from "./core/localisation/locale-url-serializer";
import "./core/localisation/locale-data";
import { PublicSeoService } from "./core/localisation/public-seo.service";
import { UI_LANGUAGE, UI_LOCALE, PUBLIC_ROUTES } from "./core/localisation/locale";
import { SharingService } from "./core/services/sharing.service";
import { isPlatformBrowser } from "@angular/common";
import { ApplicationConfig, LOCALE_ID, inject, PLATFORM_ID, provideAppInitializer } from "@angular/core";
import { provideRouter, UrlSerializer, RouteReuseStrategy, withComponentInputBinding, withInMemoryScrolling, type RouterFeatures, type Routes } from "@angular/router";
import { provideHttpClient, withFetch, withInterceptors } from "@angular/common/http";
import { provideAnimationsAsync } from "@angular/platform-browser/animations/async";
import { apiInterceptor } from "./core/interceptors/api.interceptor";
import { PendingHandoffService } from "./core/services/pending-handoff.service";
import { AuthRouteReuseStrategy } from "./core/auth-route-reuse";

export const routes: Routes = [
  ...(UI_LANGUAGE === "es" ? [{ path: "help", redirectTo: "ayuda", pathMatch: "full" as const }, { path: "status", redirectTo: "estado", pathMatch: "full" as const }] : []),
  { path: "reports/:publicId", title: $localize`:@@ui.a901db2fb4198d:Informe compartido · UVH`, loadComponent: () => import("./public-report/public-report.component").then(m => m.PublicReportComponent) },
  {
    path: "",
    title: $localize`:@@ui.965c2fdd1a3422:UVH · Acorta y gestiona tus enlaces`,
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
    path: PUBLIC_ROUTES.help[UI_LANGUAGE].slice(1),
    title: $localize`:@@ui.7dfc1cd4408199:Ayuda técnica · UVH`,
    loadComponent: () => import("./help/help.component").then((m) => m.HelpComponent),
  },
  {
    path: PUBLIC_ROUTES.status[UI_LANGUAGE].slice(1),
    title: $localize`:@@ui.71de223b0148f2:Estado del servicio · UVH`,
    loadComponent: () => import("./public-status/public-status.component").then((m) => m.PublicStatusComponent),
  },
  {
    // Canonical invitation URL used by email links. Keep the legacy root alias
    // so invitations already delivered before the cutover remain valid.
    path: "invitations/accept",
    data: { renewAuthContext: true },
    loadComponent: () => import("./auth/invitation-accept.component").then((m) => m.InvitationAcceptComponent),
  },
  {
    path: "forbidden",
    title: $localize`:@@ui.cd27bea26135a1:403 · Acceso restringido · UVH`,
    data: { kind: "forbidden" },
    loadComponent: () => import("./status-page.component").then((m) => m.StatusPageComponent),
  },
  {
    path: "not-found",
    title: $localize`:@@ui.fd4b8d18f72051:404 · Página no encontrada · UVH`,
    data: { kind: "not-found" },
    loadComponent: () => import("./not-found.component").then((m) => m.NotFoundComponent),
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
    { provide: LOCALE_ID, useValue: UI_LOCALE },
    { provide: UrlSerializer, useClass: LocaleUrlSerializer },
    provideAppInitializer(() => { inject(PublicSeoService); }),
    provideRouter(routes, ...routerFeatures),
    { provide: RouteReuseStrategy, useClass: AuthRouteReuseStrategy },
    provideHttpClient(withFetch(), withInterceptors([apiInterceptor])),
    provideAnimationsAsync(),
    // Ask which handoffs this browser is holding, once, before the first route
    // renders. The promise is deliberately not returned: a slow or unreachable
    // answer must not delay the first paint, and a screen that has not heard
    // back yet shows the neutral option (no pending handoff) instead of a CTA
    // that may not work.
    provideAppInitializer(() => { if (isPlatformBrowser(inject(PLATFORM_ID))) void inject(SharingService).refreshCapabilities(); }),
    provideAppInitializer(() => {
      if (isPlatformBrowser(inject(PLATFORM_ID))) void inject(PendingHandoffService).refresh();
    }),
  ],
};
