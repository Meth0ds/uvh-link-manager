import type { AnalyticsOverview, DomainDto, LinkDto, LinkTrashResponse } from "../models";
import { decodeCreatedDomainResponse, decodeDomainDetailResponse, decodeDomainsResponse, decodeDomainStateResponse } from "./domain-response-decoders";
import {
  decodeAliasAvailability,
  decodeAnalyticsOverview,
  decodeLinkActivityResponse,
  decodeLinkDetailResponse,
  decodeLinkResponse,
  decodeLinkTrashResponse,
  decodeLinksResponse,
  decodeRulesResponse,
} from "./link-response-decoders";

const link: LinkDto = {
  id: 4,
  alias: "campaign",
  destination: "https://example.test/destination",
  fallbackDestination: null,
  state: "active",
  clickCount: 3,
  maxClicks: null,
  singleUse: false,
  usedAt: null,
  scheduledAt: null,
  expiresAt: null,
  notes: null,
  passwordProtected: false,
  utm: { source: null, medium: null, campaign: null, term: null, content: null },
  domainId: null,
  domain: null,
  collectionId: null,
  collection: null,
  tags: ["launch"],
  createdAt: "2026-09-06T10:00:00Z",
  updatedAt: "2026-09-06T10:00:00Z",
  version: 2,
  shortUrl: "https://uvh.test/campaign",
};

const domain: DomainDto = {
  id: 6,
  domain: "go.example.test",
  state: "pending",
  verificationHost: "_uvh-verification.go.example.test",
  verificationToken: "opaque-token",
  cnameTarget: "edge.example.test",
  verifiedAt: null,
  ownershipVerifiedAt: null,
  routingVerifiedAt: null,
  dnsCheckStartedAt: null,
  dnsCheckCompletedAt: null,
  dnsError: null,
  dnsCheckInProgress: false,
  automaticDnsRetry: false,
  dnsRetryIntervalHours: null,
  nextDnsCheckAt: null,
  dnsCheckDue: false,
  edgeEligible: false,
  tlsReadyAt: null,
  tlsError: null,
  createdAt: "2026-09-06T10:00:00Z",
};

const analytics: AnalyticsOverview = {
  totals: { clicks: 2, visitors: 1 },
  visitorMetric: "daily_pseudonyms",
  series: [{ day: "2026-09-06", clicks: 2, visitors: 1 }],
  topLinks: [{ id: 4, alias: "campaign", destination: "https://example.test", clicks: 2, visitors: 1 }],
  countries: [{ key: "ES", value: 2 }],
  devices: [],
  browsers: [],
  os: [],
  referrers: [],
  campaigns: [],
  dimensionTotals: { countries: 1, devices: 0, browsers: 0, os: 0, referrers: 0, campaigns: 0 },
};

describe("resource response decoders", () => {
  it("decodes link pages and binds server pagination to the request", () => {
    const page = { links: [link], total: 1, page: 1, perPage: 20 };
    expect(decodeLinksResponse(page, { page: 1, perPage: 20 })).toEqual(page);
    expect(() => decodeLinksResponse({ ...page, page: 2 }, { page: 1, perPage: 20 })).toThrow();
    expect(() => decodeLinksResponse({ ...page, links: [{ ...link, version: 0 }] })).toThrow();
  });

  it("validates link and detail identities before publishing an edit", () => {
    expect(decodeLinkResponse({ link }, 4)).toEqual({ link });
    expect(decodeLinkDetailResponse({ link, rules: [], appeal: null, blockReason: null }, 4))
      .toEqual({ link, rules: [], appeal: null, blockReason: null });
    expect(() => decodeLinkResponse({ link }, 9)).toThrow();
    expect(() => decodeLinkDetailResponse({ link, rules: [], appeal: null }, 9)).toThrow();
  });

  it("reads the owner's own appeal and refuses an unknown status", () => {
    const appeal = { status: "open" as const, createdAt: "2026-09-21T10:00:00.000000+00:00", decidedAt: null, decisionNote: null };
    expect(decodeLinkDetailResponse({ link, rules: [], appeal }, 4).appeal).toEqual(appeal);
    // A payload from before the field existed carries no key: no appeal, not a failure.
    expect(decodeLinkDetailResponse({ link, rules: [] }, 4).appeal).toBeNull();
    expect(() => decodeLinkDetailResponse({ link, rules: [], appeal: { ...appeal, status: "pending" } }, 4)).toThrow();
    expect(() => decodeLinkDetailResponse({ link, rules: [], appeal: { ...appeal, createdAt: "ayer" } }, 4)).toThrow();
  });

  it("reads why the link is blocked and the note behind the decision", () => {
    const decided = {
      status: "upheld" as const,
      createdAt: "2026-09-21T10:00:00.000000+00:00",
      decidedAt: "2026-09-21T11:00:00.000000+00:00",
      decisionNote: "El destino sigue suplantando una marca ajena.",
    };
    const detail = decodeLinkDetailResponse(
      { link, rules: [], appeal: decided, blockReason: "Suplantación de marca confirmada." },
      4,
    );
    expect(detail.appeal).toEqual(decided);
    expect(detail.blockReason).toBe("Suplantación de marca confirmada.");
    // A note is written by an operator and may span lines; a blocked link with no
    // reason to print reads as no reason, not as a broken payload.
    expect(decodeLinkDetailResponse({ link, rules: [], appeal: { ...decided, decisionNote: "Primera línea.\nSegunda línea." }, blockReason: null }, 4).appeal?.decisionNote)
      .toBe("Primera línea.\nSegunda línea.");
    expect(decodeLinkDetailResponse({ link, rules: [], appeal: decided }, 4).blockReason).toBeNull();
  });

  it("rejects unsafe link destinations and duplicate case-insensitive tags", () => {
    expect(() => decodeLinkResponse({ link: { ...link, destination: "javascript:alert(1)" } })).toThrow();
    expect(() => decodeLinkResponse({ link: { ...link, tags: ["Launch", "launch"] } })).toThrow();
  });

  it("validates redirect rules and alias result enums", () => {
    const rule = {
      id: 3, priority: 1, country: "ES", language: "es", device: "mobile",
      os: null, timeFrom: "09:00", timeTo: "18:00", referrer: null,
      campaign: null, destination: "https://example.test/mobile", createdAt: "2026-09-06T10:00:00Z",
    };
    expect(decodeRulesResponse({ rules: [rule] }).rules[0].device).toBe("mobile");
    expect(decodeAliasAvailability({ available: false, reason: "reserved" })).toEqual({ available: false, reason: "reserved" });
    expect(() => decodeRulesResponse({ rules: [{ ...rule, timeFrom: "25:00" }] })).toThrow();
    expect(() => decodeAliasAvailability({ available: false, reason: "internal" })).toThrow();
  });

  it("validates analytics totals, dimensions and URLs", () => {
    expect(decodeAnalyticsOverview(analytics)).toEqual(analytics);
    expect(() => decodeAnalyticsOverview({ ...analytics, totals: { clicks: -1, visitors: 1 } })).toThrow();
    expect(() => decodeAnalyticsOverview({ ...analytics, countries: [{ key: "ES", value: "2" }] })).toThrow();
  });

  it("reconstructs the minimized link activity projection", () => {
    const decoded = decodeLinkActivityResponse({ events: [{
      id: 1, action: "link.update", metadata: { fields: ["destination"] }, created_at: "2026-09-06T10:00:00Z",
    }] });
    expect(decoded.events[0]).toEqual(jasmine.objectContaining({ id: 1, action: "link.update", user_id: null }));
    expect(() => decodeLinkActivityResponse({ events: [{ id: 1, action: "link.update", metadata: [], created_at: "now" }] })).toThrow();
  });

  it("keeps the link activity truncation flag instead of assuming a full history", () => {
    const events = [{ id: 1, action: "link.update", metadata: null, created_at: "2026-09-06T10:00:00Z" }];
    expect(decodeLinkActivityResponse({ events, truncated: true }).truncated).toBe(true);
    expect(decodeLinkActivityResponse({ events, truncated: false }).truncated).toBe(false);
    // An older backend without the flag must not make the panel claim the list
    // was cut; `true` is the only value that raises the notice.
    expect(decodeLinkActivityResponse({ events }).truncated).toBe(false);
    expect(decodeLinkActivityResponse({ events, truncated: "yes" }).truncated).toBe(false);
  });

  it("decodes domain lists, creation and state transitions", () => {
    expect(decodeDomainsResponse({ domains: [domain] })).toEqual({ domains: [domain] });
    expect(decodeCreatedDomainResponse({ domain })).toEqual({ domain });
    expect(decodeDomainStateResponse({ ok: true, state: "verifying" })).toEqual({ state: "verifying" });
    expect(() => decodeDomainStateResponse({ state: "unknown" })).toThrow();
  });

  it("rejects malformed domain booleans and oversized collections", () => {
    expect(() => decodeDomainsResponse({ domains: [{ ...domain, edgeEligible: 1 }] })).toThrow();
    expect(() => decodeDomainsResponse({ domains: Array.from({ length: 21 }, () => domain) })).toThrow();
  });

  it("binds domain detail identity and enforces viewer challenge redaction", () => {
    expect(decodeDomainDetailResponse({ domain }, domain.id, true)).toEqual({ domain });
    const viewerDomain = { ...domain, verificationHost: null, verificationToken: null };
    expect(decodeDomainDetailResponse({ domain: viewerDomain }, domain.id, false)).toEqual({ domain: viewerDomain });
    expect(() => decodeDomainDetailResponse({ domain }, domain.id, false)).toThrow();
    expect(() => decodeDomainDetailResponse({ domain }, domain.id + 1, true)).toThrow();
  });

  it("accepts only context-bound trash rows with ordered ISO purge dates", () => {
    const trashed = { ...link, state: "deleted" as const };
    const page: LinkTrashResponse = { links: [{ link: trashed, previousState: "active", deletedAt: "2026-09-01T10:00:00Z", purgeAt: "2026-10-01T10:00:00Z" }], total: 1, page: 1, perPage: 20, retentionDays: 30 };
    expect(decodeLinkTrashResponse(page, { page: 1, perPage: 20 })).toEqual(page);
    expect(() => decodeLinkTrashResponse({ ...page, page: 2 }, { page: 1, perPage: 20 })).toThrow();
    expect(() => decodeLinkTrashResponse({ ...page, links: [{ ...page.links[0], purgeAt: "not-a-date" }] }, { page: 1, perPage: 20 })).toThrow();
    expect(() => decodeLinkTrashResponse({ ...page, links: [{ ...page.links[0], purgeAt: page.links[0].deletedAt }] }, { page: 1, perPage: 20 })).toThrow();
  });
});
