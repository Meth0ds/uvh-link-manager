export interface QrCustomLogo {
  readonly canvas: HTMLCanvasElement;
  readonly preview: string;
  readonly name: string;
}

const MAX_BYTES = 2 * 1024 * 1024;
const MAX_SIDE = 4096;
const OUTPUT_SIDE = 1024;

function dimensions(bytes: Uint8Array): { width: number; height: number } {
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (bytes.length >= 24 && [137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)
    && view.getUint32(8) === 13 && view.getUint32(12) === 0x49484452) {
    return { width: view.getUint32(16), height: view.getUint32(20) };
  }
  if (bytes[0] === 0xff && bytes[1] === 0xd8) {
    let offset = 2;
    while (offset + 4 <= bytes.length) {
      if (bytes[offset++] !== 0xff) break;
      while (bytes[offset] === 0xff) offset++;
      const marker = bytes[offset++];
      if (marker === 0xd9 || marker === 0xda) break;
      const length = offset + 2 <= bytes.length ? view.getUint16(offset) : 0;
      if (length < 2 || offset + length > bytes.length) break;
      if ([0xc0, 0xc1, 0xc2].includes(marker) && length >= 8) {
        return { height: view.getUint16(offset + 3), width: view.getUint16(offset + 5) };
      }
      offset += length;
    }
  }
  throw new Error("Elige una imagen PNG o JPG válida. SVG y otros formatos no están admitidos.");
}

function checkDimensions(width: number, height: number): void {
  if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) {
    throw new Error("El logo debe medir entre 1 y 4096 píxeles por lado.");
  }
}

/** Local raster input only: no URLs, uploads, HTML or SVG rendering. */
export async function prepareQrCustomLogo(file: File): Promise<QrCustomLogo> {
  if (file.size === 0 || file.size > MAX_BYTES) throw new Error("Elige una imagen de hasta 2 MB.");
  const bytes = new Uint8Array(await file.arrayBuffer());
  const { width, height } = dimensions(bytes);
  checkDimensions(width, height);
  let bitmap: ImageBitmap;
  try {
    // The signature, rather than the user-controlled filename/MIME, chooses the decoder.
    bitmap = await createImageBitmap(new Blob([bytes], { type: bytes[0] === 137 ? "image/png" : "image/jpeg" }));
  } catch {
    throw new Error("No se pudo leer la imagen. Prueba con otro archivo PNG o JPG.");
  }
  try {
    checkDimensions(bitmap.width, bitmap.height);
    const scale = Math.min(1, OUTPUT_SIDE / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * scale));
    canvas.height = Math.max(1, Math.round(bitmap.height * scale));
    const context = canvas.getContext("2d");
    if (!context) throw new Error("No se pudo preparar la imagen en este navegador.");
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    // Reject invisible images, and remove transparent padding without cropping the artwork.
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let left = canvas.width, right = -1, top = canvas.height, bottom = -1;
    for (let y = 0; y < canvas.height; y++) {
      for (let x = 0; x < canvas.width; x++) {
        if (pixels[(y * canvas.width + x) * 4 + 3] > 0) {
          left = Math.min(left, x); right = Math.max(right, x);
          top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
      }
    }
    if (right < left) throw new Error("La imagen es completamente transparente. Elige un logo visible.");
    const cropped = document.createElement("canvas");
    cropped.width = right - left + 1; cropped.height = bottom - top + 1;
    const croppedContext = cropped.getContext("2d");
    if (!croppedContext) throw new Error("No se pudo preparar la imagen en este navegador.");
    croppedContext.drawImage(canvas, left, top, cropped.width, cropped.height, 0, 0, cropped.width, cropped.height);
    const name = file.name.replace(/[\p{Cc}\p{Cf}]/gu, "").slice(0, 100) || "Mi logo";
    return { canvas: cropped, preview: cropped.toDataURL("image/png"), name };
  } finally {
    bitmap.close();
  }
}
