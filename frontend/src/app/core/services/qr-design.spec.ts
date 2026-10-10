import { DEFAULT_QR_DESIGN, qrContrast, qrPrintLayout, validateQrPhysicalSize, validateQrDesign } from "./qr-design";
import { createQrScene } from "./qr-scene";

describe("QR design trust boundary and physical layout", () => {
  it("copies and normalizes designs without retaining mutable input", () => {
    const value = { ...DEFAULT_QR_DESIGN, foreground: "#262821", logo: { kind: "none" as const }, correction: "M" as const };
    const spec = validateQrDesign(value);
    expect(spec.correction).toBe("M"); expect(spec).not.toBe(value); expect(spec.logo).not.toBe(value.logo);
    expect(qrContrast(spec.foreground, spec.background)).toBeGreaterThan(7);
  });
  it("forces H for both kinds of logos", () => {
    expect(validateQrDesign({ ...DEFAULT_QR_DESIGN, correction: "L" }).correction).toBe("H");
    expect(validateQrDesign({ ...DEFAULT_QR_DESIGN, logo: { kind: "custom", assetId: 8 }, correction: "L" }).correction).toBe("H");
  });
  it("rejects external URLs, HTML, control characters, alpha, reversed colors and malformed assets", () => {
    const invalid = [
      { url: "https://evil.test" }, { caption: "<script>" }, { caption: "text\u202e" }, { caption: "x".repeat(81) },
      { foreground: "#00000000" }, { foreground: "#AAAAAA" }, { foreground: "#FFFFFF", background: "#000000" },
      { background: "#999999" }, { quietZone: "4" }, { quietZone: 1 }, { version: 2 },
      { logo: { kind: "uvh", url: "https://evil.test" } }, { logo: { kind: "custom", assetId: -1 } },
    ];
    for (const extra of invalid) expect(() => validateQrDesign({ ...DEFAULT_QR_DESIGN, ...extra })).toThrow();
  });
  it("keeps frames outside the entire quiet zone", () => {
    const scene = createQrScene("https://uvh.es/prueba", { ...DEFAULT_QR_DESIGN, frame: "border" });
    expect(scene.width).toBe(1040); expect(scene.height).toBe(1040);
    const background = scene.shapes[5];
    expect(background.kind).toBe("rect");
    if (background.kind === "rect") expect(background.x).toBeCloseTo(20 + 4000 / (scene.modules + 8), 8);
  });
  it("uses millimetres, caption height and a pitch of at least 0.4mm", () => {
    const layout = qrPrintLayout({ ...DEFAULT_QR_DESIGN, frame: "caption" }, 29, { sizeMm: 35, copies: 500, cutMarks: true });
    expect(layout.widthMm).toBeCloseTo(36.4); expect(layout.heightMm).toBeCloseTo(42);
    expect(layout.columns).toBe(4); expect(layout.rows).toBe(6); expect(layout.pages).toBe(21);
    expect(layout.minimumMm).toBe(14.8);
    expect(() => qrPrintLayout(DEFAULT_QR_DESIGN, 177, { sizeMm: 35, copies: 1, cutMarks: false })).toThrowError(/74/);
    expect(() => qrPrintLayout(DEFAULT_QR_DESIGN, 29, { sizeMm: 195, copies: 1, cutMarks: false })).toThrow();
    expect(() => qrPrintLayout(DEFAULT_QR_DESIGN, 29, { sizeMm: 35, copies: 501, cutMarks: false })).toThrow();
    expect(qrPrintLayout(DEFAULT_QR_DESIGN, 29, { sizeMm: 35, copies: "page", cutMarks: false }).pages).toBe(1);
  });
  it("allows large single PDFs while retaining the A4 fit constraint", () => {
    expect(validateQrPhysicalSize(DEFAULT_QR_DESIGN, 29, 300)).toBe(14.8);
    expect(() => qrPrintLayout(DEFAULT_QR_DESIGN, 29, { sizeMm: 300, copies: 1, cutMarks: false })).toThrow();
  });

});
