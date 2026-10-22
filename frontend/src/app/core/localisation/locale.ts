import manifest from "../../../../../shared/localisation/routes.json";

export type AppLanguage = "es" | "en" | "fr";

/** Every language the tooling, router and manifest understand. */
export const SUPPORTED_LANGUAGES: readonly AppLanguage[] = ["es", "en", "fr"];

/**
 * Languages whose compiled bundles are deployed together. Keep this list in
 * step with `production.localize` so the switch never offers a route that has
 * no bundle behind it.
 */
export const RELEASED_LANGUAGES: readonly AppLanguage[] = ["es", "en", "fr"];

export const LANGUAGE_TAGS: Record<AppLanguage, string> = { es: "es-ES", en: "en-GB", fr: "fr-FR" };

// Angular's localize transform translates templates but does not reliably set
// `$localize.locale` in the browser bundle. The generated document already has
// the authoritative locale, so read it before falling back to the source locale.
const DOCUMENT_LOCALE = typeof document !== "undefined" ? document.documentElement.lang : "";
const COMPILED_LOCALE = DOCUMENT_LOCALE || (typeof $localize !== "undefined" && $localize.locale) || "es";
const normalisedLocale = COMPILED_LOCALE.toLowerCase();
export const UI_LANGUAGE: AppLanguage = normalisedLocale.startsWith("fr") ? "fr" : normalisedLocale.startsWith("en") ? "en" : "es";
export const UI_LOCALE = LANGUAGE_TAGS[UI_LANGUAGE];
export const PUBLIC_ROUTES = manifest;
export type PublicRouteId = keyof typeof PUBLIC_ROUTES;

/** Old or untranslated paths that still resolve to a public page. */
const LEGACY_ALIASES: Record<string, PublicRouteId> = {
  "/help": "help", "/ayuda": "help", "/status": "status", "/estado": "status",
  "/legal": "terms", "/legal/terminos": "terms", "/legal/terms": "terms",
  "/legal/privacidad": "privacy", "/legal/privacy": "privacy",
  "/legal/denuncias": "reportAbuse", "/legal/report-abuse": "reportAbuse",
};
/** Every manifest route, so a new language needs no second table. */
const MANIFEST_PATHS: Record<string, PublicRouteId> = {};
for (const id of Object.keys(PUBLIC_ROUTES) as PublicRouteId[]) {
  for (const language of SUPPORTED_LANGUAGES) {
    if (PUBLIC_ROUTES[id][language] !== "/") MANIFEST_PATHS[PUBLIC_ROUTES[id][language]] = id;
  }
}
const LEGACY_PUBLIC: Record<string, PublicRouteId> = { ...LEGACY_ALIASES, ...MANIFEST_PATHS };

const LANGUAGE_PREFIX = new RegExp(`^/(?:${SUPPORTED_LANGUAGES.join("|")})(?=/|$)`);
const PUBLIC_PATHS = new Set(Object.values(PUBLIC_ROUTES).flatMap(route => SUPPORTED_LANGUAGES.map(language => route[language])));

export function isAppLanguage(value: unknown): value is AppLanguage {
  return typeof value === "string" && (SUPPORTED_LANGUAGES as readonly string[]).includes(value);
}

/** Only application surfaces and translated public pages are localised. */
function isLocalisablePath(pathname: string): boolean {
  const bare = pathname.replace(/\/+$/, "") || "/";
  if (bare === "/" || PUBLIC_PATHS.has(bare)) return true;
  return /^\/(?:app|auth|reports|invitations|forbidden|not-found|legal)(?:\/|$)/.test(bare);
}

export function routePath(path: string, language: AppLanguage = UI_LANGUAGE): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  const stripped = path.replace(LANGUAGE_PREFIX, "") || "/";
  const match = /^([^?#]*)([?#].*)?$/.exec(stripped)!;
  const id = LEGACY_PUBLIC[match[1].replace(/\/$/, "") || "/"];
  return (id ? PUBLIC_ROUTES[id][language] : match[1]) + (match[2] ?? "");
}

export function localePath(path: string, language: AppLanguage = UI_LANGUAGE): string {
  if (!path.startsWith("/") || path.startsWith("//")) return path;
  const match = /^([^?#]*)([?#].*)?$/.exec(path)!;
  const pathname = match[1];
  const suffix = match[2] ?? "";
  const bare = LANGUAGE_PREFIX.test(pathname) ? pathname.replace(LANGUAGE_PREFIX, "") || "/" : pathname;
  // Historical documents are immutable bytes: never rewrite their path.
  if (bare.startsWith("/legal/versions/") || !isLocalisablePath(bare)) return path;
  const translated = routePath(bare, language);
  return `/${language}${translated === "/" ? "/" : translated}` + suffix;
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
