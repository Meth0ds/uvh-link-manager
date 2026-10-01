import type { DomainActivityEvent, DomainActivityResponse, DomainCaaRecord, DomainDesiredState, DomainDto, DomainOwnershipStatus, DomainRoutingStatus, DomainState, DomainTlsStatus, DomainTrafficStatus } from "../models";
import {
  boolean,
  boundedArray,
  integer,
  literal,
  nullableBoolean,
  nullableBoundedArray,
  nullableInteger,
  nullableText,
  record,
  text,
} from "./response-decoder-helpers";

const DOMAIN_STATES = new Set<DomainState>(["pending", "verifying", "verified", "provisioning", "active", "error", "disabled"]);
const DESIRED_STATES = new Set<DomainDesiredState>(["enabled", "disabled"]);
const OWNERSHIP_STATUSES = new Set<DomainOwnershipStatus>(["pending", "verified", "lost"]);
const ROUTING_STATUSES = new Set<DomainRoutingStatus>(["unknown", "healthy", "degraded", "failed"]);
const TLS_STATUSES = new Set<DomainTlsStatus>(["pending", "provisioning", "ready", "expiring", "error"]);
const TRAFFIC_STATUSES = new Set<DomainTrafficStatus>(["online", "degraded", "provisioning", "offline"]);

function timestamp(value: unknown, contract: string, nullable = true): string | null {
  const decoded = nullable ? nullableText(value, contract, 64) : text(value, contract, 64);
  if (decoded === null) return null;
  const parsed = Date.parse(decoded);
  if (!Number.isFinite(parsed) || !/^\d{4}-\d{2}-\d{2}T/.test(decoded)) throw new Error(`Invalid ${contract} response`);
  return decoded;
}

function caaRecords(value: unknown): DomainCaaRecord[] | null {
  const items = nullableBoundedArray(value, "domain CAA records", 10);
  if (items === null) return null;
  return items.map((item) => {
    const source = record(item, "domain CAA record");
    return {
      tag: text(source["tag"], "domain CAA tag", 32),
      value: text(source["value"], "domain CAA value", 255, true),
    };
  });
}

function addresses(value: unknown): string[] | null {
  const items = nullableBoundedArray(value, "domain observed addresses", 10);
  if (items === null) return null;
  return items.map((item) => text(item, "domain observed address", 64));
}

function domain(value: unknown, canEdit?: boolean): DomainDto {
  const source = record(value, "domain");
  const decoded: DomainDto = {
    id: integer(source["id"], "domain", 1),
    domain: text(source["domain"], "domain", 253),
    state: literal(source["state"], DOMAIN_STATES, "domain state"),
    desiredState: literal(source["desiredState"], DESIRED_STATES, "domain desired state"),
    ownershipStatus: literal(source["ownershipStatus"], OWNERSHIP_STATUSES, "domain ownership status"),
    routingStatus: literal(source["routingStatus"], ROUTING_STATUSES, "domain routing status"),
    tlsStatus: literal(source["tlsStatus"], TLS_STATUSES, "domain TLS status"),
    trafficStatus: literal(source["trafficStatus"], TRAFFIC_STATUSES, "domain traffic status"),
    servingReady: boolean(source["servingReady"], "domain serving readiness"),
    verificationHost: nullableText(source["verificationHost"], "domain verification host", 300),
    verificationToken: nullableText(source["verificationToken"], "domain verification token", 255),
    cnameTarget: nullableText(source["cnameTarget"], "domain CNAME target", 253),
    verificationScheme: integer(source["verificationScheme"], "domain verification scheme", 1, 2),
    verifiedAt: timestamp(source["verifiedAt"], "domain timestamp"),
    ownershipVerifiedAt: timestamp(source["ownershipVerifiedAt"], "domain timestamp"),
    routingVerifiedAt: timestamp(source["routingVerifiedAt"], "domain timestamp"),
    dnsCheckStartedAt: timestamp(source["dnsCheckStartedAt"], "domain timestamp"),
    dnsCheckCompletedAt: timestamp(source["dnsCheckCompletedAt"], "domain timestamp"),
    dnsError: nullableText(source["dnsError"], "domain DNS error", 2048, true),
    dnsCheckInProgress: boolean(source["dnsCheckInProgress"], "domain DNS progress"),
    automaticDnsRetry: boolean(source["automaticDnsRetry"], "domain automatic DNS retry"),
    dnsRetryIntervalHours: nullableInteger(source["dnsRetryIntervalHours"], "domain DNS retry interval", 1),
    nextDnsCheckAt: timestamp(source["nextDnsCheckAt"], "domain next DNS check"),
    dnsCheckDue: boolean(source["dnsCheckDue"], "domain DNS due state"),
    dnsFailureCount: integer(source["dnsFailureCount"], "domain DNS failure count", 0),
    dnsMaxFailures: integer(source["dnsMaxFailures"], "domain DNS max failures", 1, 100),
    dnsFirstFailedAt: timestamp(source["dnsFirstFailedAt"], "domain timestamp"),
    graceExpiresAt: timestamp(source["graceExpiresAt"], "domain grace deadline"),
    dnsObservedAt: timestamp(source["dnsObservedAt"], "domain timestamp"),
    ownershipTxtPresent: nullableBoolean(source["ownershipTxtPresent"], "domain TXT presence"),
    routingObservedTarget: nullableText(source["routingObservedTarget"], "domain observed target", 253),
    routingObservedTtl: nullableInteger(source["routingObservedTtl"], "domain observed TTL", 0),
    routingObservedAddresses: addresses(source["routingObservedAddresses"]),
    routingObservedProxied: nullableBoolean(source["routingObservedProxied"], "domain proxy hint"),
    caaRecords: caaRecords(source["caaRecords"]),
    caaAllowsIssuer: nullableBoolean(source["caaAllowsIssuer"], "domain CAA allowance"),
    acmeIssuer: text(source["acmeIssuer"], "domain ACME issuer", 253),
    edgeEligible: boolean(source["edgeEligible"], "domain edge eligibility"),
    tlsReadyAt: timestamp(source["tlsReadyAt"], "domain TLS timestamp"),
    tlsError: nullableText(source["tlsError"], "domain TLS error", 2048, true),
    tlsCheckedAt: timestamp(source["tlsCheckedAt"], "domain timestamp"),
    tlsNotAfter: timestamp(source["tlsNotAfter"], "domain TLS expiry"),
    tlsIssuer: nullableText(source["tlsIssuer"], "domain TLS issuer", 255),
    tlsDaysRemaining: nullableInteger(source["tlsDaysRemaining"], "domain TLS days remaining", 0),
    tlsLastAttemptAt: timestamp(source["tlsLastAttemptAt"], "domain timestamp"),
    tlsNextRetryAt: timestamp(source["tlsNextRetryAt"], "domain timestamp"),
    tlsProbeFailures: integer(source["tlsProbeFailures"], "domain TLS probe failures", 0),
    rootDestination: nullableText(source["rootDestination"], "domain root destination", 2048, true),
    notFoundMode: nullableText(source["notFoundMode"], "domain not-found mode", 16),
    isDefault: boolean(source["isDefault"], "domain default flag"),
    linksCount: integer(source["linksCount"], "domain links count", 0),
    createdAt: timestamp(source["createdAt"], "domain creation timestamp", false)!,
  };

  // The challenge *value* is a secret: a read-only view must never carry it.
  // The host label is deterministic and shown to everyone for diagnostics.
  if (canEdit === false && decoded.verificationToken !== null) {
    throw new Error("Invalid domain response");
  }
  if (canEdit === true && decoded.verificationToken === null) {
    throw new Error("Invalid domain response");
  }
  if (decoded.automaticDnsRetry !== (decoded.desiredState === "enabled")
    || (!decoded.automaticDnsRetry && (decoded.dnsRetryIntervalHours !== null || decoded.nextDnsCheckAt !== null || decoded.dnsCheckDue))
    || (decoded.dnsCheckInProgress && (decoded.nextDnsCheckAt !== null || decoded.dnsCheckDue))) {
    throw new Error("Invalid domain response");
  }
  // Serving is a derivation of intent + edge + certificate; the server shares
  // its definition so the two can never disagree about a row being live.
  if (decoded.servingReady !== (decoded.desiredState === "enabled" && decoded.edgeEligible && decoded.tlsReadyAt !== null)) {
    throw new Error("Invalid domain response");
  }
  return decoded;
}

/** Domain responses may contain a one-time TXT token, so decode every row before publishing the list. */
export function decodeDomainsResponse(value: unknown, canEdit?: boolean): { domains: DomainDto[] } {
  const source = record(value, "domains");
  const domains = boundedArray(source["domains"], "domains", 20).map((item) => domain(item, canEdit));
  // The default-domain preference is exclusive per workspace: a list that
  // carries two defaults is a broken invariant, never a value to render.
  if (domains.filter((d) => d.isDefault).length > 1) {
    throw new Error("Invalid domain response");
  }
  return { domains };
}

export function decodeCreatedDomainResponse(value: unknown): { domain: DomainDto } {
  const source = record(value, "created domain");
  return { domain: domain(source["domain"], true) };
}

export function decodeDomainDetailResponse(value: unknown, expectedId: number, canEdit: boolean): { domain: DomainDto } {
  const source = record(value, "domain detail");
  const decoded = domain(source["domain"], canEdit);
  if (decoded.id !== expectedId) throw new Error("Invalid domain detail response");
  return { domain: decoded };
}

export function decodeDomainStateResponse(value: unknown): { state: DomainState } {
  const source = record(value, "domain state response");
  return { state: literal(source["state"], DOMAIN_STATES, "domain state") };
}

const DOMAIN_EVENTS = new Set([
  "domain.claimed",
  "domain.claim_transferred",
  "domain.verified",
  "domain.degraded",
  "domain.offline",
  "domain.recovered",
  "domain.activated",
  "domain.disabled",
  "domain.tls_failed",
  "domain.tls_expiring",
  "domain.deleted",
]);

// The documented projection of `GET /domains/:id/activity`, mirrored from the
// backend `DomainActivityCatalog`: any other payload key is a contract drift,
// never a value to render.
const ACTIVITY_PAYLOAD_KEYS = new Set(["reason", "failureCount", "graceExpiresAt", "notAfter", "daysRemaining"]);

export function decodeDomainActivityResponse(value: unknown): DomainActivityResponse {
  const source = record(value, "domain activity");
  return {
    events: boundedArray(source["events"], "domain activity events", 50).map((item) => {
      const row = record(item, "domain activity event");
      const event = text(row["event"], "domain activity event", 64);
      if (!DOMAIN_EVENTS.has(event)) throw new Error("Invalid domain activity response");
      const payload = record(row["payload"], "domain activity payload");
      const decoded: DomainActivityEvent["payload"] = {};
      for (const [key, raw] of Object.entries(payload)) {
        if (!ACTIVITY_PAYLOAD_KEYS.has(key)) throw new Error("Invalid domain activity response");
        if (key === "reason") {
          decoded.reason = text(raw, "domain activity reason", 64);
          if (!/^[a-z0-9_]+$/.test(decoded.reason)) throw new Error("Invalid domain activity response");
        } else if (key === "failureCount" || key === "daysRemaining") {
          decoded[key] = integer(raw, `domain activity ${key}`, 0);
        } else if (key === "graceExpiresAt" || key === "notAfter") {
          const iso = timestamp(raw, `domain activity ${key}`, false);
          if (iso === null) throw new Error("Invalid domain activity response");
          decoded[key] = iso;
        } else {
          throw new Error("Invalid domain activity response");
        }
      }
      return {
        id: integer(row["id"], "domain activity event", 1),
        event,
        payload: decoded,
        createdAt: timestamp(row["createdAt"], "domain activity timestamp", false)!,
      };
    }),
  };
}
