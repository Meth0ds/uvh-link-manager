import { Component, DestroyRef, inject, signal, computed, effect, ChangeDetectionStrategy } from "@angular/core";

import { MAT_DIALOG_DATA, MatDialogModule, MatDialogRef } from "@angular/material/dialog";
import { MatButtonModule } from "@angular/material/button";
import { MatIconModule } from "@angular/material/icon";
import { MatProgressBarModule } from "@angular/material/progress-bar";
import { MatFormFieldModule } from "@angular/material/form-field";
import { MatSelectModule } from "@angular/material/select";
import { MatCheckboxModule } from "@angular/material/checkbox";
import { MatTooltipModule } from "@angular/material/tooltip";
import { MatInputModule } from "@angular/material/input";
import { FormsModule } from "@angular/forms";
import { QrCodeService, type QrCodeRenderOptions } from "../../core/services/qr-code.service";
import { prepareQrCustomLogo, qrLogoRaster, type QrCustomLogo } from "../../core/services/qr-custom-logo";
import { SessionContextService } from "../../core/services/session-context.service";
import { WorkspaceService } from "../../core/services/workspace.service";
import { QrLibraryService, type QrLinkSnapshot, type QrVariant } from "../../core/services/qr-library.service";
import { QrCampaignSaveComponent } from "./qr-campaign-save.component";
import { QrDesignPickerComponent, type AppliedQrDesign } from "./qr-design-picker.component";
import { qrContrast, qrPrintLayout, validateQrPhysicalSize, validateQrDesign, type QrDesignSpec, type QrExportFormat, type QrExportOptions } from "../../core/services/qr-design";

@Component({
  selector: "app-qr-dialog",
  standalone: true,
  imports: [QrCampaignSaveComponent, QrDesignPickerComponent, FormsModule, MatInputModule, MatDialogModule, MatButtonModule, MatIconModule, MatProgressBarModule, MatFormFieldModule, MatSelectModule, MatCheckboxModule, MatTooltipModule],
  templateUrl: "./qr-dialog.component.html",
  styleUrl: "./qr-dialog.component.scss",
  changeDetection: ChangeDetectionStrategy.OnPush,
})
export class QrDialogComponent {
  private readonly destroyRef = inject(DestroyRef);
  private readonly qrCode = inject(QrCodeService);
  private readonly dialogRef = inject(MatDialogRef<QrDialogComponent>, { optional: true });
  readonly logoFile = signal<File | null>(null);
  private readonly assetId = signal<number | null>(null);
  readonly libraryBusy = signal(false);
  readonly campaignSaving = signal(false);
  readonly canonicalBusy = signal(false);
  private readonly canonicalFailed = signal(false);
  readonly designBusy = computed(() => this.libraryBusy() || this.campaignSaving() || this.canonicalBusy());
  private readonly input = inject<string | { url: string; linkId?: number; links?: readonly QrLinkSnapshot[]; library?: boolean; campaign?: boolean; variant?: QrVariant | null; initialDesign?: QrDesignSpec }>(MAT_DIALOG_DATA);
  private readonly baseUrl = typeof this.input === "string" ? this.input : this.input.url;
  private readonly activeUrl = signal(this.baseUrl);
  get url(): string { return this.activeUrl(); }
  readonly campaignMode = signal(typeof this.input === "string" ? false : !!this.input.campaign);
  readonly variant = signal(typeof this.input === "string" ? null : this.input.variant ?? null);
  private readonly savedCampaignDesign = signal(this.variant() ? JSON.stringify(this.variant()!.spec) : null);
  readonly campaignReady = computed(() => {
    if (!this.campaignMode()) return true;
    try { return this.savedCampaignDesign() === JSON.stringify(validateQrDesign(this.design())); } catch { return false; }
  });
  readonly canWrite = computed(() => ["owner", "admin", "editor"].includes(this.workspace.currentRole() ?? ""));
  readonly linkId = typeof this.input === "string" ? undefined : this.input.linkId;
  readonly bulkLinks = typeof this.input === "string" ? undefined : this.input.links;
  readonly libraryMode = typeof this.input === "string" ? false : !!this.input.library;
  private readonly library = inject(QrLibraryService);
  private readonly workspace = inject(WorkspaceService);
  private readonly session = inject(SessionContextService);
  private readonly originContext = this.context();
  private exportAbort = new AbortController();
  readonly progress = signal<{ done: number; total: number } | null>(null);
  readonly section = signal<"design" | "file" | "print">("design");
  readonly format = signal<QrExportFormat>("png");
  readonly foreground = signal("#262821");
  readonly background = signal("#FFFFFF");
  readonly contrastRatio = computed(() => qrContrast(this.foreground(), this.background()));
  readonly frame = signal<QrDesignSpec["frame"]>("none");
  readonly caption = signal("");
  readonly sizeMm = signal(35);
  readonly unit = signal<"mm" | "cm">("mm");
  readonly copies = signal(1);
  readonly fillPage = signal(false);
  readonly cutMarks = signal(false);
  readonly modules = signal(0);
  readonly confirmation = signal<string | null>(null);
  readonly copyFallback = signal(false);
  readonly copying = signal(false);
  readonly a4Mode = computed(() => this.section() === "print" || (!!this.bulkLinks && this.format() === "pdf"));
  private printOptions() { return { sizeMm: this.sizeMm(), copies: this.bulkLinks?.length ?? (this.fillPage() ? "page" as const : this.copies()), cutMarks: this.cutMarks() }; }
  readonly printLayout = computed(() => {
    if (!this.modules()) return null;
    try { return qrPrintLayout(this.design(), this.modules(), this.printOptions()); }
    catch { return null; }
  });
  readonly printError = computed(() => {
    if (!this.modules()) return null;
    try {
      if (this.a4Mode()) qrPrintLayout(this.design(), this.modules(), this.printOptions());
      else validateQrPhysicalSize(this.design(), this.modules(), this.sizeMm());
      return null;
    }
    catch (error) { return error instanceof Error ? error.message : "Configuración de impresión inválida."; }
  });
  readonly printSlots = computed(() => {
    const layout = this.printLayout();
    return layout ? Array.from({ length: Math.min(layout.copies, layout.perPage) }, (_, index) => ({
      index, x: 10 + (index % layout.columns) * (layout.widthMm + 5),
      y: 10 + Math.floor(index / layout.columns) * (layout.heightMm + 5),
      width: layout.widthMm, height: layout.heightMm,
    })) : [];
  });
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
  readonly isDefault = computed(() => this.downloadSize() === 2048 && this.includeLogo() && this.logoSource() === "uvh" && !this.customLogo() && !this.logoBusy() && this.correctionLevel() === "H" && this.quietZone() === 4 && this.foreground() === "#262821" && this.background() === "#FFFFFF" && this.frame() === "none" && !this.caption());
  private previewRevision = 0;
  private printRevision = 0;
  readonly printPreviewUrls = signal<readonly string[]>([]);
  readonly printPreviewBusy = signal(false);
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
    effect(() => { if (this.context() !== this.originContext) this.closeForContextChange(); });
    effect(() => {
      const count = this.printSlots().length;
      const ready = this.a4Mode() && !!this.bulkLinks && !!this.dataUrl() && !this.previewBusy();
      const spec = this.design();
      if (ready && count) void this.generatePrintPreviews(spec, count);
      else { ++this.printRevision; this.printPreviewBusy.set(false); this.printPreviewUrls.set([]); }
    });
    this.destroyRef.onDestroy(() => this.exportAbort.abort());
    if (typeof this.input !== "string" && this.input.initialDesign) { this.initialSpec.set(this.input.initialDesign); void this.applyDesign({ spec: this.input.initialDesign, logo: null }); }
    else void this.generate();
  }
  readonly initialSpec = signal<QrDesignSpec | null>(null);
  async campaignSaved(variant: QrVariant): Promise<void> {
    if (!this.validContext()) return;
    this.canonicalBusy.set(true);
    this.canonicalFailed.set(false);
    try {
      const url = new URL(this.baseUrl); url.searchParams.set("qr", variant.publicId); this.activeUrl.set(url.toString());
      this.variant.set(variant);
      this.assetId.set(variant.spec.logo.kind === "custom" ? variant.spec.logo.assetId : null);
      let logo: QrCustomLogo | null = null;
      if (variant.spec.logo.kind === "custom" && variant.spec.logo.assetId) {
        this.previewBusy.set(true);
        this.customLogo.set(null); this.logoFile.set(null);
        try {
          logo = await this.library.preparedLogo(variant.spec.logo.assetId, variant.name, { signal: this.exportAbort.signal });
          if (!this.validContext()) return;
        } catch (error) {
          if (this.validContext()) { this.canonicalFailed.set(true); this.previewBusy.set(false); this.dataUrl.set(null); this.error.set(error instanceof Error ? error.message : "No se pudo recuperar el logo guardado."); }
          return;
        }
      }
      this.savedCampaignDesign.set(JSON.stringify(variant.spec));
      this.confirmation.set("QR de campaña guardado. Descarga esta nueva versión para atribuir sus visitas.");
      await this.applyDesign({ spec: variant.spec, logo });
    } finally { if (this.validContext()) this.canonicalBusy.set(false); }
  }
  private context(): string { return JSON.stringify([this.workspace.currentId(), this.workspace.selectionGeneration(), this.workspace.currentRole(), this.session.user()?.id, this.session.generation()]); }
  private validContext(): boolean { return !this.destroyRef.destroyed && this.context() === this.originContext; }
  cancelExport(): void { this.exportAbort.abort(); this.exportAbort = new AbortController(); }

  design(): QrDesignSpec {
    return { version: 1, foreground: this.foreground(), background: this.background(), correction: this.correctionLevel(), quietZone: this.quietZone() as 4 | 6 | 8,
      logo: !this.includeLogo() ? { kind: "none" } : this.logoSource() === "uvh" ? { kind: "uvh" } : { kind: "custom", assetId: this.assetId() }, frame: this.frame(), caption: this.caption() };
  }

  async applyDesign(applied: AppliedQrDesign): Promise<void> {
    if (this.downloadBusy() || !this.validContext()) return;
    const spec = applied.spec;
    this.invalidateLogoLoad(); this.foreground.set(spec.foreground); this.background.set(spec.background);
    this.frame.set(spec.frame); this.caption.set(spec.caption); this.correctionLevel.set(spec.correction); this.quietZone.set(spec.quietZone);
    this.includeLogo.set(spec.logo.kind !== "none"); this.logoSource.set(spec.logo.kind === "custom" ? "custom" : "uvh");
    this.assetId.set(spec.logo.kind === "custom" ? spec.logo.assetId : null);
    this.customLogo.set(applied.logo); this.logoFile.set(null);
    await this.generate();
  }
  closeForContextChange(): void { this.exportAbort.abort(); ++this.previewRevision; this.invalidateLogoLoad(); this.dataUrl.set(null); this.dialogRef?.close(); }

  async changeDesign(field: "foreground" | "background" | "frame" | "caption", value: string): Promise<void> {
    if (this.downloadBusy() || this.designBusy() || !this.validContext()) return;
    if (field === "frame") { if (!["none", "border", "caption"].includes(value)) return; this.frame.set(value as QrDesignSpec["frame"]); }
    else this[field].set(value);
    this.confirmation.set(null);
    await this.generate();
  }

  setSize(value: number): void { if (!this.downloadBusy()) this.sizeMm.set(Number(value) * (this.unit() === "cm" ? 10 : 1)); }

  private async exportOptions(): Promise<QrExportOptions> {
    const pixels = this.downloadSize(), sizeMm = this.sizeMm(), signal = this.exportAbort.signal;
    const logo = this.includeLogo() && this.logoSource() === "custom" ? this.customLogo() : null;
    const raster = logo ? await qrLogoRaster(logo.canvas) : undefined;
    signal.throwIfAborted();
    return { pixels, sizeMm, logo: raster, signal };
  }

  async copyImage(): Promise<void> {
    if (!this.dataUrl() || this.previewBusy() || this.logoBusy() || this.needsCustomLogo() || this.downloadBusy() || this.designBusy() || !this.validContext() || !this.campaignReady()) return;
    this.confirmation.set(null); this.copyFallback.set(false); this.error.set(null);
    if (!window.isSecureContext || !navigator.clipboard?.write || typeof ClipboardItem === "undefined") {
      this.error.set("Este navegador no permite copiar imágenes en este contexto. Puedes descargar el PNG y añadirlo a tu documento."); this.copyFallback.set(true); return;
    }
    const design = this.design();
    this.downloadBusy.set(true); this.copying.set(true);
    try {
      // Pass the promise during the user's click; awaiting image generation
      // before write loses transient activation in Safari.
      const url = this.url;
      const png = this.exportOptions().then(async options => {
        const blob = await this.qrCode.export(url, design, "png", options);
        options.signal?.throwIfAborted();
        if (!this.validContext()) throw new DOMException("Contexto cambiado", "AbortError");
        return blob;
      });
      await navigator.clipboard.write([new ClipboardItem({ "image/png": png })]);
      if (this.validContext()) this.confirmation.set("Imagen copiada. Ya puedes pegarla en tu documento.");
    } catch {
      if (this.validContext()) { this.error.set("No se pudo copiar la imagen. Comprueba el permiso del portapapeles o descarga el PNG."); this.copyFallback.set(true); }
    } finally { if (this.validContext()) { this.downloadBusy.set(false); this.copying.set(false); this.progress.set(null); } }
  }

  async downloadVectorOrPrint(forcePng = false): Promise<void> {
    if (!this.dataUrl() || this.previewBusy() || this.logoBusy() || this.needsCustomLogo() || this.downloadBusy() || this.designBusy() || !this.validContext() || !this.campaignReady() || (this.section() === "print" && this.printError())) return;
    if (this.a4Mode() && this.printPreviewBusy()) return;
    const section = forcePng ? "file" : this.section();
    const design = this.design(), format = forcePng ? "png" : section === "print" ? "pdf" : this.format();
    const print = this.printOptions();
    this.downloadBusy.set(true); this.error.set(null); this.confirmation.set(null);
    try {
      const options = await this.exportOptions();
      const blob = this.bulkLinks ? await this.qrCode.bulk(this.bulkLinks, design, format, print, options, (done, total) => { if (this.validContext()) this.progress.set({ done, total }); })
        : section === "print" ? await this.qrCode.print([this.url], design, print, options) : await this.qrCode.export(this.url, design, format, options);
      options.signal?.throwIfAborted();
      if (!this.validContext()) return;
      const href = URL.createObjectURL(blob), anchor = document.createElement("a");
      anchor.href = href; anchor.download = `uvh-qr${this.bulkLinks && format !== "pdf" ? "-lote" : section === "print" || this.bulkLinks ? "-a4" : ""}.${this.bulkLinks && format !== "pdf" ? "zip" : format}`;
      try { anchor.click(); } finally { setTimeout(() => URL.revokeObjectURL(href), 60_000); }
      this.confirmation.set("Archivo preparado. La descarga ha comenzado.");
    } catch (error) { if (this.validContext()) {
      if (error instanceof DOMException && error.name === "AbortError") this.confirmation.set("Exportación cancelada.");
      else this.error.set((forcePng ? "No se pudo preparar el PNG. " : "") + (error instanceof Error ? error.message : "No se pudo preparar el archivo."));
    } }
    finally { if (this.validContext()) { this.downloadBusy.set(false); this.progress.set(null); } }
  }

  selectDownloadSize(size: number): void {
    if (this.downloadBusy() || this.designBusy() || !this.validContext()) return;
    if (this.downloadSizes.some(option => option.size === size)) this.downloadSize.set(size);
  }

  async setIncludeLogo(include: boolean): Promise<void> {
    if (this.downloadBusy() || this.designBusy() || !this.validContext() || include === this.includeLogo()) return;
    this.includeLogo.set(include);
    this.invalidateLogoLoad();
    if (include) this.correctionLevel.set("H");
    await this.generate();
  }

  async selectLogoSource(source: string): Promise<void> {
    if (this.downloadBusy() || this.designBusy() || !this.validContext() || !this.includeLogo() || (source !== "uvh" && source !== "custom")) return;
    this.invalidateLogoLoad();
    this.logoSource.set(source);
    await this.generate();
  }

  async uploadLogo(event: Event): Promise<void> {
    const input = event.target as HTMLInputElement;
    const file = input.files?.[0];
    input.value = ""; // Permit choosing the same file again after a read error.
    if (!file || this.downloadBusy() || this.designBusy() || !this.validContext() || !this.includeLogo() || this.logoSource() !== "custom") return;
    const revision = ++this.logoRevision;
    const current = () => this.validContext() && revision === this.logoRevision;
    this.logoBusy.set(true);
    this.logoError.set(null);
    try {
      const logo = await prepareQrCustomLogo(file);
      if (!current()) return;
      this.customLogo.set(logo);
      this.logoFile.set(file); this.assetId.set(null);
      await this.generate();
    } catch (error) {
      if (current()) this.logoError.set(error instanceof Error ? error.message : "No se pudo preparar el logo. Prueba con otra imagen.");
    } finally {
      if (current()) this.logoBusy.set(false);
    }
  }

  async removeCustomLogo(): Promise<void> {
    if (this.downloadBusy() || this.designBusy() || !this.validContext()) return;
    this.invalidateLogoLoad();
    this.customLogo.set(null);
    this.logoFile.set(null); this.assetId.set(null);
    await this.generate();
  }

  private invalidateLogoLoad(): void {
    ++this.logoRevision;
    this.logoBusy.set(false);
    this.logoError.set(null);
  }

  async selectCorrectionLevel(level: string): Promise<void> {
    if (this.downloadBusy() || this.designBusy() || !this.validContext() || this.includeLogo()) return;
    const option = this.correctionLevels.find(option => option.level === level);
    if (!option || option.level === this.correctionLevel()) return;
    this.correctionLevel.set(option.level);
    await this.generate();
  }

  async selectQuietZone(size: number): Promise<void> {
    if (this.downloadBusy() || this.designBusy() || !this.validContext() || size === this.quietZone()) return;
    if (!this.margins.some(option => option.size === size)) return;
    this.quietZone.set(size);
    await this.generate();
  }

  async resetOptions(): Promise<void> {
    if (this.downloadBusy() || this.designBusy() || !this.validContext() || this.isDefault()) return;
    const needsPreview = !this.includeLogo() || this.logoSource() !== "uvh" || this.correctionLevel() !== "H" || this.quietZone() !== 4 || this.foreground() !== "#262821" || this.background() !== "#FFFFFF" || this.frame() !== "none" || !!this.caption();
    this.invalidateLogoLoad();
    this.customLogo.set(null);
    this.logoFile.set(null); this.assetId.set(null);
    this.logoSource.set("uvh");
    this.downloadSize.set(2048);
    this.includeLogo.set(true);
    this.correctionLevel.set("H");
    this.quietZone.set(4);
    this.foreground.set("#262821"); this.background.set("#FFFFFF"); this.frame.set("none"); this.caption.set("");
    if (needsPreview) await this.generate();
  }

  async retryPreview(): Promise<void> {
    if (this.downloadBusy() || this.designBusy() || this.previewBusy() || !this.validContext()) return;
    const variant = this.variant();
    if (this.canonicalFailed() && variant) await this.campaignSaved(variant);
    else await this.generate();
  }

  private renderOptions(width: number): QrCodeRenderOptions {
    const customLogo = this.includeLogo() && this.logoSource() === "custom" ? this.customLogo()?.canvas : undefined;
    return { width, includeLogo: this.includeLogo(), errorCorrectionLevel: this.correctionLevel(), margin: this.quietZone(), design: this.design(), ...(customLogo ? { customLogo } : {}) };
  }

  async download(): Promise<void> {
    if (this.bulkLinks) return this.downloadVectorOrPrint();
    return this.downloadVectorOrPrint(true);
  }

  private async generatePrintPreviews(spec: QrDesignSpec, count: number): Promise<void> {
    const revision = ++this.printRevision;
    const current = () => this.validContext() && revision === this.printRevision;
    const options = { ...this.renderOptions(240), design: spec };
    this.printPreviewBusy.set(true); this.printPreviewUrls.set([]);
    try {
      const generator = await this.qrCode.load(), images: string[] = [];
      for (const link of this.bulkLinks!.slice(0, count)) {
        if (!current()) return;
        images.push(await generator.toDataURL(link.shortUrl, options));
        if (!current()) return;
        this.printPreviewUrls.set([...images]);
        await new Promise<void>(resolve => setTimeout(resolve, 0));
      }
    } catch (error) {
      if (current()) { this.dataUrl.set(null); this.error.set(error instanceof Error ? error.message : "No se pudo preparar la vista previa de la hoja."); }
    } finally { if (current()) this.printPreviewBusy.set(false); }
  }

  private async generate(): Promise<void> {
    const revision = ++this.previewRevision;
    if (this.needsCustomLogo()) {
      this.dataUrl.set(null);
      this.previewBusy.set(false);
      this.error.set(null);
      return;
    }
    const current = () => this.validContext() && revision === this.previewRevision;
    const options = this.renderOptions(480);
    this.previewBusy.set(true);
    this.error.set(null);
    try {
      const generator = await this.qrCode.load();
      if (!current()) return;
      const dataUrl = await generator.toDataURL(this.url, options);
      if (current()) this.dataUrl.set(dataUrl);
    } catch (error) {
      if (current()) {
        this.dataUrl.set(null);
        this.error.set("No se pudo generar el código QR. " + (error instanceof Error ? error.message : "Inténtalo de nuevo."));
      }
    } finally {
      if (current()) this.previewBusy.set(false);
    }
    if (current() && this.dataUrl()) {
      try {
        let count = 0;
        const urls = this.bulkLinks?.map(link => link.shortUrl) ?? [this.url];
        for (let i = 0; i < urls.length; i++) {
          if (!current()) return;
          count = Math.max(count, await this.qrCode.moduleCount(urls[i], options.design!));
          if (i % 10 === 9) await new Promise<void>(resolve => setTimeout(resolve, 0));
        }
        if (current()) this.modules.set(count);
      }
      catch { if (current()) this.modules.set(0); }
    }
  }
}
