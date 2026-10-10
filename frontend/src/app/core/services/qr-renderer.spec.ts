import QRCode from "qrcode";
import { renderQr } from "./qr-renderer";

describe("Branded QR rendering", () => {
  for (const width of [240, 480, 2048]) {
    it(`exports a ${width}px PNG with the wordmark, opaque paper and high correction`, async () => {
      const generator = spyOn(QRCode, "toCanvas").and.callThrough();
      const png = await renderQr("https://uvh.test/one", { width, margin: 1, errorCorrectionLevel: "M" });
      expect(generator).toHaveBeenCalledTimes(1);
      expect(generator.calls.mostRecent().args[2]).toEqual(jasmine.objectContaining({
        width, margin: 4, errorCorrectionLevel: "H", color: { dark: "#262821", light: "#FFFFFF" },
      }));
      const canvas = generator.calls.mostRecent().args[0] as HTMLCanvasElement;
      expect(canvas.width).toBe(width);
      expect(canvas.height).toBe(width);
      const pixels = canvas.getContext("2d")!.getImageData(0, 0, width, width).data;
      expect([...pixels.slice(0, 4)]).toEqual([255, 255, 255, 255]);
      let accentPixels = 0, opaque = true;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] === 247 && pixels[i + 1] === 149 && pixels[i + 2] === 115) accentPixels++;
        opaque &&= pixels[i + 3] === 255;
      }
      expect(accentPixels).toBeGreaterThan(0);
      expect(opaque).toBeTrue();
      expect(png).toBe(canvas.toDataURL("image/png"));
    });
  }

  it("propagates generation failure without presenting a branded placeholder as a valid QR", async () => {
    const generator = spyOn(QRCode, "toCanvas") as jasmine.Spy;
    generator.and.rejectWith(new Error("Fixture QR failure"));
    await expectAsync(renderQr("https://uvh.test/one", { width: 480 })).toBeRejectedWithError("Fixture QR failure");
  });

  for (const errorCorrectionLevel of ["L", "M", "Q", "H"] as const) {
    it(`exports an intact standard QR with no logo and correction ${errorCorrectionLevel}`, async () => {
      const options = { width: 480, includeLogo: false, errorCorrectionLevel, margin: 6 };
      const text = "https://uvh.test/one";
      const png = await renderQr(text, options);
      const standard = await QRCode.toDataURL(text, { width: 480, errorCorrectionLevel, margin: 6, color: { dark: "#000000", light: "#FFFFFF" } });
      expect(png).toBe(standard);
    });
  }

  it("protects branded correction and the minimum quiet zone even when callers request unsafe options", async () => {
    const generator = spyOn(QRCode, "toCanvas").and.callThrough();
    await renderQr("https://uvh.test/one", { width: 480, includeLogo: true, errorCorrectionLevel: "L", margin: 0 });
    expect(generator.calls.mostRecent().args[2]).toEqual(jasmine.objectContaining({ margin: 4, errorCorrectionLevel: "H" }));
    await renderQr("https://uvh.test/one", { width: 480, includeLogo: false, margin: NaN });
    expect(generator.calls.mostRecent().args[2]).toEqual(jasmine.objectContaining({ margin: 4 }));
  });
  for (const [width, height] of [[200, 100], [100, 200], [120, 120]]) {
    it(`fits a ${width}x${height} custom logo without stretching or a UVH badge`, async () => {
      const customLogo = document.createElement("canvas");
      customLogo.width = width; customLogo.height = height;
      const source = customLogo.getContext("2d")!;
      source.fillStyle = "#e14165"; source.fillRect(0, 0, width, height);
      const generator = spyOn(QRCode, "toCanvas").and.callThrough();
      const png = await renderQr("https://uvh.test/custom", { width: 480, includeLogo: true, customLogo, errorCorrectionLevel: "L", margin: 8 });
      const options = generator.calls.mostRecent().args[2];
      expect(options).toEqual(jasmine.objectContaining({ errorCorrectionLevel: "H", margin: 8 }));
      expect(options).not.toEqual(jasmine.objectContaining({ customLogo }));
      const canvas = generator.calls.mostRecent().args[0] as HTMLCanvasElement;
      const pixels = canvas.getContext("2d")!.getImageData(0, 0, 480, 480).data;
      let left = 480, right = 0, top = 480, bottom = 0, accent = 0;
      for (let y = 0; y < 480; y++) for (let x = 0; x < 480; x++) {
        const i = (y * 480 + x) * 4;
        if (pixels[i] === 225 && pixels[i + 1] === 65 && pixels[i + 2] === 101) {
          left = Math.min(left, x); right = Math.max(right, x); top = Math.min(top, y); bottom = Math.max(bottom, y);
        }
        if (pixels[i] === 247 && pixels[i + 1] === 149 && pixels[i + 2] === 115) accent++;
        expect(pixels[i + 3]).toBe(255);
      }
      expect((right - left + 1) / (bottom - top + 1)).toBeCloseTo(width / height, 1);
      expect((left + right) / 2).toBeCloseTo(239.5, 0);
      expect((top + bottom) / 2).toBeCloseTo(239.5, 0);
      expect(right - left + 1).toBeLessThanOrEqual(96);
      expect(bottom - top + 1).toBeLessThanOrEqual(96);
      expect(accent).toBe(0); expect(png).toMatch(/^data:image\/png;base64,/);
    });
  }

  it("omits a custom logo completely when the user chooses the classic QR", async () => {
    const customLogo = document.createElement("canvas"); customLogo.width = 100; customLogo.height = 100;
    const text = "https://uvh.test/classic";
    const plain = await renderQr(text, { width: 480, includeLogo: false, customLogo, errorCorrectionLevel: "M" });
    expect(plain).toBe(await QRCode.toDataURL(text, { width: 480, margin: 4, errorCorrectionLevel: "M", color: { dark: "#000000", light: "#FFFFFF" } }));
  });

  for (const width of [480, 512, 1024, 2048, 4096]) {
    it(`exports exactly ${width}px with every supported margin despite floating point rounding`, async () => {
      for (const margin of [4, 6, 8]) {
        const png = await renderQr("https://enlaces.ejemplo.test/" + "campana-".repeat(20), { width, margin });
        const bytes = Uint8Array.from(atob(png.split(",")[1]), char => char.charCodeAt(0));
        const dimensions = new DataView(bytes.buffer);
        expect(dimensions.getUint32(16)).toBe(width); expect(dimensions.getUint32(20)).toBe(width);
      }
    });
  }

  it("fixes the classic QR's missing pixel with white padding while preserving every original module pixel", async () => {
    const text = "https://enlaces.ejemplo.test/promocion-2026", width = 512, margin = 6;
    const original = document.createElement("canvas");
    await QRCode.toCanvas(original, text, { width, margin, errorCorrectionLevel: "H", color: { dark: "#000000", light: "#FFFFFF" } });
    expect(original.width).toBe(511);
    const expected = original.getContext("2d")!.getImageData(0, 0, 511, 511).data;
    const generator = spyOn(QRCode, "toCanvas").and.callThrough();
    await renderQr(text, { width, margin, includeLogo: false });
    const canvas = generator.calls.mostRecent().args[0] as HTMLCanvasElement;
    expect(canvas.width).toBe(512);
    const actual = canvas.getContext("2d")!.getImageData(0, 0, 511, 511).data;
    expect(actual).toEqual(expected);
    expect([...canvas.getContext("2d")!.getImageData(511, 0, 1, 1).data]).toEqual([255, 255, 255, 255]);
  });

});
