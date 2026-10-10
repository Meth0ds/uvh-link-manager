import QRCode from "qrcode";
import type { QrCodeRenderOptions } from "./qr-code.service";
import { paintQrBrand } from "./qr-brand";

/** This module and the generator are loaded together only on a QR action. */
export async function renderQr(text: string, options: QrCodeRenderOptions): Promise<string> {
  const { includeLogo = true, customLogo, ...qrOptions } = options;
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
  // qrcode floors moduleCount * (width / moduleCount). Floating-point
  // rounding can lose one pixel; restore it as white paper, never rescale data.
  const requestedWidth = qrOptions.width;
  if (typeof requestedWidth === "number" && Number.isInteger(requestedWidth) && requestedWidth === canvas.width + 1) {
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height);
    canvas.width = requestedWidth;
    canvas.height = requestedWidth;
    context.fillStyle = "#FFFFFF";
    context.fillRect(0, 0, requestedWidth, requestedWidth);
    context.putImageData(pixels, 0, 0);
  }
  if (includeLogo) {
    // Larger quiet zones shrink the code within the canvas. Keep the badge's
    // footprint in modules equal to its default, rather than covering more data.
    const modules = margin > 4 ? QRCode.create(text, { ...qrOptions, errorCorrectionLevel: "H" }).modules.size : 0;
    const relativeScale = margin > 4 ? (modules + 8) / (modules + margin * 2) : 1;
    if (customLogo) {
      const available = canvas.width * relativeScale * 0.20;
      const padding = canvas.width * relativeScale * 0.035;
      const scale = available / Math.max(customLogo.width, customLogo.height);
      const width = customLogo.width * scale, height = customLogo.height * scale;
      const plateWidth = width + padding * 2, plateHeight = height + padding * 2;
      context.save();
      context.fillStyle = "#FFFFFF";
      context.beginPath();
      context.roundRect((canvas.width - plateWidth) / 2, (canvas.height - plateHeight) / 2, plateWidth, plateHeight, Math.min(plateWidth, plateHeight) * 0.12);
      context.fill();
      context.imageSmoothingEnabled = true;
      context.imageSmoothingQuality = "high";
      context.drawImage(customLogo, (canvas.width - width) / 2, (canvas.height - height) / 2, width, height);
      context.restore();
    } else {
      paintQrBrand(context, canvas.width, relativeScale);
    }
  }
  return canvas.toDataURL("image/png");
}
