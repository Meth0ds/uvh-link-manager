import { ApplicationConfig, APP_INITIALIZER, inject } from "@angular/core";
import { provideRouter, withComponentInputBinding, withViewTransitions, type Routes } from "@angular/router";
import { provideHttpClient, withFetch } from "@angular/common/http";
import { provideAnimationsAsync } from "@angular/platform-browser/animations/async";
import { AuthService } from "./core/services/auth.service";

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
    path: "app",
    loadChildren: () => import("./panel/panel.routes").then((m) => m.panelRoutes),
  },
  {
    path: "**",
    redirectTo: "",
  },
];

export const appConfig: ApplicationConfig = {
  providers: [
    provideRouter(routes, withComponentInputBinding(), withViewTransitions()),
    provideHttpClient(withFetch()),
    provideAnimationsAsync(),
    {
      provide: APP_INITIALIZER,
      useFactory: () => {
        const auth = inject(AuthService);
        return () => auth.init();
      },
      multi: true,
    },
  ],
};
