import type { ClaimedLinkIntent, LinkIntentReceipt } from "./pending-link-intent.service";

type JsonRecord = Record<string, unknown>;

const TOKEN_PATTERN = /^[A-Za-z0-9_-]{43}$/;
const MAX_CLOCK_SKEW_MS = 5 * 60_000;
const MAX_INTENT_TTL_MS = 24 * 60 * 60_000;

function invalid(contract: string): never {
  throw new Error(`Invalid ${contract} response`);
}

function record(value: unknown, contract: string): JsonRecord {
  if (typeof value !== "object" || value === null || Array.isArray(value)) invalid(contract);
  return value as JsonRecord;
}

function expiry(value: unknown, contract: string): string {
  if (typeof value !== "string" || value.length > 64
    || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/.test(value)) {
    invalid(contract);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)
    || parsed <= Date.now() - MAX_CLOCK_SKEW_MS
    || parsed > Date.now() + MAX_INTENT_TTL_MS + MAX_CLOCK_SKEW_MS) {
    invalid(contract);
  }
  return value;
}

function destination(value: unknown): string {
  if (typeof value !== "string" || value.length === 0 || value.length > 2048
    || /[\u0000-\u001f\u007f\\\\]/.test(value)) {
    invalid("claimed link intent");
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    invalid("claimed link intent");
  }
  if ((parsed.protocol !== "http:" && parsed.protocol !== "https:")
    || !parsed.hostname || parsed.username || parsed.password) {
    invalid("claimed link intent");
  }
  return value;
}

/** The public handoff may expose only a fixed-size opaque bearer and its bounded expiry. */
export function decodeLinkIntentReceipt(value: unknown): LinkIntentReceipt {
  const source = record(value, "link intent receipt");
  if (typeof source["intent"] !== "string" || !TOKEN_PATTERN.test(source["intent"])) {
    invalid("link intent receipt");
  }
  return {
    intent: source["intent"],
    expiresAt: expiry(source["expiresAt"], "link intent receipt"),
  };
}

/** Validate the authenticated destination before it can reach a dialog or navigation flow. */
export function decodeClaimedLinkIntent(value: unknown): ClaimedLinkIntent {
  const source = record(value, "claimed link intent");
  return {
    destination: destination(source["destination"]),
    expiresAt: expiry(source["expiresAt"], "claimed link intent"),
  };
}
