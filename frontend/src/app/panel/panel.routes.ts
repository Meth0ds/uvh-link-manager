import type { Routes } from "@angular/router";
import { authGuard, adminGuard } from "../core/guards/auth.guard";

export const panelRoutes: Routes = [
  {
    path: "",
    canActivate: [authGuard],
    loadComponent: () => import("./panel.component").then((m) => m.PanelComponent),
    children: [
      { path: "", pathMatch: "full", redirectTo: "dashboard" },
      {
        path: "dashboard",
        loadComponent: () => import("./dashboard/dashboard.component").then((m) => m.DashboardComponent),
      },
      {
        path: "links",
        loadComponent: () => import("./links/links.component").then((m) => m.LinksComponent),
      },
      {
        path: "links/:id",
        loadComponent: () => import("./links/link-detail.component").then((m) => m.LinkDetailComponent),
      },
      {
        path: "analytics",
        loadComponent: () => import("./analytics/analytics.component").then((m) => m.AnalyticsComponent),
      },
      {
        path: "domains",
        loadComponent: () => import("./domains/domains.component").then((m) => m.DomainsComponent),
      },
      {
        path: "tokens",
        loadComponent: () => import("./tokens/tokens.component").then((m) => m.TokensComponent),
      },
      {
        path: "webhooks",
        loadComponent: () => import("./webhooks/webhooks.component").then((m) => m.WebhooksComponent),
      },
      {
        path: "team",
        loadComponent: () => import("./team/team.component").then((m) => m.TeamComponent),
      },
      {
        path: "settings",
        loadComponent: () => import("./settings/settings.component").then((m) => m.SettingsComponent),
      },
      {
        path: "admin",
        canActivate: [adminGuard],
        loadComponent: () => import("./admin/admin.component").then((m) => m.AdminComponent),
      },
    ],
  },
];
