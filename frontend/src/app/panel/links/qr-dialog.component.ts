import { Component, DestroyRef, inject, signal, computed, ChangeDetectionStrategy } from "@angular/core";

import { MAT_DIALOG_DATA, MatDialogModule } from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSelectModule } from "@angular/material/select";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatTooltipModule } from "@angular/material/tooltip";
import { QrCodeService, type QrCodeRenderOptions } from "../../core/services/qr-code.service";
import { prepareQrCustomLogo, type QrCustomLogo } from "../../core/services/qr-custom-logo";

@Component({
  selector: "app-qr-dialog",
  standalone: true,
  imports: [MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule, MatFormFieldModule, MatSelectModule, MatCheckboxModule, MatTooltipModule],
  templateUrl: "./qr-dialog.component.html",
  styleUrl: "./qr-dialog.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QrDialogComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly qrCode = inject(QrCodeService);
  readonly url = inject<string>(MAT_DIALOG_DATA);
  readonly dataUrl = signal<string | null>(null);
  readonly error = signal<string | null>(null);
  readonly downloadBusy = signal(false);
  readonly downloadSize = signal(2048);
  readonly includeLogo = signal(true);
  readonly logoSource = signal<"uvh" | "custom">("uvh");
  readonly customLogo = signal<QrCustomLogo | null>(null);
  readonly logoBusy = signal(false);
  readonly logoError = signal<string | null>(null);
  readonly needsCustomLogo = computed(() => this.includeLogo() && this.logoSource() === "custom" && !this.customLogo());
  readonly correctionLevel = signal<"L" | "M" | "Q" | "H">("H");
  readonly quietZone = signal(4);
  readonly previewBusy = signal(true);
  readonly isDefault = computed(() => this.downloadSize() === 2048 && this.includeLogo() && this.logoSource() === "uvh" && !this.customLogo() && !this.logoBusy() && this.correctionLevel() === "H" && this.quietZone() === 4);
  private previewRevision = 0;
  private logoRevision = 0;
  readonly correctionLevels = [
    { level: "L", label: "Baja" },
    { level: "M", label: "Media" },
    { level: "Q", label: "Alta" },
    { level: "H", label: "Máxima" },
  ] as const;
  readonly margins = [
    { size: 4, label: "Estándar" },
    { size: 6, label: "Amplio" },
    { size: 8, label: "Extra" },
  ] as const;
  readonly downloadSizes = [
    { size: 512, label: "Digital" },
    { size: 1024, label: "Versátil" },
    { size: 2048, label: "Impresión" },
    { size: 4096, label: "Gran formato" },
  ] as const;

  constructor() {
    void this.generate();
  }

  selectDownloadSize(size: number): void {
    if (this.downloadBusy() || this.destroyRef.destroyed) return;
    if (this.downloadSizes.some(option => option.size === size)) this.downloadSize.set(size);
  }

  async setIncludeLogo(include: boolean): Promise<void> {
    if (this.downloadBusy() || this.destroyRef.destroyed || include === this.includeLogo()) return;
    this.includeLogo.set(include);
    this.invalidateLogoLoad();
    if (include) this.correctionLevel.set("H");
    await this.generate();
  }

  async selectLogoSource(source: string): Promise<void> {
    if (this.downloadBusy() || this.destroyRef.destroyed || !this.includeLogo() || (source !== "uvh" && source !== "custom")) return;
    this.invalidateLogoLoad();
    this.logoSource.set(source);
    await this.generate();
  }

  async uploadLogo(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // Permit choosing the same file again after a read error.
    if (!file || this.downloadBusy() || this.destroyRef.destroyed || !this.includeLogo() || this.logoSource() !== "custom") return;
    const revision = ++this.logoRevision;
    const current = () => !this.destroyRef.destroyed && revision === this.logoRevision;
    this.logoBusy.set(true);
    this.logoError.set(null);
    try {
      const logo = await prepareQrCustomLogo(file);
      if (!current()) return;
      this.customLogo.set(logo);
      await this.generate();
    } catch (error) {
      if (current()) this.logoError.set(error instanceof Error ? error.message : "No se pudo preparar el logo. Prueba con otra imagen.");
    } finally {
      if (current()) this.logoBusy.set(false);
    }
  }

  async removeCustomLogo(): Promise<void> {
    if (this.downloadBusy() || this.destroyRef.destroyed) return;
    this.invalidateLogoLoad();
    this.customLogo.set(null);
    await this.generate();
  }

  private invalidateLogoLoad(): void {
    ++this.logoRevision;
    this.logoBusy.set(false);
    this.logoError.set(null);
  }

  async selectCorrectionLevel(level: string): Promise<void> {
    if (this.downloadBusy() || this.destroyRef.destroyed || this.includeLogo()) return;
    const option = this.correctionLevels.find(option => option.level === level);
    if (!option || option.level === this.correctionLevel()) return;
    this.correctionLevel.set(option.level);
    await this.generate();
  }

  async selectQuietZone(size: number): Promise<void> {
    if (this.downloadBusy() || this.destroyRef.destroyed || size === this.quietZone()) return;
    if (!this.margins.some(option => option.size === size)) return;
    this.quietZone.set(size);
    await this.generate();
  }

  async resetOptions(): Promise<void> {
    if (this.downloadBusy() || this.destroyRef.destroyed || this.isDefault()) return;
    const needsPreview = !this.includeLogo() || this.logoSource() !== "uvh" || this.correctionLevel() !== "H" || this.quietZone() !== 4;
    this.invalidateLogoLoad();
    this.customLogo.set(null);
    this.logoSource.set("uvh");
    this.downloadSize.set(2048);
    this.includeLogo.set(true);
    this.correctionLevel.set("H");
    this.quietZone.set(4);
    if (needsPreview) await this.generate();
  }

  async retryPreview(): Promise<void> {
    if (!this.downloadBusy() && !this.previewBusy() && !this.destroyRef.destroyed) await this.generate();
  }

  private renderOptions(width: number): QrCodeRenderOptions {
    const customLogo = this.includeLogo() && this.logoSource() === "custom" ? this.customLogo()?.canvas : undefined;
    return { width, includeLogo: this.includeLogo(), errorCorrectionLevel: this.correctionLevel(), margin: this.quietZone(), ...(customLogo ? { customLogo } : {}) };
  }

  async download(): Promise<void> {
    if (!this.dataUrl() || this.previewBusy() || this.logoBusy() || this.needsCustomLogo() || this.downloadBusy() || this.destroyRef.destroyed) return;
    const options = this.renderOptions(this.downloadSize());
    this.downloadBusy.set(true);
    this.error.set(null);
    let imageReady = false;
    try {
      const generator = await this.qrCode.load();
      if (this.destroyRef.destroyed) return;
      const png = await generator.toDataURL(this.url, options);
      if (this.destroyRef.destroyed) return;
      imageReady = true;
      const a = document.createElement("a");
      a.href = png;
      // Constrain untrusted path text before it becomes a suggested filename.
      const rawAlias = this.url.split("/").pop() || "uvh";
      const alias = rawAlias.replace(/[^A-Za-z0-9._-]+/g, "-").replace(/^[-.]+|[-.]+$/g, "").slice(0, 80) || "uvh";
      a.download = `uvh-${alias}.png`;
      a.click();
    } catch {
      if (!this.destroyRef.destroyed) this.error.set(imageReady
        ? "El navegador no pudo iniciar la descarga del QR."
        : "No se pudo preparar el PNG de alta resolución. Inténtalo de nuevo.");
    } finally {
      if (!this.destroyRef.destroyed) this.downloadBusy.set(false);
    }
  }

  private async generate(): Promise<void> {
    const revision = ++this.previewRevision;
    if (this.needsCustomLogo()) {
      this.dataUrl.set(null);
      this.previewBusy.set(false);
      this.error.set(null);
      return;
    }
    const current = () => !this.destroyRef.destroyed && revision === this.previewRevision;
    const options = this.renderOptions(480);
    this.previewBusy.set(true);
    this.error.set(null);
    try {
      const generator = await this.qrCode.load();
      if (!current()) return;
      const dataUrl = await generator.toDataURL(this.url, options);
      if (current()) this.dataUrl.set(dataUrl);
    } catch {
      if (current()) {
        this.dataUrl.set(null);
        this.error.set("No se pudo generar el código QR. Inténtalo de nuevo.");
      }
    } finally {
      if (current()) this.previewBusy.set(false);
    }
  }
}
