import { inject, Injectable, InjectionToken } from "@angular/core";
import type { QRCodeToDataURLOptions } from "qrcode";
import type { QrDesignSpec, QrExportFormat, QrExportOptions, QrPrintOptions } from "./qr-design";
import type { QrLinkSnapshot } from "./qr-library.service";

export type QrCodeRenderOptions = QRCodeToDataURLOptions & {
  includeLogo?: boolean;
  /** Raster canvas prepared locally; never an external image URL. */
  customLogo?: HTMLCanvasElement;
  design?: QrDesignSpec;
};

export interface QrCodeGenerator {
  toDataURL(text: string, options: QrCodeRenderOptions): Promise<string>;
}

export const QR_CODE_IMPORT = new InjectionToken<() => Promise<QrCodeGenerator>>("QR code importer", {
  providedIn: "root",
  factory: () => () => import("./qr-renderer").then(module => ({ toDataURL: module.renderQr })),
});

/** Shares library code only. Callers retain ownership of their URL and result. */
@Injectable({ providedIn: "root" })
export class QrCodeService {
  private readonly importer = inject(QR_CODE_IMPORT);
  private generator?: Promise<QrCodeGenerator>;

  load(): Promise<QrCodeGenerator> {
    return this.generator ??= Promise.resolve().then(() => this.importer()).catch(error => {
      this.generator = undefined;
      throw error;
    });
  }

  async export(url: string, design: QrDesignSpec, format: QrExportFormat, options?: QrExportOptions): Promise<Blob> {
    const { signal, ...safeOptions } = options ?? {};
    return (await import("./qr-worker-client")).runQrWorker({ kind: "single", url, spec: design, format, options: safeOptions }, signal);
  }

  async print(urls: readonly string[], design: QrDesignSpec, print: QrPrintOptions, options?: QrExportOptions): Promise<Blob> {
    const { signal, ...safeOptions } = options ?? {};
    return (await import("./qr-worker-client")).runQrWorker({ kind: "print", urls, spec: design, print, options: safeOptions }, signal);
  }

  async bulk(links: readonly QrLinkSnapshot[], design: QrDesignSpec, format: QrExportFormat, print: QrPrintOptions, options?: QrExportOptions, progress?: (done: number, total: number) => void): Promise<Blob> {
    const { signal, ...safeOptions } = options ?? {};
    return (await import("./qr-worker-client")).runQrWorker({ kind: "bulk", links, spec: design, format, print, options: safeOptions }, signal, progress);
  }

  async moduleCount(url: string, design: QrDesignSpec): Promise<number> {
    return (await import("./qr-scene")).qrModuleCount(url, design);
  }
}
