import {
  decodeReportResponse,
  decodePublicReport,
  decodeSocialPreview,
} from "./sharing-decoders";
const publicReport = {
  version: 1,
  title: "Resultados",
  description: "",
  sections: ["visits", "series"],
  labels: ["Promoción"],
  from: "2026-10-01T00:00:00Z",
  to: "2026-10-14T00:00:00Z",
  updatedAt: "2026-10-14T00:00:00Z",
  retainedFrom: "2026-04-14T00:00:00Z",
  visits: 2,
  series: [{ day: "2026-10-01", visits: 2, available: true }],
  countries: [],
  devices: [],
};
describe("Sharing wire contracts", () => {
  it("projects public report fields and drops destinations and visitor identifiers", () => {
    const decoded = decodePublicReport({
      ...publicReport,
      destination: "https://private.test",
      visitor_hash: "secret",
    });
    expect(decoded.visits).toBe(2);
    expect("destination" in decoded).toBeFalse();
    expect("visitor_hash" in decoded).toBeFalse();
  });
  it("retains unavailable dates as a distinct state", () => {
    expect(
      decodePublicReport({
        ...publicReport,
        series: [{ day: "2026-10-01", visits: 0, available: false }],
      }).series[0].available,
    ).toBeFalse();
  });
  it("rejects duplicate and unknown public sections", () => {
    expect(() =>
      decodePublicReport({ ...publicReport, sections: ["visits", "visits"] }),
    ).toThrow();
    expect(() =>
      decodePublicReport({ ...publicReport, sections: ["destinations"] }),
    ).toThrow();
  });
  it("rejects oversized series and malformed counts", () => {
    expect(() => decodePublicReport({ ...publicReport, visits: -1 })).toThrow();
    expect(() =>
      decodePublicReport({
        ...publicReport,
        series: Array(183).fill(publicReport.series[0]),
      }),
    ).toThrow();
  });
  it("rejects invalid dates and control characters", () => {
    expect(() =>
      decodePublicReport({ ...publicReport, from: "bad" }),
    ).toThrow();
    expect(() =>
      decodePublicReport({ ...publicReport, title: "Title\u0000" }),
    ).toThrow();
  });
  it("tolerates older links without social configuration", () => {
    expect(decodeSocialPreview(undefined)).toBeNull();
    expect(decodeSocialPreview(null)).toBeNull();
  });
  it("checks social asset IDs, text bounds and versions", () => {
    const value = {
      version: 1,
      enabled: true,
      title: "Hello",
      description: null,
      imageAssetId: 3,
      imageAlt: null,
    };
    expect(decodeSocialPreview(value)?.imageAssetId).toBe(3);
    expect(() =>
      decodeSocialPreview({ ...value, imageAssetId: "3" }),
    ).toThrow();
    expect(() =>
      decodeSocialPreview({ ...value, title: "x".repeat(121) }),
    ).toThrow();
    expect(() => decodeSocialPreview({ ...value, version: 2 })).toThrow();
  });
  it("rejects non-HTTP sharing URLs", () => {
    expect(() =>
      decodeReportResponse({
        report: {
          id: 1,
          publicId: "x",
          version: 1,
          spec: {
            version: 1,
            title: "Results",
            description: "",
            period: "30d",
            from: null,
            to: null,
            sections: ["visits"],
          },
          links: [],
          passwordProtected: false,
          expiresAt: null,
          state: "active",
          shareUrl: "javascript:alert(1)",
        },
      }),
    ).toThrow();
  });
});
