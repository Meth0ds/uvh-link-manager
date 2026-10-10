/// <reference lib="webworker" />
import { exportQr, exportQrA4 } from "./qr-exporter";
import { exportQrBulk } from "./qr-bulk";
import type { QrDesignSpec, QrExportFormat, QrExportOptions, QrPrintOptions } from "./qr-design";
import type { QrLinkSnapshot } from "./qr-library.service";

export type QrWorkerRequest =
  | { kind: "single"; url: string; spec: QrDesignSpec; format: QrExportFormat; options: Omit<QrExportOptions, "signal"> }
  | { kind: "print"; urls: readonly string[]; spec: QrDesignSpec; print: QrPrintOptions; options: Omit<QrExportOptions, "signal"> }
  | { kind: "bulk"; links: readonly QrLinkSnapshot[]; spec: QrDesignSpec; format: QrExportFormat; print: QrPrintOptions; options: Omit<QrExportOptions, "signal"> };

addEventListener("message", async ({ data }: MessageEvent<QrWorkerRequest>) => {
  try {
    const progress = (done: number, total: number) => postMessage({ kind: "progress", done, total });
    const blob = data.kind === "single" ? await exportQr(data.url, data.spec, data.format, data.options)
      : data.kind === "print" ? await exportQrA4(data.urls, data.spec, data.print, data.options, progress)
        : await exportQrBulk(data.links, data.spec, data.format, data.options, data.print, progress);
    postMessage({ kind: "done", blob });
  } catch (error) { postMessage({ kind: "error", message: error instanceof Error ? error.message : "No se pudo preparar el archivo QR." }); }
});
