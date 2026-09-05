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
    this.mediaQuery = view?.matchMedia("(prefers-color-scheme: dark)");
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
    if (!view || view.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    if (origin) {
      root.style.setProperty("--uvh-theme-origin-x", `${origin.x}px`);
      root.style.setProperty("--uvh-theme-origin-y", `${origin.y}px`);
    }
    root.classList.remove("theme-changing");
    // Re-arm the short transition even when users toggle twice quickly.
    void root.offsetWidth;
    root.classList.add("theme-changing");
    if (this.transitionTimer !== undefined) view.clearTimeout(this.transitionTimer);
    this.transitionTimer = view.setTimeout(() => root.classList.remove("theme-changing"), 320);
  }
}
