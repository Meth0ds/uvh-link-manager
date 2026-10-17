import { inject, Injectable, InjectionToken } from "@angular/core";

export interface QrSharePlatform {
  secureContext(): boolean;
  canShare?: (data: ShareData) => boolean;
  share?: (data: ShareData) => Promise<void>;
}

export type QrShareOutcome = "shared" | "cancelled" | "unsupported" | "denied" | "failed";

export const QR_SHARE_PLATFORM = new InjectionToken<QrSharePlatform>("QR native sharing", {
  providedIn: "root",
  factory: () => ({
    secureContext: () => typeof window !== "undefined" && window.isSecureContext,
    ...(typeof navigator !== "undefined" && typeof navigator.canShare === "function"
      ? { canShare: (data: ShareData) => navigator.canShare(data) } : {}),
    ...(typeof navigator !== "undefined" && typeof navigator.share === "function"
      ? { share: (data: ShareData) => navigator.share(data) } : {}),
  }),
});

/** The PNG must already exist before the user's click reaches native share. */
@Injectable({ providedIn: "root" })
export class QrShareService {
  private readonly platform = inject(QR_SHARE_PLATFORM);

  unavailableReason(): string | null {
    if (!this.platform.secureContext()) return $localize`:@@ui.33dd89149578ca:Para compartir una imagen necesitas una conexión segura. Puedes descargar el PNG.`;
    if (!this.platform.canShare || !this.platform.share || typeof File === "undefined") {
      return $localize`:@@ui.72d5990fd98a7f:Este navegador no permite compartir archivos. Descarga el PNG y añádelo a tu aplicación.`;
    }
    return null;
  }

  file(blob: Blob): File {
    if (blob.type !== "image/png" || !blob.size || blob.size > 64 * 1024 * 1024) throw new Error($localize`:@@ui.51dc79ca710de6:No se pudo preparar una imagen PNG válida para compartir.`);
    return new File([blob], "uvh-qr.png", { type: "image/png" });
  }

  supports(file: File): boolean {
    if (this.unavailableReason()) return false;
    try { return this.platform.canShare!({ files: [file] }); }
    catch { return false; }
  }

  share(file: File): Promise<QrShareOutcome> {
    if (!this.supports(file)) return Promise.resolve("unsupported");
    try {
      // Do not insert an await or a scheduled callback here: Safari requires
      // this invocation to remain within the original user activation.
      return this.platform.share!({ files: [file], title: $localize`:@@ui.41466761f1621d:Código QR de UVH` })
        .then(() => "shared" as const, (error: unknown) => this.failure(error));
    } catch (error) { return Promise.resolve(this.failure(error)); }
  }

  private failure(error: unknown): QrShareOutcome {
    const name = error instanceof DOMException || error instanceof Error ? error.name : "";
    if (name === "AbortError") return "cancelled";
    if (name === "NotAllowedError" || name === "SecurityError") return "denied";
    return "failed";
  }
}
