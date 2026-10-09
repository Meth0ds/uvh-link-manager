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
});
