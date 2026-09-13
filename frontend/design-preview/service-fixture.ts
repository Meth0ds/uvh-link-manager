/** Read-only examples, exclusive to the preview. No monitor or receiver. */
import { signal } from "@angular/core";
import type { PublicStatusSnapshot, WebhookDelivery, WebhookDto } from "../src/app/core/models";
export const statusMode = signal<"operational" | "outage" | "unknown">("operational");
export function sampleStatus(): PublicStatusSnapshot {
  if (statusMode() === "unknown") return { overall: "unknown", generatedAt: null, stale: true, source: "external_monitor_unavailable", components: [], incidents: [] };
  const outage = statusMode() === "outage";
  const generatedAt = new Date().toISOString();
  return { overall: outage ? "major_outage" : "operational", generatedAt, stale: false, source: "external_monitor",
    components: [{ id: "links", label: "Enlaces y redirecciones", status: "operational" }, { id: "panel", label: "Panel y API", status: "operational" }, { id: "webhooks", label: "Entrega de webhooks", status: outage ? "major_outage" : "operational" }],
    incidents: outage ? [{ id: "fictional-incident", title: "Demora en la entrega de eventos (ejemplo)", message: "Escenario ficticio: los eventos permanecen en cola mientras se investiga la interrupción del envío. No describe el estado de ningún servicio real.", status: "investigating", startedAt: generatedAt, updatedAt: generatedAt }] : [] };
}
export const sampleWebhook: WebhookDto = { id: 9001, url: "https://editorial.example.invalid/integraciones/recepcion-de-eventos-de-la-publicacion", events: ["link.created", "link.updated"], active: true, hasSecret: true, createdAt: "2026-09-13T12:00:00Z", updatedAt: "2026-09-13T12:00:00Z" };
export const sampleDeliveries: WebhookDelivery[] = (["failed", "pending", "processing", "success"] as const).map((status, index) => ({
  id: index + 1, webhook_id: 9001, event: "link.created", event_id: `fictional-event-${index + 1}-EditorialConUnIdentificadorLargoSinEspaciosParaComprobarElAjusteEnMovil`, status, attempts: status === "pending" ? 0 : 1,
  error: status === "failed" ? { code: "connection_failed", message: "Ejemplo ficticio: no se pudo establecer la conexión con el receptor." } : null,
  payloadPreview: { event: "link.created", eventId: `fictional-event-${index + 1}-EditorialConUnIdentificadorLargoSinEspaciosParaComprobarElAjusteEnMovil`, timestamp: "2026-09-13T12:00:00Z", data: { linkId: 900001 }, redacted: true },
  next_attempt_at: status === "pending" ? "2026-09-13T12:10:00Z" : null, created_at: "2026-09-13T12:00:00Z", delivered_at: status === "success" ? "2026-09-13T12:00:04Z" : null,
}));
