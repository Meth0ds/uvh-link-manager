import QRCode from "qrcode";
import { QR_BRAND_DOT, QR_BRAND_LETTERS } from "./qr-brand";
import { qrExtent, validateQrDesign, type QrDesignSpec, type QrRasterLogo } from "./qr-design";
import type { Font } from "@pdf-lib/fontkit";

export type QrTransform = [number, number, number, number, number, number];
export type QrShape =
  | { kind: "rect"; x: number; y: number; width: number; height: number; fill: string }
  | { kind: "path"; path: string; transform: QrTransform; fill: string }
  | { kind: "image"; x: number; y: number; width: number; height: number; logo: QrRasterLogo };
export interface QrScene {
  width: number; height: number; modules: number; shapes: QrShape[];
  caption?: { text: string; x: number; baseline: number; size: number; fill: string };
}

export function qrModuleCount(url: string, design: QrDesignSpec): number {
  const spec = validateQrDesign(design);
  return QRCode.create(url, { errorCorrectionLevel: spec.correction }).modules.size;
}

function roundedPath(x: number, y: number, w: number, h: number, r: number): string {
  return `M${x + r} ${y}H${x + w - r}Q${x + w} ${y} ${x + w} ${y + r}V${y + h - r}Q${x + w} ${y + h} ${x + w - r} ${y + h}H${x + r}Q${x} ${y + h} ${x} ${y + h - r}V${y + r}Q${x} ${y} ${x + r} ${y}Z`;
}

/** Units are always 1/1000 of the QR square, including its quiet zone. */
export function createQrScene(url: string, value: QrDesignSpec, logo?: QrRasterLogo, font?: Font): QrScene {
  const design = validateQrDesign(value), extent = qrExtent(design);
  const matrix = QRCode.create(url, { errorCorrectionLevel: design.correction }).modules;
  const pitch = 1000 / (matrix.size + design.quietZone * 2), inset = extent.inset;
  const shapes: QrShape[] = [];
  let caption: QrScene["caption"];
  const rect = (x: number, y: number, width: number, height: number, fill: string) => shapes.push({ kind: "rect", x, y, width, height, fill });
  const path = (path: string, fill: string, transform: QrTransform = [1, 0, 0, 1, 0, 0]) => shapes.push({ kind: "path", path, fill, transform });
  // Frame stays completely outside the quiet zone. Four physical white modules
  // are retained even if the user chooses an off-white background for the code.
  rect(0, 0, extent.width, extent.height, "#FFFFFF");
  if (design.frame !== "none") {
    rect(0, 0, extent.width, 2, design.foreground);
    rect(0, extent.height - 2, extent.width, 2, design.foreground);
    rect(0, 0, 2, extent.height, design.foreground);
    rect(extent.width - 2, 0, 2, extent.height, design.foreground);
  }
  const start = inset + pitch * design.quietZone;
  rect(start, start, matrix.size * pitch, matrix.size * pitch, design.background);
  // Horizontal runs reduce vector size without changing module geometry.
  for (let row = 0; row < matrix.size; row++) {
    for (let col = 0; col < matrix.size; col++) {
      if (!matrix.get(row, col)) continue;
      const first = col;
      while (col + 1 < matrix.size && matrix.get(row, col + 1)) col++;
      rect(start + first * pitch, start + row * pitch, (col - first + 1) * pitch, pitch, design.foreground);
    }
  }
  if (design.logo.kind !== "none") {
    const center = inset + 500, relative = (matrix.size + 8) / (matrix.size + design.quietZone * 2);
    if (design.logo.kind === "custom") {
      if (!logo || !Number.isInteger(logo.width) || !Number.isInteger(logo.height) || logo.width < 1 || logo.height < 1 || logo.width > 1024 || logo.height > 1024 || logo.png.byteLength > 8 * 1024 * 1024) throw new Error("Falta un logo normalizado válido.");
      const scale = 200 * relative / Math.max(logo.width, logo.height), width = logo.width * scale, height = logo.height * scale, padding = 35 * relative;
      path(roundedPath(center - width / 2 - padding, center - height / 2 - padding, width + 2 * padding, height + 2 * padding, Math.min(width + 2 * padding, height + 2 * padding) * 0.12), "#FFFFFF");
      shapes.push({ kind: "image", x: center - width / 2, y: center - height / 2, width, height, logo });
    } else {
      const surround = Math.round(relative * 270), badge = Math.round(relative * 220);
      path(roundedPath(center - surround / 2, center - surround / 2, surround, surround, relative * 47), "#FFFFFF");
      path(roundedPath(center - badge / 2, center - badge / 2, badge, badge, relative * 25), "#262821");
      const scale = relative * 185 / 3476;
      const transform: QrTransform = [scale, 0, 0, -scale, center - 1858 * scale, center + 704 * scale];
      path(QR_BRAND_LETTERS, "#FFFFFF", transform);
      path(QR_BRAND_DOT, "#F79573", transform);
    }
  }
  if (design.frame === "caption" && design.caption) {
    if (!font) throw new Error("La fuente del marco no está disponible.");
    for (const char of design.caption) if (!font.hasGlyphForCodePoint(char.codePointAt(0)!)) throw new Error(`La fuente del marco no admite el carácter «${char}».`);
    const run = font.layout(design.caption);
    const advance = run.positions.reduce((sum, position) => sum + position.xAdvance, 0);
    const scale = Math.min(64 / font.unitsPerEm, 920 / Math.max(1, advance));
    let x = (extent.width - advance * scale) / 2;
    caption = { text: design.caption, x, baseline: inset + 1090, size: scale * font.unitsPerEm, fill: design.foreground };
    for (let i = 0; i < run.glyphs.length; i++) {
      const position = run.positions[i];
      path(run.glyphs[i].path.toSVG(), design.foreground, [scale, 0, 0, -scale, x + position.xOffset * scale, inset + 1090 - position.yOffset * scale]);
      x += position.xAdvance * scale;
    }
  }
  return { width: extent.width, height: extent.height, modules: matrix.size, shapes, caption };
}
