import { DOCUMENT } from "@angular/common";
import { ChangeDetectionStrategy, Component, computed, inject, input, signal } from "@angular/core";
import { ActionDialogService } from "../../panel/action-dialog.service";
import { AuthService } from "../services/auth.service";
import { ApiService } from "../services/api.service";
import { MatMenuModule } from "@angular/material/menu";
import { AppLanguage, LANGUAGE_TAGS, RELEASED_LANGUAGES, isAppLanguage, localePath, UI_LANGUAGE } from "./locale";

const LANGUAGE_NAMES: Record<AppLanguage, string> = { es: "Español", en: "English", fr: "Français" };

@Component({
  selector: "app-language-selector", standalone: true, changeDetection: ChangeDetectionStrategy.OnPush,
  imports: [MatMenuModule],
  templateUrl: "./language-selector.component.html",
  styleUrl: "./language-selector.component.scss",
})
export class LanguageSelectorComponent {
  readonly accountPreference = input(false);
  readonly fullName = input(false);
  readonly languageName = computed(() => LANGUAGE_NAMES[this.language()]);
  readonly languageTag = computed(() => LANGUAGE_TAGS[this.language()]);
  readonly includesFrench = RELEASED_LANGUAGES.includes("fr");
  readonly showFullName = computed(() => this.fullName() || this.accountPreference());
  readonly accessibleLabel = computed(() => $localize`:@@language.current:Idioma de UVH: ${this.languageName()}:language:.`);
  readonly language = computed<AppLanguage>(() => {
    if (!this.accountPreference()) return UI_LANGUAGE;
    const preferred = this.auth.user()?.language;
    return isAppLanguage(preferred) ? preferred : "es";
  });
  readonly busy = signal(false);
  readonly error = signal("");
  private readonly document = inject(DOCUMENT);
  private readonly confirm = inject(ActionDialogService);
  private readonly auth = inject(AuthService);
  private readonly api = inject(ApiService);
  async change(event: Event): Promise<void> {
    const select = event.target as HTMLSelectElement;
    const language = select.value;
    select.value = this.language();
    await this.selectLanguage(language);
  }
  async selectLanguage(language: unknown): Promise<void> {
    if (!isAppLanguage(language) || language === this.language() || this.busy()) return;
    const view = this.document.defaultView;
    if (!view) return;
    const account = this.auth.user()?.id;
    const generation = this.auth.sessionGeneration();
    if (this.document.querySelector("form.ng-dirty, mat-dialog-container, [aria-busy=true]")) {
      const accepted = await this.confirm.confirm({ title: $localize`:@@language.changeTitle:Cambiar de idioma`, message: $localize`:@@language.discardWarning:La página se recargará. Los cambios sin guardar y las operaciones en curso pueden perderse.`, confirmLabel: $localize`:@@language.confirm:Cambiar de idioma` });
      if (!accepted || this.auth.user()?.id !== account || this.auth.sessionGeneration() !== generation) return;
    }
    this.busy.set(true); this.error.set("");
    try {
      if (account) await this.api.patch("/api/v1/auth/language", { language }, (value: unknown) => {
        if (typeof value !== "object" || value === null || !("language" in value) || value.language !== language) throw new Error("Invalid language preference response");
        return { language };
      });
      if (this.auth.user()?.id !== account || this.auth.sessionGeneration() !== generation) return;
      this.document.cookie = `uvh_language=${language}; Path=/; Max-Age=31536000; SameSite=Lax${view.location.protocol === "https:" ? "; Secure" : ""}`;
      this.navigate(view, language);
    } catch {
      this.error.set($localize`:@@language.saveError:No se pudo guardar el idioma. Inténtalo de nuevo.`);
    } finally { this.busy.set(false); }
  }
  private navigate(view: Window, language: AppLanguage): void {
    // Query and fragment remain opaque: they can carry an unconsumed authentication handoff.
    view.location.assign(localePath(view.location.pathname, language) + view.location.search + view.location.hash);
  }
}
