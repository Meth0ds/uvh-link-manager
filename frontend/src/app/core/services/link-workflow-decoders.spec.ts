import { defaultExpiredPage, emptyLinkFilter } from "../link-workflows";
import { decodeExpiredPage, decodeFavorite, decodeFilterSpec, decodeInspection, decodeSavedFilters, decodeWorkflows } from "./link-workflow-decoders";

describe("link workflow response contracts", () => {
  const id = "2e13970a-5757-4a20-9345-08b42985e6ec";
  const result = () => ({ version: 1, status: "reachable", httpStatus: 200, title: "Destino", domain: "example.test", iconUrl: `/api/v1/destination-inspections/${id}/icon`, checkedAt: "2026-10-11T10:00:00Z", reason: null });
  const inspection = (overrides: Record<string, unknown> = {}) => ({ inspection: { id, status: "ready", result: { ...result(), ...overrides } } });

  it("accepts the guided page and complete personal filter contracts", () => {
    expect(decodeExpiredPage(defaultExpiredPage())).toEqual(defaultExpiredPage());
    const spec = { ...emptyLinkFilter(), q: "Navidad", utmCampaign: "navidad", favorites: true, collectionId: 4 };
    expect(decodeFilterSpec(spec)).toEqual(spec);
    expect(decodeFavorite({ favorite: false })).toEqual({ favorite: false });
  });

  for (const iconUrl of ["https://evil.test/icon.png", "javascript:alert(1)", "data:image/svg+xml,<svg/>", `/api/v1/destination-inspections/${"0".repeat(36)}/icon`, `/api/v1/destination-inspections/${id}/icon?redirect=evil`]) {
    it(`rejects an icon outside the exact authorized route: ${iconUrl.slice(0, 35)}`, () => expect(() => decodeInspection(inspection({ iconUrl }))).toThrow());
  }

  it("rejects missing, contradictory or unsupported inspection states", () => {
    expect(() => decodeInspection(inspection({ version: 2 }))).toThrow();
    expect(() => decodeInspection({ inspection: { id, status: "ready", result: null } })).toThrow();
    expect(() => decodeInspection({ inspection: { id, status: "pending", result: result() } })).toThrow();
    expect(() => decodeInspection(inspection({ checkedAt: "not a date" }))).toThrow();
    expect(() => decodeInspection(inspection({ status: "trusted" }))).toThrow();
    expect(() => decodeInspection(inspection({ httpStatus: 999 }))).toThrow();
  });

  for (const malicious of ["<script>alert(1)</script>", "<img src=x onerror=alert(1)>", "Message\u0000hidden"]) {
    it("rejects executable markup or controls in the public page", () => {
      const page = defaultExpiredPage(); page.expired.message = malicious;
      expect(() => decodeExpiredPage(page)).toThrow();
    });
  }

  it("rejects unsafe buttons and mismatched label/URL pairs", () => {
    const page = defaultExpiredPage(); page.expired.buttonLabel = "Continuar";
    for (const url of ["javascript:alert(1)", "https://user:secret@example.test", "//example.test", null]) {
      page.expired.buttonUrl = url;
      expect(() => decodeExpiredPage(page)).toThrow();
    }
    page.expired.buttonUrl = "https://example.test"; page.expired.buttonLabel = "";
    expect(() => decodeExpiredPage(page)).toThrow();
  });

  it("rejects invalid filter shapes, excess entries and contradictory reference validity", () => {
    expect(() => decodeFilterSpec({ ...emptyLinkFilter(), version: 2 })).toThrow();
    expect(() => decodeFilterSpec({ ...emptyLinkFilter(), domainId: -1 })).toThrow();
    expect(() => decodeFilterSpec({ ...emptyLinkFilter(), favorites: "true" })).toThrow();
    const filter = { id: 1, name: "Navidad", version: 1, spec: emptyLinkFilter(), valid: true, invalidReferences: [] };
    expect(() => decodeSavedFilters({ filters: Array.from({ length: 51 }, () => filter) })).toThrow();
    expect(() => decodeSavedFilters({ filters: [{ ...filter, invalidReferences: ["Dominio eliminado"] }] })).toThrow();
  });

  it("rejects invalid capability thresholds and loose boolean flags", () => {
    const flags = { enabled: true, ruleSimulator: true, linkHistory: true, linkHistoryRestore: true, reminderHours: 24, reminderClickRatio: 0.9, maxSavedFilters: 50 };
    expect(decodeWorkflows(flags)).toEqual(flags);
    for (const change of [{ enabled: "true" }, { reminderHours: 0 }, { reminderClickRatio: 1 }, { maxSavedFilters: 51 }]) expect(() => decodeWorkflows({ ...flags, ...change })).toThrow();
  });
});
