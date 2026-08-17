import { Injectable, effect, inject, signal } from "@angular/core";
import { DOCUMENT } from "@angular/common";

export type ThemePreference = "light" | "dark" | "system";

const STORAGE_KEY = "uvh.theme";
const DARK_CLASS = "dark";

@Injectable({ providedIn: "root" })
export class ThemeService {
  private document = inject(DOCUMENT);

  readonly preference = signal<ThemePreference>(this.readStored());

  constructor() {
    // Apply the preference whenever it (or the OS scheme) changes.
    effect(() => {
      const pref = this.preference();
      const dark =
        pref === "dark" ||
        (pref === "system" && this.document.defaultView?.matchMedia("(prefers-color-scheme: dark)").matches === true);
      this.document.documentElement.classList.toggle(DARK_CLASS, dark);
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

  set(pref: ThemePreference): void {
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
    return this.document.defaultView?.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
  }
}
