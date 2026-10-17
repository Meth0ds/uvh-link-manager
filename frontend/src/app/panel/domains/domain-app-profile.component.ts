import { UI_TEXT } from "../../core/localisation/template-messages";
import { ApiRequestError } from "../../core/services/api.service";
import { CopyFeedbackService } from "../../core/services/copy-feedback.service";
import {
  Component,
  DestroyRef,
  effect,
  inject,
  input,
  signal,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { AppOpeningService } from "../../core/services/app-opening.service";
import { LatestRequest } from "../../core/services/latest-request";
import { WorkspaceService } from "../../core/services/workspace.service";
import type { AppProfile } from "../../core/app-opening";

@Component({
  selector: "app-domain-app-profile",
  standalone: true,
  providers: [CopyFeedbackService],
  imports: [FormsModule, MatButtonModule, MatIconModule],
  templateUrl: "./domain-app-profile.component.html",
  styleUrl: "./domain-app-profile.component.scss",
})
export class DomainAppProfileComponent {
  readonly uiText = UI_TEXT;
  readonly domainId = input.required<number>();
  readonly domain = input.required<string>();
  readonly apps = inject(AppOpeningService);
  readonly copyFeedback = inject(CopyFeedbackService);
  readonly copyScope = () =>
    JSON.stringify([
      this.apps.context(),
      this.domainId(),
      this.profile()?.version,
    ]);
  copyProfileId() {
    const id = this.profile()?.id;
    if (id) this.copyFeedback.copy(id, this.copyScope);
  }
  readonly workspaces = inject(WorkspaceService);
  readonly profile = signal<AppProfile | null>(null);
  readonly ready = signal(false);
  readonly expanded = signal(false);
  readonly loading = signal(false);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly success = signal("");
  readonly diagnostics = signal<Awaited<
    ReturnType<AppOpeningService["diagnose"]>
  > | null>(null);
  readonly refresh = signal(0);
  private readonly destroy = inject(DestroyRef);
  private readonly requests = new LatestRequest(this.destroy);
  private key = crypto.randomUUID();
  private intent = "";
  name = "";
  enabled = false;
  iosAppId = "";
  androidPackage = "";
  fingerprints = "";
  prefixes = "/productos/";
  constructor() {
    void this.apps.capabilities();
    effect(() => {
      const native = this.apps.native();
      if (!native) return;
      const context = this.apps.context();
      const id = this.domainId();
      this.refresh();
      const key = JSON.stringify([context, id, native]);
      const r = this.requests.begin(key);
      this.profile.set(null);
      this.diagnostics.set(null);
      this.error.set("");
      this.success.set("");
      this.loading.set(native);
      this.busy.set(false);
      this.name = "";
      this.iosAppId = "";
      this.androidPackage = "";
      this.fingerprints = "";
      this.prefixes = "/productos/";
      this.enabled = false;
      if (native)
        void this.apps
          .profile(id, r.signal)
          .then((v) => {
            if (
              !this.requests.isCurrent(
                r,
                JSON.stringify([
                  this.apps.context(),
                  this.domainId(),
                  this.apps.native(),
                ]),
              )
            )
              return;
            this.profile.set(v.profile);
            this.ready.set(v.domainReady);
            const p = v.profile;
            this.name = p?.name ?? "";
            this.enabled = p?.enabled ?? false;
            this.iosAppId = p?.iosAppId ?? "";
            this.androidPackage = p?.androidPackage ?? "";
            this.fingerprints = p?.androidFingerprints.join("\n") ?? "";
            this.prefixes = p?.routePrefixes.join("\n") ?? "/productos/";
          })
          .catch(() => {
            if (
              this.requests.isCurrent(
                r,
                JSON.stringify([
                  this.apps.context(),
                  this.domainId(),
                  this.apps.native(),
                ]),
              )
            )
              this.error.set($localize`:@@ui.eb6905aca3a6f4:No se pudo cargar la configuración.`);
          })
          .finally(() => {
            if (
              this.requests.isCurrent(
                r,
                JSON.stringify([
                  this.apps.context(),
                  this.domainId(),
                  this.apps.native(),
                ]),
              )
            )
              this.loading.set(false);
          });
    });
  }
  canManage() {
    return ["owner", "admin"].includes(this.workspaces.currentRole() ?? "");
  }
  reload() {
    this.refresh.update((v) => v + 1);
  }
  async save() {
    if (this.busy() || !this.canManage()) return;
    const body = {
      version: this.profile()?.version ?? 0,
      name: this.name.trim(),
      enabled: this.enabled,
      iosAppId: this.iosAppId.trim() || null,
      androidPackage: this.androidPackage.trim() || null,
      androidFingerprints: this.fingerprints
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean),
      routePrefixes: this.prefixes
        .split(/\n/)
        .map((s) => s.trim())
        .filter(Boolean),
    };
    const intent = JSON.stringify(body);
    if (intent !== this.intent) {
      this.key = crypto.randomUUID();
      this.intent = intent;
    }
    const context = this.apps.context();
    const id = this.domainId();
    this.busy.set(true);
    this.error.set("");
    this.success.set("");
    try {
      const v = await this.apps.save(id, body, this.key);
      if (
        this.destroy.destroyed ||
        context !== this.apps.context() ||
        id !== this.domainId() ||
        !this.canManage()
      )
        return;
      this.profile.set(v.profile);
      this.ready.set(v.domainReady);
      this.diagnostics.set(null);
      this.success.set($localize`:@@ui.ac6cc61772f7fd:Configuración guardada`);
      this.key = crypto.randomUUID();
    } catch (e) {
      if (
        !this.destroy.destroyed &&
        context === this.apps.context() &&
        id === this.domainId()
      )
        this.error.set(
          e instanceof ApiRequestError
            ? e.message
            : $localize`:@@ui.06acf02b398502:No se pudo guardar. Revisa la configuración e inténtalo de nuevo.`,
        );
    } finally {
      if (
        !this.destroy.destroyed &&
        context === this.apps.context() &&
        id === this.domainId()
      )
        this.busy.set(false);
    }
  }
  async diagnose() {
    if (this.busy() || !this.canManage()) return;
    const context = this.apps.context();
    const id = this.domainId();
    this.busy.set(true);
    this.error.set("");
    try {
      const v = await this.apps.diagnose(id);
      if (
        !this.destroy.destroyed &&
        context === this.apps.context() &&
        id === this.domainId() &&
        this.canManage()
      )
        this.diagnostics.set(v);
    } catch {
      if (
        !this.destroy.destroyed &&
        context === this.apps.context() &&
        id === this.domainId()
      )
        this.error.set(
          $localize`:@@ui.b8d3e0ce772f88:No se pudo completar la comprobación. Puedes reintentarlo.`,
        );
    } finally {
      if (
        !this.destroy.destroyed &&
        context === this.apps.context() &&
        id === this.domainId()
      )
        this.busy.set(false);
    }
  }
}
