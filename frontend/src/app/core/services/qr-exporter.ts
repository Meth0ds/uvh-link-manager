import { createQrScene, type QrScene } from "./qr-scene";
import { qrPrintLayout, validateQrPhysicalSize, type QrDesignSpec, type QrExportFormat, type QrExportOptions, type QrPrintOptions } from "./qr-design";
import type { Font } from "@pdf-lib/fontkit";
import type { PDFDocument, PDFPage, PDFImage, PDFFont } from "pdf-lib";

const pdfLogos = new WeakMap<PDFDocument, Map<Uint8Array, PDFImage>>();
const pdfFonts = new WeakMap<PDFDocument, PDFFont>();

type QrFontKit = typeof import("@pdf-lib/fontkit");
let fontPromise: Promise<{ bytes: Uint8Array<ArrayBuffer>; font: Font; fontkit: QrFontKit }> | undefined;
export function loadQrFont(): Promise<{ bytes: Uint8Array<ArrayBuffer>; font: Font; fontkit: QrFontKit }> {
  return fontPromise ??= (async () => {
    const [module, response] = await Promise.all([import("@pdf-lib/fontkit"), fetch("/fonts/manrope.ttf", { credentials: "omit", cache: "force-cache" })]);
    if (!response.ok) throw new Error("No se pudo cargar la fuente del QR. Reintenta la descarga.");
    const bytes = new Uint8Array(await response.arrayBuffer());
    // Fontkit publishes a default ESM export but declares named UMD exports.
    // Resolve both package entry points before using the same cached adapter.
    const fontkit = (module as { default?: QrFontKit }).default ?? module;
    return { bytes, font: fontkit.create(bytes), fontkit };
  })().catch(error => { fontPromise = undefined; throw error; });
}

function check(signal?: AbortSignal): void { signal?.throwIfAborted(); }
function base64(bytes: Uint8Array): string {
  let text = "";
  for (let start = 0; start < bytes.length; start += 8192) text += String.fromCharCode(...bytes.subarray(start, start + 8192));
  return btoa(text);
}

export function qrSceneSvg(scene: QrScene): string {
  const body = scene.shapes.map(shape => {
    if (shape.kind === "rect") return `<rect x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" fill="${shape.fill}"/>`;
    if (shape.kind === "path") return `<path d="${shape.path}" fill="${shape.fill}" transform="matrix(${shape.transform.join(" ")})"/>`;
    return `<image x="${shape.x}" y="${shape.y}" width="${shape.width}" height="${shape.height}" href="data:image/png;base64,${base64(shape.logo.png)}"/>`;
  }).join("");
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${scene.width} ${scene.height}" width="${scene.width}" height="${scene.height}" role="img" aria-label="Código QR">${body}</svg>`;
}

export async function qrScenePng(scene: QrScene, pixels = 2048, signal?: AbortSignal): Promise<Blob> {
  if (!Number.isInteger(pixels) || pixels < 240 || pixels > 4096) throw new Error("Resolución de PNG inválida.");
  check(signal);
  const scale = pixels / scene.width, height = Math.round(scene.height * scale);
  const canvas = typeof document === "undefined" ? new OffscreenCanvas(pixels, height) : document.createElement("canvas");
  canvas.width = pixels; canvas.height = height;
  const context = canvas.getContext("2d") as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
  if (!context) throw new Error("No se pudo preparar la imagen.");
  // Align module runs to pixel edges. Vector exports preserve exact fractions.
  for (const shape of scene.shapes) {
    check(signal);
    if (shape.kind === "rect") {
      context.fillStyle = shape.fill;
      const x = Math.round(shape.x * scale), y = Math.round(shape.y * scale);
      context.fillRect(x, y, Math.round((shape.x + shape.width) * scale) - x, Math.round((shape.y + shape.height) * scale) - y);
    } else if (shape.kind === "path") {
      context.save(); context.scale(scale, scale); context.transform(...shape.transform); context.fillStyle = shape.fill;
      context.fill(new Path2D(shape.path)); context.restore();
    } else {
      const bitmap = await createImageBitmap(new Blob([shape.logo.png], { type: "image/png" }));
      try { context.drawImage(bitmap, shape.x * scale, shape.y * scale, shape.width * scale, shape.height * scale); }
      finally { bitmap.close(); }
    }
  }
  check(signal);
  return typeof OffscreenCanvas !== "undefined" && canvas instanceof OffscreenCanvas ? canvas.convertToBlob({ type: "image/png" }) : new Promise((resolve, reject) => (canvas as HTMLCanvasElement).toBlob((blob: Blob | null) => blob ? resolve(blob) : reject(new Error("No se pudo codificar el PNG.")), "image/png"));
}

async function drawScene(doc: PDFDocument, page: PDFPage, scene: QrScene, x: number, top: number, scale: number): Promise<void> {
  const { rgb, pushGraphicsState, popGraphicsState, concatTransformationMatrix } = await import("pdf-lib");
  const color = (hex: string) => rgb(parseInt(hex.slice(1, 3), 16) / 255, parseInt(hex.slice(3, 5), 16) / 255, parseInt(hex.slice(5, 7), 16) / 255);
  for (const shape of scene.shapes) {
    if (shape.kind === "rect") page.drawRectangle({ x: x + shape.x * scale, y: top - (shape.y + shape.height) * scale, width: shape.width * scale, height: shape.height * scale, color: color(shape.fill) });
    else if (shape.kind === "path") {
      const [a, b, c, d, e, f] = shape.transform;
      // drawSvgPath flips its Y axis; composing both transforms restores the
      // exact same top-down scene used by SVG and Canvas, including glyphs.
      page.pushOperators(pushGraphicsState(), concatTransformationMatrix(scale * a, -scale * b, -scale * c, scale * d, x + scale * e, top - scale * f));
      page.drawSvgPath(shape.path, { color: color(shape.fill) });
      page.pushOperators(popGraphicsState());
    } else {
      let images = pdfLogos.get(doc);
      if (!images) { images = new Map(); pdfLogos.set(doc, images); }
      let image = images.get(shape.logo.png);
      if (!image) { image = await doc.embedPng(shape.logo.png); images.set(shape.logo.png, image); }
      page.drawImage(image, { x: x + shape.x * scale, y: top - (shape.y + shape.height) * scale, width: shape.width * scale, height: shape.height * scale });
    }
  }
  if (scene.caption) {
    const font = pdfFonts.get(doc);
    if (!font) throw new Error("La fuente del PDF no está disponible.");
    // Outlines keep the visible caption identical in every format. A searchable
    // text layer also uses the embedded Manrope font, without drawing it twice.
    page.drawText(scene.caption.text, { font, x: x + scene.caption.x * scale,
      y: top - scene.caption.baseline * scale, size: scene.caption.size * scale,
      color: color(scene.caption.fill), opacity: 0 });
  }
}

async function pdfDocument(): Promise<PDFDocument> {
  const [{ PDFDocument, PrintScaling }, { bytes, fontkit }] = await Promise.all([import("pdf-lib"), loadQrFont()]);
  const doc = await PDFDocument.create();
  doc.registerFontkit(fontkit);
  pdfFonts.set(doc, await doc.embedFont(bytes));
  doc.catalog.getOrCreateViewerPreferences().setPrintScaling(PrintScaling.None);
  doc.setCreator("UVH"); doc.setTitle("QR · UVH");
  return doc;
}

export async function exportQr(url: string, design: QrDesignSpec, format: QrExportFormat, options: QrExportOptions = {}): Promise<Blob> {
  check(options.signal);
  const font = design.frame === "caption" && design.caption ? (await loadQrFont()).font : undefined;
  const scene = createQrScene(url, design, options.logo, font);
  check(options.signal);
  if (format === "svg") return new Blob([qrSceneSvg(scene)], { type: "image/svg+xml" });
  if (format === "png") return qrScenePng(scene, options.pixels, options.signal);
  if (format !== "pdf") throw new Error("Formato no admitido.");
  const size = options.sizeMm ?? 35;
  validateQrPhysicalSize(design, scene.modules, size);
  const doc = await pdfDocument(), scale = size / 1000 * 72 / 25.4;
  const page = doc.addPage([scene.width * scale, scene.height * scale]);
  await drawScene(doc, page, scene, 0, page.getHeight(), scale);
  check(options.signal);
  return new Blob([new Uint8Array(await doc.save())], { type: "application/pdf" });
}

export async function exportQrA4(urls: readonly string[], design: QrDesignSpec, print: QrPrintOptions, options: QrExportOptions = {}, progress?: (done: number, total: number) => void): Promise<Blob> {
  if (!urls.length || urls.length > 100) throw new Error("Selecciona entre 1 y 100 enlaces.");
  check(options.signal);
  const font = design.frame === "caption" && design.caption ? (await loadQrFont()).font : undefined;
  const scenes = urls.map(url => createQrScene(url, design, options.logo, font));
  const largest = Math.max(...scenes.map(scene => scene.modules));
  const layout = qrPrintLayout(design, largest, print), doc = await pdfDocument(), pt = 72 / 25.4;
  const count = urls.length === 1 ? layout.copies : urls.length;
  let page: PDFPage | undefined;
  for (let i = 0; i < count; i++) {
    check(options.signal);
    if (i % layout.perPage === 0) page = doc.addPage([210 * pt, 297 * pt]);
    const slot = i % layout.perPage, col = slot % layout.columns, row = Math.floor(slot / layout.columns);
    const x = (10 + col * (layout.widthMm + 5)) * pt, top = (297 - 10 - row * (layout.heightMm + 5)) * pt;
    await drawScene(doc, page!, scenes[urls.length === 1 ? 0 : i], x, top, print.sizeMm / 1000 * pt);
    if (print.cutMarks) {
      const { grayscale } = await import("pdf-lib");
      const w = layout.widthMm * pt, h = layout.heightMm * pt, gap = 0.5 * pt, mark = 2 * pt;
      for (const cx of [x, x + w]) for (const cy of [top, top - h]) {
        const dx = cx === x ? -1 : 1, dy = cy === top ? 1 : -1;
        page!.drawLine({ start: { x: cx + dx * gap, y: cy }, end: { x: cx + dx * (gap + mark), y: cy }, thickness: 0.25, color: grayscale(0.5) });
        page!.drawLine({ start: { x: cx, y: cy + dy * gap }, end: { x: cx, y: cy + dy * (gap + mark) }, thickness: 0.25, color: grayscale(0.5) });
      }
    }
    progress?.(i + 1, count);
  }
  check(options.signal);
  const bytes = new Uint8Array(await doc.save());
  if (bytes.byteLength > 64 * 1024 * 1024) throw new Error("El PDF supera el límite de 64 MB. Reduce el lote o el logo.");
  return new Blob([bytes], { type: "application/pdf" });
}
