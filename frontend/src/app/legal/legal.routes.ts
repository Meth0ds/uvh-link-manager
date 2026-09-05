import type { Routes } from "@angular/router";

export const legalRoutes: Routes = [
  { path: "", pathMatch: "full", redirectTo: "terminos" },
  {
    path: "terminos",
    title: "Términos del servicio · UVH",
    loadComponent: () => import("./terms.component").then((m) => m.TermsComponent),
  },
  {
    path: "privacidad",
    title: "Política de privacidad · UVH",
    loadComponent: () => import("./privacy.component").then((m) => m.PrivacyComponent),
  },
  {
    path: "denuncias",
    title: "Denunciar un enlace · UVH",
    loadComponent: () => import("./report.component").then((m) => m.ReportComponent),
  },
];
