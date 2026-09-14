import { DOCUMENT } from "@angular/common";
import { DestroyRef, Injectable, effect, inject, signal } from "@angular/core";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "uvh.theme";
const DARK_CLASS = "dark";

@Injectable({ providedIn: "root" })
export class ThemeService {
  private readonly document = inject(DOCUMENT);
  private readonly destroyRef = inject(DestroyRef);
  private readonly systemDark = signal(false);
  private mediaQuery?: MediaQueryList;
  private transitionTimer?: number;

  readonly preference = signal<ThemePreference>(this.readStored());

  constructor() {
    const view = this.document.defaultView;
    // Older embedded webviews can expose a Window without matchMedia.
    this.mediaQuery = typeof view?.matchMedia === "function"
      ? view.matchMedia("(prefers-color-scheme: dark)")
      : undefined;
    this.systemDark.set(this.mediaQuery?.matches === true);

    const onSystemThemeChange = (event: MediaQueryListEvent): void => this.systemDark.set(event.matches);
    this.mediaQuery?.addEventListener?.("change", onSystemThemeChange);

    // Apply both the explicit preference and live operating-system changes.
    effect(() => {
      const pref = this.preference();
      const dark = pref === "dark" || (pref === "system" && this.systemDark());
      const root = this.document.documentElement;
      root.classList.toggle(DARK_CLASS, dark);
      root.dataset["theme"] = dark ? "dark" : "light";
    });

    this.destroyRef.onDestroy(() => {
      this.mediaQuery?.removeEventListener?.("change", onSystemThemeChange);
      if (this.transitionTimer !== undefined) view?.clearTimeout(this.transitionTimer);
    });
  }

  private readStored(): ThemePreference {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw === "light" || raw === "dark" || raw === "system") return raw;
    } catch {
      /* ignore */
    }
    return "system";
  }

  set(pref: ThemePreference, origin?: { x: number; y: number }): void {
    this.beginTransition(origin);
    this.preference.set(pref);
    try {
      localStorage.setItem(STORAGE_KEY, pref);
    } catch {
      /* ignore */
    }
  }

  /** Resolved (effective) theme name, for display. */
  resolved(): "light" | "dark" {
    const pref = this.preference();
    if (pref !== "system") return pref;
    return this.systemDark() ? "dark" : "light";
  }

  toggle(origin?: { x: number; y: number }): void {
    this.set(this.resolved() === "dark" ? "light" : "dark", origin);
  }

  private beginTransition(origin?: { x: number; y: number }): void {
    const root = this.document.documentElement;
    const view = this.document.defaultView;
    if (!view || (typeof view.matchMedia === "function"
      && view.matchMedia("(prefers-reduced-motion: reduce)").matches)) return;

    // The native circular reveal already owns the visual change. Running the
    // fallback as well forces a whole-document layout during snapshot capture.
    if (root.classList.contains("landing-theme-transition")) {
      if (this.transitionTimer !== undefined) view.clearTimeout(this.transitionTimer);
      root.classList.remove("theme-changing");
      return;
    }

    if (origin) {
      root.style.setProperty("--uvh-theme-origin-x", `${origin.x}px`);
      root.style.setProperty("--uvh-theme-origin-y", `${origin.y}px`);
    }
    // CSS transitions retarget from their current value; no forced reflow is
    // needed to restart them when preferences change in quick succession.
    root.classList.add("theme-changing");
    if (this.transitionTimer !== undefined) view.clearTimeout(this.transitionTimer);
    this.transitionTimer = view.setTimeout(() => root.classList.remove("theme-changing"), 320);
  }
}
