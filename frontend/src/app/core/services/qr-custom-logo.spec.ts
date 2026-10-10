import { prepareQrCustomLogo } from "./qr-custom-logo";

async function raster(type = "image/png", transparent = false): Promise<File> {
  const canvas = document.createElement("canvas");
  canvas.width = 200; canvas.height = 100;
  if (!transparent) {
    const context = canvas.getContext("2d")!;
    context.fillStyle = "#e14165";
    context.fillRect(20, 10, 160, 80);
  }
  const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), type));
  return new File([blob], "logo.png", { type });
}

describe("Local QR logo preparation", () => {
  for (const type of ["image/png", "image/jpeg"]) {
    it(`decodes a real ${type} independently of its declared MIME and filename`, async () => {
      const file = await raster(type);
      const close = spyOn(ImageBitmap.prototype, "close").and.callThrough();
      const logo = await prepareQrCustomLogo(new File([file], "<logo>.txt", { type: "text/plain" }));
      expect(logo.preview).toMatch(/^data:image\/png;base64,/);
      expect(logo.name).toBe("<logo>.txt");
      expect(logo.canvas.width / logo.canvas.height).toBe(2);
      expect(close).toHaveBeenCalledTimes(1);
      expect(logo.canvas.width).toBe(type === "image/png" ? 160 : 200);
    });
  }

  for (const content of ["<svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>", "not an image", "GIF89a"] ) {
    it(`rejects unsupported bytes even when declared as PNG: ${content.slice(0, 6)}`, async () => {
      const decode = spyOn(window, "createImageBitmap").and.callThrough();
      await expectAsync(prepareQrCustomLogo(new File([content], "logo.png", { type: "image/png" }))).toBeRejectedWithError(/PNG o JPG válida/);
      expect(decode).not.toHaveBeenCalled();
    });
  }

  it("rejects empty and oversized input before reading or decoding", async () => {
    const decode = spyOn(window, "createImageBitmap").and.callThrough();
    for (const file of [new File([], "empty.png"), new File([new Uint8Array(2 * 1024 * 1024 + 1)], "large.png")]) {
      const read = spyOn(file, "arrayBuffer").and.callThrough();
      await expectAsync(prepareQrCustomLogo(file)).toBeRejectedWithError(/hasta 2 MB/);
      expect(read).not.toHaveBeenCalled();
    }
    expect(decode).not.toHaveBeenCalled();
  });

  it("rejects oversized header dimensions before invoking the decoder", async () => {
    const bytes = new Uint8Array(24);
    bytes.set([137, 80, 78, 71, 13, 10, 26, 10]);
    const header = new DataView(bytes.buffer);
    header.setUint32(8, 13); header.setUint32(12, 0x49484452);
    header.setUint32(16, 100000); header.setUint32(20, 100000);
    const decode = spyOn(window, "createImageBitmap").and.callThrough();
    await expectAsync(prepareQrCustomLogo(new File([bytes], "bomb.png"))).toBeRejectedWithError(/4096/);
    expect(decode).not.toHaveBeenCalled();
  });

  it("rejects fully transparent images and releases their bitmap", async () => {
    const file = await raster("image/png", true);
    const close = spyOn(ImageBitmap.prototype, "close").and.callThrough();
    await expectAsync(prepareQrCustomLogo(file)).toBeRejectedWithError(/completamente transparente/);
    expect(close).toHaveBeenCalledTimes(1);
  });

  it("checks JPEG dimensions before decoding and rejects broken marker lengths", async () => {
    const oversized = new Uint8Array([0xff, 0xd8, 0xff, 0xc0, 0, 8, 8, 0x20, 0, 0x20, 0, 3]);
    const broken = new Uint8Array([0xff, 0xd8, 0xff, 0xe1, 0xff, 0xff]);
    const decode = spyOn(window, "createImageBitmap").and.callThrough();
    await expectAsync(prepareQrCustomLogo(new File([oversized], "huge.jpg"))).toBeRejectedWithError(/4096/);
    await expectAsync(prepareQrCustomLogo(new File([broken], "broken.jpg"))).toBeRejectedWithError(/PNG o JPG válida/);
    expect(decode).not.toHaveBeenCalled();
  });

  it("removes control and bidirectional formatting characters from the displayed filename", async () => {
    const file = await raster();
    const logo = await prepareQrCustomLogo(new File([file], "brand\u202etxt\u0001.png"));
    expect(logo.name).toBe("brandtxt.png");
  });

  it("reports a controlled decode error for truncated PNG content", async () => {
    const file = await raster();
    await expectAsync(prepareQrCustomLogo(new File([file.slice(0, 24)], "broken.png"))).toBeRejectedWithError(/No se pudo leer/);
  });

  it("bounds the normalized raster and preserves the artwork's proportions", async () => {
    const canvas = document.createElement("canvas");
    canvas.width = 2048; canvas.height = 1024;
    canvas.getContext("2d")!.fillRect(0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>(resolve => canvas.toBlob(blob => resolve(blob!), "image/png"));
    const logo = await prepareQrCustomLogo(new File([blob], "wide.png"));
    expect(logo.canvas.width).toBe(1024); expect(logo.canvas.height).toBe(512);
  });
});
