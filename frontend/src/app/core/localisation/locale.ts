import manifest from "../../../../../shared/localisation/routes.json";

export type AppLanguage = "es" | "en";
const COMPILED_LOCALE = (typeof $localize !== "undefined" && $localize.locale) || "es";
export const UI_LOCALE = COMPILED_LOCALE.toLowerCase().startsWith("en") ? "en-GB" : "es-ES";
export const UI_LANGUAGE: AppLanguage = UI_LOCALE.toLowerCase().startsWith("en") ? "en" : "es";
export const PUBLIC_ROUTES = manifest;
export type PublicRouteId = keyof typeof PUBLIC_ROUTES;
const LEGACY_PUBLIC: Record<string, PublicRouteId> = {
  "/": "home", "/help": "help", "/ayuda": "help", "/status": "status", "/estado": "status",
  "/legal": "terms", "/legal/terminos": "terms", "/legal/terms": "terms",
  "/legal/privacidad": "privacy", "/legal/privacy": "privacy",
  "/legal/denuncias": "reportAbuse", "/legal/report-abuse": "reportAbuse",
};
export function isAppLanguage(value: unknown): value is AppLanguage { return value === "es" || value === "en"; }
export function routePath(path: string, language: AppLanguage = UI_LANGUAGE): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  const stripped = path.replace(/^\/(?:es|en)(?=\/|$)/, "") || "/";
  const match = /^([^?#]*)([?#].*)?$/.exec(stripped)!;
  const id = LEGACY_PUBLIC[match[1].replace(/\/$/, "") || "/"];
  return (id ? PUBLIC_ROUTES[id][language] : match[1]) + (match[2] ?? "");
}
export function localePath(path: string, language: AppLanguage = UI_LANGUAGE): string {
  if (!/^\/(?:[?#]|$|(?:es|en)(?:\/|$)|app(?:\/|$)|auth(?:\/|$)|reports\/|invitations\/|help(?:[/?#]|$)|ayuda(?:[/?#]|$)|status(?:[/?#]|$)|estado(?:[/?#]|$)|legal(?:[/?#]|$)|forbidden(?:[/?#]|$)|not-found(?:[/?#]|$))/.test(path)
    || path.startsWith("/legal/versions/") || /^\/(?:es|en)\/legal\/versions\//.test(path)) return path;
  const translated = routePath(path, language);
  return `/${language}${translated === "/" ? "/" : translated}`;
}

/** Only explicitly trusted UVH origins may have their UI paths rewritten. */
export function localeHref(href: string, origins: readonly string[], language: AppLanguage = UI_LANGUAGE): string {
  if (href.startsWith("/") && !href.startsWith("//")) return localePath(href, language);
  if (!/^https?:\/\//i.test(href)) return href;
  try {
    const url = new URL(href);
    if (url.username || url.password || !origins.includes(url.origin)) return href;
    const path = localePath(url.pathname, language);
    return path === url.pathname ? href : url.origin + path + url.search + url.hash;
  } catch { return href; }
}
