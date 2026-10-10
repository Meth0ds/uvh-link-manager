import { inject, Injectable, InjectionToken } from "@angular/core";
import type { QRCodeToDataURLOptions } from "qrcode";

export type QrCodeRenderOptions = QRCodeToDataURLOptions & {
  includeLogo?: boolean;
  /** Raster canvas prepared locally; never an external image URL. */
  customLogo?: HTMLCanvasElement;
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
}
