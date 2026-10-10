/** Persisted independently of any link. Canvas, URLs and file bytes are never part of this contract. */
export interface QrDesignSpec {
  version: 1;
  foreground: string;
  background: string;
  correction: "L" | "M" | "Q" | "H";
  quietZone: 4 | 6 | 8;
  logo: { kind: "none" } | { kind: "uvh" } | { kind: "custom"; assetId: number | null };
  frame: "none" | "border" | "caption";
  caption: string;
}

export const DEFAULT_QR_DESIGN: Readonly<QrDesignSpec> = Object.freeze({
  version: 1, foreground: "#262821", background: "#FFFFFF", correction: "H", quietZone: 4,
  logo: Object.freeze({ kind: "uvh" }), frame: "none", caption: "",
});

export function qrLuminance(hex: string): number {
  const channels = [1, 3, 5].map(offset => {
    const value = parseInt(hex.slice(offset, offset + 2), 16) / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  });
  return channels[0] * 0.2126 + channels[1] * 0.7152 + channels[2] * 0.0722;
}

export function qrContrast(foreground: string, background: string): number {
  return (qrLuminance(background) + 0.05) / (qrLuminance(foreground) + 0.05);
}

/** Also called at export boundaries; DOM controls are not a validation boundary. */
export function validateQrDesign(value: unknown): QrDesignSpec {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("Diseño QR inválido.");
  const input = value as Record<string, unknown>;
  const keys = ["version", "foreground", "background", "correction", "quietZone", "logo", "frame", "caption"];
  if (Object.keys(input).some(key => !keys.includes(key)) || keys.some(key => !(key in input))) throw new Error("El diseño contiene campos no admitidos.");
  if (input.version !== 1) throw new Error("Versión de diseño no compatible.");
  const color = (value: unknown): value is string => typeof value === "string" && /^#[\da-f]{6}$/i.test(value);
  if (!color(input.foreground) || !color(input.background)) throw new Error("Usa colores sólidos sin transparencia.");
  if (qrLuminance(input.background) < 0.8 || qrContrast(input.foreground, input.background) < 7) throw new Error("Elige módulos oscuros sobre un fondo claro, con contraste mínimo de 7:1.");
  if (!["L", "M", "Q", "H"].includes(String(input.correction)) || ![4, 6, 8].includes(Number(input.quietZone)) || typeof input.quietZone !== "number") throw new Error("Redundancia o margen inválidos.");
  if (!["none", "border", "caption"].includes(String(input.frame))) throw new Error("Marco inválido.");
  if (typeof input.caption !== "string" || [...input.caption].length > 80 || /[<>\p{Cc}\p{Cf}]/u.test(input.caption)) throw new Error("El texto admite hasta 80 caracteres, sin HTML ni caracteres de control.");
  const logo = input.logo as Record<string, unknown> | null;
  if (!logo || typeof logo !== "object" || Array.isArray(logo) || !["none", "uvh", "custom"].includes(String(logo.kind)) || Object.keys(logo).some(key => !["kind", ...(logo.kind === "custom" ? ["assetId"] : [])].includes(key))) throw new Error("Logo inválido.");
  if (logo.kind === "custom" && logo.assetId !== null && (!Number.isSafeInteger(logo.assetId) || Number(logo.assetId) < 1)) throw new Error("Logo inválido.");
  return {
    version: 1, foreground: input.foreground.toUpperCase(), background: input.background.toUpperCase(),
    correction: logo.kind === "none" ? input.correction as QrDesignSpec["correction"] : "H",
    quietZone: input.quietZone as QrDesignSpec["quietZone"],
    logo: logo.kind === "custom" ? { kind: "custom", assetId: logo.assetId as number | null } : { kind: logo.kind as "none" | "uvh" },
    frame: input.frame as QrDesignSpec["frame"], caption: input.caption.trim(),
  };
}

export interface QrRasterLogo { png: Uint8Array<ArrayBuffer>; width: number; height: number }
export type QrExportFormat = "png" | "svg" | "pdf";
export interface QrExportOptions { pixels?: number; sizeMm?: number; logo?: QrRasterLogo; signal?: AbortSignal }

/** Sizes refer to the square QR including its quiet zone, not the surrounding frame. */
export function qrExtent(design: QrDesignSpec): { width: number; height: number; inset: number } {
  const inset = design.frame === "none" ? 0 : 20;
  return { width: 1000 + inset * 2, height: 1000 + inset * 2 + (design.frame === "caption" ? 160 : 0), inset };
}

export interface QrPrintOptions { sizeMm: number; copies: number | "page"; cutMarks: boolean }
export interface QrPrintLayout { columns: number; rows: number; perPage: number; copies: number; pages: number; widthMm: number; heightMm: number; minimumMm: number }

export function validateQrPhysicalSize(design: QrDesignSpec, modules: number, sizeMm: number): number {
  const minimumMm = Math.ceil((modules + design.quietZone * 2) * 0.4 * 10) / 10;
  if (!Number.isFinite(sizeMm) || sizeMm < minimumMm) throw new Error(`Este QR necesita al menos ${minimumMm} mm para que cada módulo mida 0,4 mm.`);
  if (sizeMm > 1000) throw new Error("El tamaño máximo del QR es de 1000 mm.");
  return minimumMm;
}

export function qrPrintLayout(design: QrDesignSpec, modules: number, options: QrPrintOptions): QrPrintLayout {
  const minimumMm = validateQrPhysicalSize(design, modules, options.sizeMm);
  const extent = qrExtent(design);
  const widthMm = options.sizeMm * extent.width / 1000, heightMm = options.sizeMm * extent.height / 1000;
  const columns = Math.floor((190 + 5) / (widthMm + 5)), rows = Math.floor((277 + 5) / (heightMm + 5));
  if (columns < 1 || rows < 1) throw new Error("El QR y su marco no caben en una hoja A4 con márgenes de 10 mm.");
  const perPage = columns * rows;
  const copies = options.copies === "page" ? perPage : options.copies;
  if (!Number.isInteger(copies) || copies < 1 || copies > 500) throw new Error("Elige entre 1 y 500 copias.");
  return { columns, rows, perPage, copies, pages: Math.ceil(copies / perPage), widthMm, heightMm, minimumMm };
}
