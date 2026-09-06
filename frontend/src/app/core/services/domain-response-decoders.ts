import type { DomainDto, DomainState } from "../models";
import { boolean, boundedArray, integer, literal, nullableText, record, text } from "./response-decoder-helpers";

const DOMAIN_STATES = new Set<DomainState>(["pending", "verifying", "verified", "provisioning", "active", "error", "disabled"]);

function domain(value: unknown): DomainDto {
  const source = record(value, "domain");
  return {
    id: integer(source["id"], "domain", 1),
    domain: text(source["domain"], "domain", 253),
    state: literal(source["state"], DOMAIN_STATES, "domain state"),
    verificationHost: text(source["verificationHost"], "domain verification host", 300),
    verificationToken: nullableText(source["verificationToken"], "domain verification token", 255),
    cnameTarget: nullableText(source["cnameTarget"], "domain CNAME target", 253),
    verifiedAt: nullableText(source["verifiedAt"], "domain timestamp", 64),
    ownershipVerifiedAt: nullableText(source["ownershipVerifiedAt"], "domain timestamp", 64),
    routingVerifiedAt: nullableText(source["routingVerifiedAt"], "domain timestamp", 64),
    dnsCheckStartedAt: nullableText(source["dnsCheckStartedAt"], "domain timestamp", 64),
    dnsCheckCompletedAt: nullableText(source["dnsCheckCompletedAt"], "domain timestamp", 64),
    dnsError: nullableText(source["dnsError"], "domain DNS error", 2048, true),
    edgeEligible: boolean(source["edgeEligible"], "domain edge eligibility"),
    tlsReadyAt: nullableText(source["tlsReadyAt"], "domain TLS timestamp", 64),
    tlsError: nullableText(source["tlsError"], "domain TLS error", 2048, true),
    createdAt: text(source["createdAt"], "domain creation timestamp", 64),
  };
}

/** Domain responses may contain a one-time TXT token, so decode every row before publishing the list. */
export function decodeDomainsResponse(value: unknown): { domains: DomainDto[] } {
  const source = record(value, "domains");
  return { domains: boundedArray(source["domains"], "domains", 20).map(domain) };
}

export function decodeCreatedDomainResponse(value: unknown): { domain: DomainDto } {
  const source = record(value, "created domain");
  return { domain: domain(source["domain"]) };
}

export function decodeDomainStateResponse(value: unknown): { state: DomainState } {
  const source = record(value, "domain state response");
  return { state: literal(source["state"], DOMAIN_STATES, "domain state") };
}
