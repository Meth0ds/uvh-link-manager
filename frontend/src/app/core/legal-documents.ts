import type { AppLanguage } from "./localisation/locale";

/** Published document versions used by registration, activation and legal pages. */
export const TERMS_VERSION = "2026-10-09";
export const PRIVACY_VERSION = "2026-10-09";

/**
 * Immutable copies keep one directory per language. Spanish files live at the
 * version root; every other language gets its own BCP-47-neutral folder.
 */
export function legalCopyPath(language: AppLanguage, document: "terms" | "privacy", version: string): string {
  if (language === "es") return `/legal/versions/${version}/${document === "terms" ? "terminos" : "privacidad"}.html`;

  return `/legal/versions/${version}/${language}/${document}.html`;
}
