import { LocaleLinkDirective } from "../../core/localisation/locale-link.directive";
import { UI_TEXT } from "../../core/localisation/template-messages";
import {
  Component,
  DestroyRef,
  computed,
  effect,
  inject,
  input,
  model,
  output,
  signal,
  untracked,
} from "@angular/core";
import { FormsModule } from "@angular/forms";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatCheckboxModule } from "@angular/material/checkbox";
import type { SocialPreviewSpec } from "../../core/sharing";
import { ApiService } from "../../core/services/api.service";
import { SharingService } from "../../core/services/sharing.service";
import { LatestRequest } from "../../core/services/latest-request";
import { dimensions } from "../../core/services/qr-custom-logo";
import { integer, record } from "../../core/services/response-decoder-helpers";
const EMPTY: SocialPreviewSpec = {
  version: 1,
  enabled: false,
  title: "",
  description: null,
  imageAssetId: null,
  imageAlt: null,
};
@Component({
  selector: "app-social-preview-editor",
  standalone: true,
  imports: [LocaleLinkDirective, FormsModule, MatButtonModule, MatIconModule, MatCheckboxModule],
  templateUrl: "./social-preview-editor.component.html",
  styleUrl: "./social-preview-editor.component.scss",
})
export class SocialPreviewEditorComponent {
  readonly uiText = UI_TEXT;
  readonly initiallyOpen = input(false);
  readonly spec = model<SocialPreviewSpec | null>(null);
  readonly protected = input(false);
  readonly linkName = input("");
  readonly suggestionTitle = input<string | null>(null);
  readonly shortUrl = input($localize`:@@ui.233d48976bfaaf:uvh.es/tu-enlace`);
  readonly working = output<boolean>();
  readonly value = computed(() => this.spec() ?? EMPTY);
  readonly expanded = signal(false);
  readonly busy = signal(false);
  readonly error = signal("");
  readonly image = signal("");
  readonly lowResolution = signal(false);
  readonly pending = signal(false);
  readonly loadingImage = signal(false);
  readonly imageRefresh = signal(0);
  readonly api = inject(ApiService);
  readonly sharing = inject(SharingService);
  private destroy = inject(DestroyRef);
  private requests = new LatestRequest(this.destroy);
  private bitmap?: ImageBitmap;
  private file?: File;
  private assetImage = "";
  private localImage = "";
  private revision = 0;
  private key = crypto.randomUUID();
  x = 50;
  y = 50;
  zoom = 1;
  private openedInitial = false;
  readonly assetId = computed(() => this.value().imageAssetId);
  readonly open = computed(() => this.expanded());
  constructor() {
    effect(() => {
      if (
        !this.openedInitial &&
        (this.initiallyOpen() || this.value().enabled)
      ) {
        this.openedInitial = true;
        this.expanded.set(true);
      }
    });
    effect(() => {
      const context = this.sharing.context();
      const id = this.assetId();
      this.imageRefresh();
      const request = this.requests.begin(JSON.stringify([context, id]));
      if (this.assetImage) URL.revokeObjectURL(this.assetImage);
      this.assetImage = "";
      if (id === null && !untracked(() => this.pending())) this.image.set("");
      this.loadingImage.set(id !== null);
      if (id !== null)
        void this.api
          .getBlob("/api/v1/social-preview-assets/" + id, undefined, {
            signal: request.signal,
          })
          .then((blob) => {
            if (
              !this.requests.isCurrent(
                request,
                JSON.stringify([
                  this.sharing.context(),
                  this.value().imageAssetId,
                ]),
              )
            )
              return;
            this.assetImage = URL.createObjectURL(blob);
            if (!this.pending()) this.image.set(this.assetImage);
            this.loadingImage.set(false);
          })
          .catch(() => {
            if (
              this.requests.isCurrent(
                request,
                JSON.stringify([this.sharing.context(), this.assetId()]),
              )
            ) {
              this.loadingImage.set(false);
              this.error.set(
                $localize`:@@ui.3aac2e6d261153:No se pudo cargar la imagen guardada. Puedes volver a intentarlo.`,
              );
            }
          });
    });
    this.destroy.onDestroy(() => {
      this.revision++;
      this.bitmap?.close();
      if (this.localImage) URL.revokeObjectURL(this.localImage);
      if (this.assetImage) URL.revokeObjectURL(this.assetImage);
    });
  }
  patch(change: Partial<SocialPreviewSpec>): void {
    this.spec.set({ ...this.value(), ...change });
  }
  async choose(input: HTMLInputElement): Promise<void> {
    const file = input.files?.[0];
    input.value = "";
    if (!file || this.busy()) return;
    const context = this.sharing.context();
    const revision = ++this.revision;
    this.error.set("");
    this.busy.set(true);
    this.working.emit(true);
    try {
      if (file.size > 2 * 1024 * 1024 || file.size < 12)
        throw new Error($localize`:@@ui.936ea853e27965:Elige un PNG o JPG de hasta 2 MB.`);
      const bytes = new Uint8Array(await file.arrayBuffer());
      const size = dimensions(bytes);
      if (
        size.width < 1 ||
        size.height < 1 ||
        size.width > 4096 ||
        size.height > 4096
      )
        throw new Error($localize`:@@ui.39e66bd4c5cf43:La imagen debe medir como máximo 4096 px por lado.`);
      const bitmap = await createImageBitmap(
        new Blob([bytes], {
          type: bytes[0] === 137 ? "image/png" : "image/jpeg",
        }),
      );
      if (
        this.destroy.destroyed ||
        context !== this.sharing.context() ||
        revision !== this.revision
      ) {
        bitmap.close();
        return;
      }
      this.bitmap?.close();
      this.bitmap = bitmap;
      this.file = file;
      this.key = crypto.randomUUID();
      this.x = 50;
      this.y = 50;
      this.zoom = 1;
      this.pending.set(true);
      this.render();
    } catch (e) {
      if (context === this.sharing.context() && !this.destroy.destroyed)
        this.error.set(
          e instanceof Error ? e.message : $localize`:@@ui.502e1e3756200d:No se pudo leer la imagen.`,
        );
    } finally {
      if (!this.destroy.destroyed && revision === this.revision) {
        this.busy.set(false);
        this.working.emit(this.pending());
      }
    }
  }
  private crop(): { x: number; y: number; width: number; height: number } {
    const w = this.bitmap!.width,
      h = this.bitmap!.height;
    const width = Math.max(
      1,
      Math.floor(Math.min(w, (h * 1200) / 630) / this.zoom),
    );
    const height = Math.max(1, Math.floor((width * 630) / 1200));
    return {
      x: Math.round(((w - width) * this.x) / 100),
      y: Math.round(((h - height) * this.y) / 100),
      width,
      height,
    };
  }
  render(): void {
    if (!this.bitmap) return;
    const c = this.crop();
    this.lowResolution.set(c.width < 1200 || c.height < 630);
    const canvas = document.createElement("canvas");
    canvas.width = 1200;
    canvas.height = 630;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      this.error.set($localize`:@@ui.126f899c470ec9:No se pudo preparar la imagen.`);
      return;
    }
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, 1200, 630);
    ctx.drawImage(this.bitmap, c.x, c.y, c.width, c.height, 0, 0, 1200, 630);
    if (this.localImage) URL.revokeObjectURL(this.localImage);
    this.localImage = canvas.toDataURL("image/jpeg", 0.85);
    this.image.set(this.localImage);
    this.key = crypto.randomUUID();
  }
  async upload(): Promise<void> {
    if (!this.file || !this.bitmap || this.busy()) return;
    const context = this.sharing.context();
    this.busy.set(true);
    this.error.set("");
    this.working.emit(true);
    const form = new FormData();
    form.append("image", this.file);
    form.append("crop", JSON.stringify(this.crop()));
    try {
      const id = await this.api.upload(
        "/api/v1/social-preview-assets",
        form,
        (v) =>
          integer(
            record(record(v, "upload")["asset"], "asset")["id"],
            "asset id",
            1,
          ),
        { "Idempotency-Key": this.key },
      );
      if (!this.destroy.destroyed && context === this.sharing.context()) {
        this.patch({ imageAssetId: id });
        this.cancel(false);
      }
    } catch (e) {
      if (!this.destroy.destroyed && context === this.sharing.context())
        this.error.set(
          e instanceof Error
            ? e.message
            : $localize`:@@ui.12e776f5f69172:No se pudo cargar la imagen. Puedes reintentar.`,
        );
    } finally {
      if (!this.destroy.destroyed) {
        this.busy.set(false);
        this.working.emit(this.pending());
      }
    }
  }
  cancel(resetPreview = true): void {
    this.revision++;
    this.bitmap?.close();
    this.bitmap = undefined;
    this.file = undefined;
    this.pending.set(false);
    if (this.localImage.startsWith("blob:"))
      URL.revokeObjectURL(this.localImage);
    this.localImage = "";
    if (resetPreview) this.image.set(this.assetImage);
    this.working.emit(false);
  }
  remove(): void {
    this.cancel();
    this.patch({ imageAssetId: null, imageAlt: null });
    this.image.set("");
  }
}
