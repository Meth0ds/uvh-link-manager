import { decodePublicStatus } from "./public-status-response";
import type { PublicStatusSnapshot } from "../models";

describe("decodePublicStatus", () => {
  const healthy: PublicStatusSnapshot = {
    overall: "operational",
    generatedAt: "2026-09-06T12:00:00Z",
    stale: false,
    source: "external_monitor",
    components: [
      { id: "links", label: "Enlaces y redirecciones", status: "operational" },
      { id: "panel", label: "Panel y API", status: "operational" },
      { id: "webhooks", label: "Entrega de webhooks", status: "operational" },
    ],
    incidents: [],
  };

  it("accepts the complete, bounded external-monitor contract", () => {
    expect(decodePublicStatus(healthy)).toEqual(healthy);
  });

  it("accepts only the canonical fail-closed unavailable shape", () => {
    const unavailable: PublicStatusSnapshot = { overall: "unknown", generatedAt: null, stale: true, source: "external_monitor_unavailable", components: [], incidents: [] };
    expect(decodePublicStatus(unavailable)).toEqual(unavailable);
    expect(() => decodePublicStatus({ ...unavailable, overall: "operational" })).toThrow();
  });

  it("rejects component duplication, unknown fields in data, and invalid dates", () => {
    expect(() => decodePublicStatus({ ...healthy, components: [healthy.components[0], healthy.components[0], healthy.components[2]] })).toThrow();
    expect(() => decodePublicStatus({ ...healthy, generatedAt: "not-a-date" })).toThrow();
    expect(() => decodePublicStatus({ ...healthy, incidents: [{ id: "i1", title: "Incidente", message: "Detalle", status: "open", startedAt: healthy.generatedAt, updatedAt: healthy.generatedAt }] })).toThrow();
  });
});
