import type { Routes } from "@angular/router";

export const legalRoutes: Routes = [
  { path: "", pathMatch: "full", redirectTo: "terminos" },
  {
    path: "terminos",
    loadComponent: () => import("./terms.component").then((m) => m.TermsComponent),
  },
  {
    path: "privacidad",
    loadComponent: () => import("./privacy.component").then((m) => m.PrivacyComponent),
  },
  {
    path: "denuncias",
    loadComponent: () => import("./report.component").then((m) => m.ReportComponent),
  },
];
