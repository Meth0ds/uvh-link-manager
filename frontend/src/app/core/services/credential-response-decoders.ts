import type { ApiTokenDto, WebhookDelivery, WebhookDeliveryPage, WebhookDto } from "../models";

type JsonRecord = Record<string, unknown>;

const TOKEN_SCOPES = new Set([
  "links:read",
  "links:write",
  "analytics:read",
  "domains:read",
  "domains:write",
]);
const WEBHOOK_EVENTS = new Set([
  "link.created",
  "link.updated",
  "link.deleted",
  "link.threshold_reached",
  "domain.verified",
]);
const DELIVERY_STATUSES = new Set<WebhookDelivery["status"]>(["pending", "processing", "success", "failed"]);
const INSPECTOR_EVENTS = new Set([...WEBHOOK_EVENTS, "ping", "unknown"]);
const ERROR_CODES = new Set(["receiver_http", "network_policy", "dns_resolution", "serialization", "configuration_changed", "creator_permission_revoked", "delivery_infrastructure", "connection_failed", "unknown_failure"]);

function invalid(contract: string): never {
  throw new Error(`Invalid ${contract} response`);
}

function record(value: unknown, contract: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(contract);
  return value as JsonRecord;
}

function integer(value: unknown, contract: string, minimum = 0): number {
  if (!Number.isSafeInteger(value) || (value as number) < minimum) invalid(contract);
  return value as number;
}

function text(value: unknown, contract: string, maximum: number, allowEmpty = false): string {
  if (typeof value !== "string" || (!allowEmpty && value.length === 0) || value.length > maximum) invalid(contract);
  return value;
}

function safeText(value: unknown, contract: string, maximum: number): string {
  const decoded = text(value, contract, maximum);
  if (/[\u0000-\u001f\u007f]/.test(decoded)) invalid(contract);
  return decoded;
}

function nullableText(value: unknown, contract: string, maximum: number, allowEmpty = false): string | null {
  if (value === null) return null;
  return text(value, contract, maximum, allowEmpty);
}

function uniqueAllowedStrings(value: unknown, allowed: Set<string>, contract: string, maximum: number): string[] {
  if (!Array.isArray(value) || value.length === 0 || value.length > maximum) invalid(contract);
  const decoded = value.map((item) => safeText(item, contract, 64));
  if (new Set(decoded).size !== decoded.length || decoded.some((item) => !allowed.has(item))) invalid(contract);
  return decoded;
}

function apiToken(value: unknown): ApiTokenDto {
  const source = record(value, "API token");
  return {
    id: integer(source["id"], "API token", 1),
    name: safeText(source["name"], "API token", 80),
    scopes: uniqueAllowedStrings(source["scopes"], TOKEN_SCOPES, "API token scopes", TOKEN_SCOPES.size),
    lastUsedAt: nullableText(source["lastUsedAt"], "API token", 64),
    expiresAt: nullableText(source["expiresAt"], "API token", 64),
    revokedAt: nullableText(source["revokedAt"], "API token", 64),
    createdAt: safeText(source["createdAt"], "API token", 64),
  };
}

function webhook(value: unknown): WebhookDto {
  const source = record(value, "webhook");
  return {
    id: integer(source["id"], "webhook", 1),
    url: safeText(source["url"], "webhook", 2048),
    events: uniqueAllowedStrings(source["events"], WEBHOOK_EVENTS, "webhook events", 10),
    active: boolean(source["active"]),
    hasSecret: boolean(source["hasSecret"]),
    createdAt: safeText(source["createdAt"], "webhook", 64),
    updatedAt: safeText(source["updatedAt"], "webhook", 64),
  };
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") invalid("boolean field");
  return value;
}

function delivery(value: unknown): WebhookDelivery {
  const source = record(value, "webhook delivery");
  const status = source["status"];
  if (typeof status !== "string" || !DELIVERY_STATUSES.has(status as WebhookDelivery["status"])) {
    invalid("webhook delivery");
  }
  const errorSource = source["error"] === null ? null : record(source["error"], "webhook delivery error");
  const payload = record(source["payloadPreview"], "webhook payload preview");
  const payloadData = record(payload["data"], "webhook payload data");
  if (Object.keys(payloadData).length > 4 || payload["redacted"] !== true) invalid("webhook payload preview");
  const data: Record<string, string | number> = {};
  for (const [key, item] of Object.entries(payloadData)) {
    const safeKey = safeText(key, "webhook payload key", 32);
    if ((typeof item !== "string" && typeof item !== "number")
      || (typeof item === "number" && (!Number.isSafeInteger(item) || item < 0))
      || (typeof item === "string" && (item.length > 255 || /[\u0000-\u001f\u007f]/.test(item)))) invalid("webhook payload data");
    data[safeKey] = item;
  }
  const payloadEvent = safeText(payload["event"], "webhook payload event", 64);
  if (!INSPECTOR_EVENTS.has(payloadEvent)) invalid("webhook payload event");
  return {
    id: integer(source["id"], "webhook delivery", 1),
    webhook_id: integer(source["webhook_id"], "webhook delivery", 1),
    event: safeText(source["event"], "webhook delivery", 64),
    event_id: safeText(source["event_id"], "webhook delivery", 255),
    status: status as WebhookDelivery["status"],
    attempts: integer(source["attempts"], "webhook delivery"),
    error: errorSource === null ? null : {
      code: (() => { const code = safeText(errorSource["code"], "webhook delivery error", 64); if (!ERROR_CODES.has(code)) invalid("webhook delivery error"); return code; })(),
      message: safeText(errorSource["message"], "webhook delivery error", 255),
    },
    payloadPreview: {
      event: payloadEvent,
      eventId: safeText(payload["eventId"], "webhook payload event id", 255),
      timestamp: nullableText(payload["timestamp"], "webhook payload timestamp", 64),
      data,
      redacted: true,
    },
    next_attempt_at: nullableText(source["next_attempt_at"], "webhook delivery", 64),
    created_at: safeText(source["created_at"], "webhook delivery", 64),
    delivered_at: nullableText(source["delivered_at"], "webhook delivery", 64),
  };
}

/** Decode the whole list before replacing workspace-scoped credential metadata. */
export function decodeApiTokensResponse(value: unknown): { tokens: ApiTokenDto[] } {
  const source = record(value, "API tokens");
  if (!Array.isArray(source["tokens"]) || source["tokens"].length > 100) invalid("API tokens");
  return { tokens: source["tokens"].map(apiToken) };
}

/**
 * A newly issued bearer is displayed once. Validate its exact server format and
 * its metadata atomically so malformed JSON can never be published as a secret.
 */
export function decodeCreatedApiTokenResponse(value: unknown): { token: ApiTokenDto; plainToken: string } {
  const source = record(value, "created API token");
  const plainToken = text(source["plainToken"], "created API token", 47);
  if (!/^uvh_[A-Za-z0-9_-]{43}$/.test(plainToken)) invalid("created API token");
  return { token: apiToken(source["token"]), plainToken };
}

export function decodeWebhooksResponse(value: unknown): { webhooks: WebhookDto[] } {
  const source = record(value, "webhooks");
  if (!Array.isArray(source["webhooks"]) || source["webhooks"].length > 20) invalid("webhooks");
  return { webhooks: source["webhooks"].map(webhook) };
}

/** Preserve user-supplied webhook secrets, but enforce the backend's 16–128 character contract. */
export function decodeCreatedWebhookResponse(value: unknown): { webhook: WebhookDto; secret: string } {
  const source = record(value, "created webhook");
  if (typeof source["secret"] !== "string") invalid("created webhook");
  const secret = source["secret"];
  const secretLength = Array.from(secret).length;
  if (secretLength < 16 || secretLength > 128) invalid("created webhook");
  return { webhook: webhook(source["webhook"]), secret };
}

export function decodeWebhookDeliveriesResponse(value: unknown, expected?: { webhookId: number; page: number; perPage: number }): WebhookDeliveryPage {
  const source = record(value, "webhook deliveries");
  if (!Array.isArray(source["deliveries"]) || source["deliveries"].length > 50) invalid("webhook deliveries");
  const page = integer(source["page"], "webhook delivery page", 1);
  const perPage = integer(source["perPage"], "webhook delivery page", 1);
  const total = integer(source["total"], "webhook delivery page");
  if (perPage > 50 || source["deliveries"].length > perPage || total < source["deliveries"].length
    || (expected && (page !== expected.page || perPage !== expected.perPage))) invalid("webhook delivery page");
  const deliveries = source["deliveries"].map(delivery);
  if (expected && deliveries.some((item) => item.webhook_id !== expected.webhookId)) invalid("webhook delivery page");
  return { deliveries, total, page, perPage };
}
