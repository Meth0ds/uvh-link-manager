import {
  decodeApiTokensResponse,
  decodeCreatedApiTokenResponse,
  decodeCreatedWebhookResponse,
  decodeWebhookDeliveriesResponse,
  decodeWebhooksResponse,
} from "./credential-response-decoders";
import type { WebhookDelivery } from "../models";

const token = {
  id: 3,
  name: "Production reader",
  scopes: ["links:read", "analytics:read"],
  lastUsedAt: null,
  expiresAt: null,
  revokedAt: null,
  createdAt: "2026-09-06T10:00:00.000Z",
};

const webhook = {
  id: 4,
  url: "https://hooks.example.test/uvh",
  events: ["link.created", "domain.verified"],
  active: true,
  hasSecret: true,
  createdAt: "2026-09-06T10:00:00.000Z",
  updatedAt: "2026-09-06T10:00:00.000Z",
};

describe("credential response decoders", () => {
  it("decodes complete API-token lists and rejects an invalid nested scope atomically", () => {
    expect(decodeApiTokensResponse({ tokens: [token], truncated: false })).toEqual({ tokens: [token] });
    expect(() => decodeApiTokensResponse({ tokens: [token, { ...token, scopes: ["admin:all"] }] })).toThrow();
  });

  it("accepts only the exact one-time bearer format emitted by the backend", () => {
    const plainToken = `uvh_${"A".repeat(43)}`;
    expect(decodeCreatedApiTokenResponse({ token, plainToken })).toEqual({ token, plainToken });
    expect(() => decodeCreatedApiTokenResponse({ token, plainToken: "uvh_short" })).toThrow();
  });

  it("validates webhook metadata and known event names", () => {
    expect(decodeWebhooksResponse({ webhooks: [webhook] })).toEqual({ webhooks: [webhook] });
    expect(() => decodeWebhooksResponse({ webhooks: [{ ...webhook, active: 1 }] })).toThrow();
    expect(() => decodeWebhooksResponse({ webhooks: [{ ...webhook, events: ["unknown"] }] })).toThrow();
  });

  it("keeps valid user-supplied secrets while rejecting missing or short values", () => {
    expect(decodeCreatedWebhookResponse({ webhook, secret: "a secure value 123" })).toEqual({
      webhook,
      secret: "a secure value 123",
    });
    expect(() => decodeCreatedWebhookResponse({ webhook, secret: "too-short" })).toThrow();
  });

  it("validates bounded delivery rows and status values", () => {
    const delivery = {
      id: 7,
      webhook_id: 4,
      event: "link.created",
      event_id: "event-1",
      status: "pending",
      attempts: 0,
      last_error: null,
      next_attempt_at: "2026-09-06T10:01:00.000Z",
      created_at: "2026-09-06T10:00:00.000Z",
      delivered_at: null,
    } satisfies WebhookDelivery;
    expect(decodeWebhookDeliveriesResponse({ deliveries: [delivery] })).toEqual({ deliveries: [delivery] });
    expect(() => decodeWebhookDeliveriesResponse({ deliveries: [{ ...delivery, status: "unknown" }] })).toThrow();
    expect(() => decodeWebhookDeliveriesResponse({ deliveries: [{ ...delivery, attempts: -1 }] })).toThrow();
  });
});
