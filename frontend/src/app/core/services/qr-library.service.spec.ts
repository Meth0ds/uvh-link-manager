import { DEFAULT_QR_DESIGN } from "./qr-design";
import { decodeQrComparison, decodeSavedQr } from "./qr-library.service";
import { qrFilename } from "./qr-bulk";

const saved = { id: 1, name: "Carta", spec: DEFAULT_QR_DESIGN, version: 1, createdAt: "2026-10-10", updatedAt: "2026-10-10" };
const variant = { ...saved, linkId: 3, publicId: "a".repeat(32), archived: false, visits: 2, attributedPercentage: 100 };
const comparison = {
  from: "2026-10-09", to: "2026-10-10", timezone: "UTC", attributedVisits: 2, unattributedVisits: 1, variants: [variant],
  series: [
    { day: "2026-10-09", hasData: false, visits: null, unattributed: null, variants: [{ id: 1, visits: null }] },
    { day: "2026-10-10", hasData: true, visits: 3, unattributed: 1, variants: [{ id: 1, visits: 2 }] },
  ],
};

describe("QR library response boundaries", () => {
  it("accepts the versioned workspace design and distinct missing dates", () => {
    expect(decodeSavedQr(saved).spec).toEqual(DEFAULT_QR_DESIGN);
    expect(decodeQrComparison(comparison).series[0].visits).toBeNull();
  });
  it("rejects malformed records and manipulated statistics", () => {
    for (const value of [null, [], { ...saved, id: "1" }, { ...saved, name: "x\u202e" }, { ...saved, spec: { ...DEFAULT_QR_DESIGN, url: "https://bad.test" } }]) {
      expect(() => decodeSavedQr(value)).toThrow();
    }
    for (const patch of [
      { attributedVisits: -1 }, { attributedVisits: 3 }, { timezone: "Europe/Madrid" }, { from: "2026-02-30" },
      { variants: [{ ...variant, attributedPercentage: 50 }] }, { variants: [variant, variant] }, { series: [] },
      { series: [{ ...comparison.series[1], day: "2026-10-09" }, comparison.series[1]] },
      { series: [{ ...comparison.series[0], visits: 0 }, comparison.series[1]] },
    ]) expect(() => decodeQrComparison({ ...comparison, ...patch })).toThrow();
  });
  it("uses unique safe filenames even for identical aliases and traversal text", () => {
    const link = { id: 5, alias: "../../Carta<>\u0000", shortUrl: "https://uvh.es/a", state: "active" };
    expect(qrFilename(link, "svg")).toMatch(/^uvh-5-[A-Za-z0-9_-]+\.svg$/);
    expect(qrFilename(link, "png")).not.toBe(qrFilename({ ...link, id: 6 }, "png"));
  });
});
