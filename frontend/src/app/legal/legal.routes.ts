import { PUBLIC_ROUTES, UI_LANGUAGE, type PublicRouteId } from "../core/localisation/locale";
import type { Routes } from "@angular/router";

const segment = (id: PublicRouteId) => PUBLIC_ROUTES[id][UI_LANGUAGE].replace(/^\/legal\//, "");
const aliasesFor = (id: PublicRouteId, current: string): string[] =>
  [...new Set(Object.values(PUBLIC_ROUTES[id]).map(path => path.replace(/^\/legal\//, "")))].filter(path => path !== current);

const terms = segment("terms");
const privacy = segment("privacy");
const reportAbuse = segment("reportAbuse");

export const legalRoutes: Routes = [
  ...aliasesFor("terms", terms).map(path => ({ path, redirectTo: terms, pathMatch: "full" as const })),
  ...aliasesFor("privacy", privacy).map(path => ({ path, redirectTo: privacy, pathMatch: "full" as const })),
  ...aliasesFor("reportAbuse", reportAbuse).map(path => ({ path, redirectTo: reportAbuse, pathMatch: "full" as const })),
  { path: "", pathMatch: "full", redirectTo: terms },
  {
    path: terms,
    title: $localize`:@@ui.e9841ae573b767:Términos del servicio · UVH`,
    loadComponent: () => import("./terms.component").then((m) => m.TermsComponent),
  },
  {
    path: privacy,
    title: $localize`:@@ui.7afcdfe8388db7:Política de privacidad · UVH`,
    loadComponent: () => import("./privacy.component").then((m) => m.PrivacyComponent),
  },
  {
    path: reportAbuse,
    title: $localize`:@@ui.9d8506d2296219:Denunciar un enlace · UVH`,
    loadComponent: () => import("./report.component").then((m) => m.ReportComponent),
  },
];
