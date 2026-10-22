import { PUBLIC_ROUTES, UI_LANGUAGE, type PublicRouteId } from "../core/localisation/locale";
import type { Routes } from "@angular/router";

const segments = (id: PublicRouteId): string[] =>
  [...new Set(Object.values(PUBLIC_ROUTES[id]).map(path => path.replace(/^\/legal\//, "")))];

const terms = segments("terms");
const privacy = segments("privacy");
const reportAbuse = segments("reportAbuse");

const localisedRoot = (paths: string[]): string => {
  const preferred = PUBLIC_ROUTES.terms[UI_LANGUAGE].replace(/^\/legal\//, "");
  return paths.includes(preferred) ? preferred : paths[0];
};

export const legalRoutes: Routes = [
  { path: "", pathMatch: "full", redirectTo: localisedRoot(terms) },
  ...terms.map(path => ({
    path,
    title: $localize`:@@ui.e9841ae573b767:Términos del servicio · UVH`,
    loadComponent: () => import("./terms.component").then((m) => m.TermsComponent),
  })),
  ...privacy.map(path => ({
    path,
    title: $localize`:@@ui.7afcdfe8388db7:Política de privacidad · UVH`,
    loadComponent: () => import("./privacy.component").then((m) => m.PrivacyComponent),
  })),
  ...reportAbuse.map(path => ({
    path,
    title: $localize`:@@ui.9d8506d2296219:Denunciar un enlace · UVH`,
    loadComponent: () => import("./report.component").then((m) => m.ReportComponent),
  })),
];
