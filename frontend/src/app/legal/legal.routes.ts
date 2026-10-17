import { UI_LANGUAGE } from "../core/localisation/locale";
import type { Routes } from "@angular/router";

export const legalRoutes: Routes = [
  ...(UI_LANGUAGE === "en" ? [{ path: "terminos", redirectTo: "terms", pathMatch: "full" as const }, { path: "privacidad", redirectTo: "privacy", pathMatch: "full" as const }, { path: "denuncias", redirectTo: "report-abuse", pathMatch: "full" as const }] : []),
  { path: "", pathMatch: "full", redirectTo: UI_LANGUAGE === "en" ? "terms" : "terminos" },
  {
    path: UI_LANGUAGE === "en" ? "terms" : "terminos",
    title: $localize`:@@ui.e9841ae573b767:Términos del servicio · UVH`,
    loadComponent: () => import("./terms.component").then((m) => m.TermsComponent),
  },
  {
    path: UI_LANGUAGE === "en" ? "privacy" : "privacidad",
    title: $localize`:@@ui.7afcdfe8388db7:Política de privacidad · UVH`,
    loadComponent: () => import("./privacy.component").then((m) => m.PrivacyComponent),
  },
  {
    path: UI_LANGUAGE === "en" ? "report-abuse" : "denuncias",
    title: $localize`:@@ui.9d8506d2296219:Denunciar un enlace · UVH`,
    loadComponent: () => import("./report.component").then((m) => m.ReportComponent),
  },
];
