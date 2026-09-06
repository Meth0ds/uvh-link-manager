import type { DomainDto, DomainState } from "../models";
import { boolean, boundedArray, integer, literal, nullableInteger, nullableText, record, text } from "./response-decoder-helpers";

const DOMAIN_STATES = new Set<DomainState>(["pending", "verifying", "verified", "provisioning", "active", "error", "disabled"]);

function timestamp(value: unknown, contract: string, nullable = true): string | null {
  const decoded = nullable ? nullableText(value, contract, 64) : text(value, contract, 64);
  if (decoded === null) return null;
  const parsed = Date.parse(decoded);
  if (!Number.isFinite(parsed) || !/^\d{4}-\d{2}-\d{2}T/.test(decoded)) throw new Error(`Invalid ${contract} response`);
  return decoded;
}

function domain(value: unknown, canEdit?: boolean): DomainDto {
  const source = record(value, "domain");
  const decoded: DomainDto = {
    id: integer(source["id"], "domain", 1),
    domain: text(source["domain"], "domain", 253),
    state: literal(source["state"], DOMAIN_STATES, "domain state"),
    verificationHost: nullableText(source["verificationHost"], "domain verification host", 300),
    verificationToken: nullableText(source["verificationToken"], "domain verification token", 255),
    cnameTarget: nullableText(source["cnameTarget"], "domain CNAME target", 253),
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
    edgeEligible: boolean(source["edgeEligible"], "domain edge eligibility"),
    tlsReadyAt: timestamp(source["tlsReadyAt"], "domain TLS timestamp"),
    tlsError: nullableText(source["tlsError"], "domain TLS error", 2048, true),
    createdAt: timestamp(source["createdAt"], "domain creation timestamp", false)!,
  };

  if (canEdit === false && (decoded.verificationHost !== null || decoded.verificationToken !== null)) {
    throw new Error("Invalid domain response");
  }
  if (canEdit === true && (decoded.verificationHost === null || decoded.verificationToken === null)) {
    throw new Error("Invalid domain response");
  }
  if (decoded.automaticDnsRetry !== (decoded.state === "active")
    || (!decoded.automaticDnsRetry && (decoded.dnsRetryIntervalHours !== null || decoded.nextDnsCheckAt !== null || decoded.dnsCheckDue))
    || (decoded.dnsCheckInProgress && (decoded.nextDnsCheckAt !== null || decoded.dnsCheckDue))) {
    throw new Error("Invalid domain response");
  }
  return decoded;
}

/** Domain responses may contain a one-time TXT token, so decode every row before publishing the list. */
export function decodeDomainsResponse(value: unknown, canEdit?: boolean): { domains: DomainDto[] } {
  const source = record(value, "domains");
  return { domains: boundedArray(source["domains"], "domains", 20).map((item) => domain(item, canEdit)) };
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
