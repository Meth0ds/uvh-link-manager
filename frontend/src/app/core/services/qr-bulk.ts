import { exportQr, exportQrA4 } from "./qr-exporter";
import type { QrDesignSpec, QrExportOptions, QrPrintOptions } from "./qr-design";
import type { QrLinkSnapshot } from "./qr-library.service";

const MAX_BYTES = 64 * 1024 * 1024;
export function qrFilename(link: QrLinkSnapshot, extension: "png" | "svg"): string {
  const alias = link.alias.normalize("NFKD").replace(/[^a-zA-Z0-9_-]/g, "-").replace(/-+/g, "-").replace(/^-|-$/g, "").slice(0, 70) || "enlace";
  return `uvh-${link.id}-${alias}.${extension}`;
}

/** Called in the dedicated worker. Each bitmap is released before the next is generated. */
export async function exportQrBulk(links: readonly QrLinkSnapshot[], spec: QrDesignSpec, format: "png" | "svg" | "pdf", options: QrExportOptions = {}, print: QrPrintOptions = { sizeMm: 35, copies: 1, cutMarks: false }, progress?: (done: number, total: number) => void): Promise<Blob> {
  if (!links.length || links.length > 100 || new Set(links.map(link => link.id)).size !== links.length) throw new Error("Selecciona entre 1 y 100 enlaces únicos.");
  options.signal?.throwIfAborted();
  if (format === "pdf") return exportQrA4(links.map(link => link.shortUrl), spec, print, options, progress);
  const { Zip, ZipPassThrough, strToU8 } = await import("fflate");
  const chunks: Uint8Array<ArrayBuffer>[] = [];
  let size = 0, generated = 0;
  let failure: Error | undefined;
  let resolveZip!: () => void;
  const ready = new Promise<void>(resolve => resolveZip = resolve);
  const zip = new Zip((error, chunk, final) => {
    if (error) failure = error;
    if (chunk) { size += chunk.length; if (size > MAX_BYTES) failure = new Error("El ZIP supera 64 MB. Reduce la resolución, el logo o el número de enlaces."); else chunks.push(new Uint8Array(chunk)); }
    if (final) resolveZip();
  });
  const manifest: { file: string; linkId: number; alias: string; shortUrl: string; state: string }[] = [];
  try {
    for (const link of links) {
      options.signal?.throwIfAborted();
      const file = qrFilename(link, format), blob = await exportQr(link.shortUrl, spec, format, options);
      generated += blob.size;
      if (generated > MAX_BYTES) throw new Error("El lote supera 64 MB. Reduce la resolución, el logo o el número de enlaces.");
      const entry = new ZipPassThrough(file); zip.add(entry); entry.push(new Uint8Array(await blob.arrayBuffer()), true);
      if (failure) throw failure;
      manifest.push({ file, linkId: link.id, alias: link.alias, shortUrl: link.shortUrl, state: link.state });
      progress?.(manifest.length, links.length);
    }
    const manifestEntry = new ZipPassThrough("manifest.json"); zip.add(manifestEntry);
    manifestEntry.push(strToU8(JSON.stringify({ version: 1, createdAt: new Date().toISOString(), links: manifest }, null, 2)), true);
    zip.end(); await ready;
    options.signal?.throwIfAborted();
    if (failure) throw failure;
    return new Blob(chunks, { type: "application/zip" });
  } catch (error) { zip.terminate(); chunks.length = 0; throw error; }
}
