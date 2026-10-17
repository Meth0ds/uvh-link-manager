import { RenderMode, type ServerRoute } from "@angular/ssr";
import { PUBLIC_ROUTES, UI_LANGUAGE } from "./core/localisation/locale";
export const serverRoutes: ServerRoute[] = [
  ...Object.values(PUBLIC_ROUTES).map<ServerRoute>(route => ({path: route[UI_LANGUAGE].replace(/^\//,""), renderMode: RenderMode.Prerender})),
  {path: "**", renderMode: RenderMode.Client},
];
