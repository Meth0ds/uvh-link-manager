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

  it("publishes the custom domains component when the monitor reports it", () => {
    const withDomains: PublicStatusSnapshot = {
      ...healthy,
      overall: "degraded",
      components: [...healthy.components, { id: "domains", label: "Dominios personalizados", status: "degraded" }],
    };
    expect(decodePublicStatus(withDomains)).toEqual(withDomains);
  });

  it("requires the core components and nothing beyond the four known", () => {
    // Un feed antiguo sin dominios sigue siendo válido; uno sin un componente
    // histórico, o con un quinto inventado, no lo es.
    expect(decodePublicStatus(healthy).components.length).toBe(3);
    expect(() => decodePublicStatus({ ...healthy, components: [healthy.components[0], healthy.components[1]] })).toThrow();
    expect(() => decodePublicStatus({
      ...healthy,
      components: [...healthy.components, { id: "unknown", label: "Inventado", status: "operational" }],
    })).toThrow();
  });
});
