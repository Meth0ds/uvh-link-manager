import QRCode from "qrcode";
import type { QrCodeRenderOptions } from "./qr-code.service";
import { paintQrBrand } from "./qr-brand";

/** This module and the generator are loaded together only on a QR action. */
export async function renderQr(text: string, options: QrCodeRenderOptions): Promise<string> {
  const { includeLogo = true, ...qrOptions } = options;
  const margin = Number.isFinite(qrOptions.margin) ? Math.min(8, Math.max(4, Math.floor(qrOptions.margin!))) : 4;
  const canvas = document.createElement("canvas");
  await QRCode.toCanvas(canvas, text, {
    ...qrOptions,
    errorCorrectionLevel: includeLogo ? "H" : (qrOptions.errorCorrectionLevel ?? "H"),
    margin,
    color: { dark: includeLogo ? "#262821" : "#000000", light: "#FFFFFF" },
  });
  const context = canvas.getContext("2d");
  if (!context) throw new Error("QR canvas unavailable");
  if (includeLogo) {
    // Larger quiet zones shrink the code within the canvas. Keep the badge's
    // footprint in modules equal to its default, rather than covering more data.
    const modules = margin > 4 ? QRCode.create(text, { ...qrOptions, errorCorrectionLevel: "H" }).modules.size : 0;
    const relativeScale = margin > 4 ? (modules + 8) / (modules + margin * 2) : 1;
    paintQrBrand(context, canvas.width, relativeScale);
  }
  return canvas.toDataURL("image/png");
}
