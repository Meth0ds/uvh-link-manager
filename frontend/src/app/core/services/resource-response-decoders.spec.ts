import type { AnalyticsOverview, DomainDto, LinkDto } from "../models";
import { decodeCreatedDomainResponse, decodeDomainsResponse, decodeDomainStateResponse } from "./domain-response-decoders";
import {
  decodeAliasAvailability,
  decodeAnalyticsOverview,
  decodeLinkActivityResponse,
  decodeLinkDetailResponse,
  decodeLinkResponse,
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
  edgeEligible: false,
  tlsReadyAt: null,
  tlsError: null,
  createdAt: "2026-09-06T10:00:00Z",
};

const analytics: AnalyticsOverview = {
  totals: { clicks: 2, visitors: 1 },
  series: [{ day: "2026-09-06", clicks: 2, visitors: 1 }],
  topLinks: [{ id: 4, alias: "campaign", destination: "https://example.test", clicks: 2, visitors: 1 }],
  countries: [{ key: "ES", value: 2 }],
  devices: [],
  browsers: [],
  os: [],
  referrers: [],
  campaigns: [],
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
    expect(decodeLinkDetailResponse({ link, rules: [] }, 4)).toEqual({ link, rules: [] });
    expect(() => decodeLinkResponse({ link }, 9)).toThrow();
    expect(() => decodeLinkDetailResponse({ link, rules: [] }, 9)).toThrow();
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
});
