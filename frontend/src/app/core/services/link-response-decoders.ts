import type { AnalyticsOverview, AuditEvent, LinkDetailResponse, LinkDto, LinksResponse, LinkState, LinkTrashResponse, RedirectRule } from "../models";
import {
  boolean,
  boundedArray,
  httpUrl,
  integer,
  invalid,
  literal,
  nullableInteger,
  nullableText,
  record,
  text,
} from "./response-decoder-helpers";

const LINK_STATES = new Set<LinkState>(["scheduled", "active", "paused", "expired", "blocked", "archived", "deleted"]);
const DEVICES = new Set<NonNullable<RedirectRule["device"]>>(["desktop", "mobile", "tablet"]);

function isoTimestamp(value: unknown, contract: string): string {
  const decoded = text(value, contract, 64);
  if (!/^\d{4}-\d{2}-\d{2}T/.test(decoded) || !Number.isFinite(Date.parse(decoded))) invalid(contract);
  return decoded;
}

function link(value: unknown): LinkDto {
  const source = record(value, "link");
  const alias = text(source["alias"], "link alias", 64);
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(alias)) invalid("link alias");
  const tags = boundedArray(source["tags"], "link tags", 20).map((tag) => text(tag, "link tag", 40));
  if (new Set(tags.map((tag) => tag.toLocaleLowerCase())).size !== tags.length) invalid("link tags");
  const utmSource = record(source["utm"], "link UTM");
  return {
    id: integer(source["id"], "link", 1),
    alias,
    destination: httpUrl(source["destination"], "link destination"),
    fallbackDestination: source["fallbackDestination"] === null
      ? null : httpUrl(source["fallbackDestination"], "link fallback destination"),
    state: literal(source["state"], LINK_STATES, "link state"),
    clickCount: integer(source["clickCount"], "link click count"),
    maxClicks: nullableInteger(source["maxClicks"], "link maximum clicks", 1),
    singleUse: boolean(source["singleUse"], "link single-use flag"),
    usedAt: nullableText(source["usedAt"], "link used timestamp", 64),
    scheduledAt: nullableText(source["scheduledAt"], "link schedule timestamp", 64),
    expiresAt: nullableText(source["expiresAt"], "link expiry timestamp", 64),
    notes: nullableText(source["notes"], "link notes", 1000, true),
    passwordProtected: boolean(source["passwordProtected"], "link password flag"),
    utm: {
      source: nullableText(utmSource["source"], "link UTM source", 100, true),
      medium: nullableText(utmSource["medium"], "link UTM medium", 100, true),
      campaign: nullableText(utmSource["campaign"], "link UTM campaign", 100, true),
      term: nullableText(utmSource["term"], "link UTM term", 100, true),
      content: nullableText(utmSource["content"], "link UTM content", 100, true),
    },
    domainId: nullableInteger(source["domainId"], "link domain", 1),
    domain: nullableText(source["domain"], "link domain", 253),
    tags,
    createdAt: text(source["createdAt"], "link creation timestamp", 64),
    updatedAt: text(source["updatedAt"], "link update timestamp", 64),
    version: integer(source["version"], "link version", 1),
    shortUrl: httpUrl(source["shortUrl"], "link short URL"),
  };
}

function rule(value: unknown): RedirectRule {
  const source = record(value, "redirect rule");
  const device = source["device"] === null ? null : literal(source["device"], DEVICES, "redirect device");
  const country = nullableText(source["country"], "redirect country", 2);
  if (country !== null && !/^[a-z]{2}$/i.test(country)) invalid("redirect country");
  const language = nullableText(source["language"], "redirect language", 8);
  if (language !== null && !/^[a-z]{2,3}(?:-[a-z0-9]{2,4})?$/i.test(language)) invalid("redirect language");
  const timeFrom = nullableText(source["timeFrom"], "redirect start time", 5);
  const timeTo = nullableText(source["timeTo"], "redirect end time", 5);
  if ((timeFrom !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(timeFrom))
    || (timeTo !== null && !/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(timeTo))) invalid("redirect time");
  return {
    id: integer(source["id"], "redirect rule", 1),
    priority: integer(source["priority"], "redirect priority", 0, 1000),
    country,
    language,
    device,
    os: nullableText(source["os"], "redirect OS", 40, true),
    timeFrom,
    timeTo,
    referrer: nullableText(source["referrer"], "redirect referrer", 200, true),
    campaign: nullableText(source["campaign"], "redirect campaign", 100, true),
    destination: httpUrl(source["destination"], "redirect destination"),
  };
}

export interface LinksPageContext {
  page: number;
  perPage: number;
}

/** Rebuild a whole page before it can replace the current tenant listing. */
export function decodeLinksResponse(value: unknown, expected?: LinksPageContext): LinksResponse {
  const source = record(value, "links page");
  const page = integer(source["page"], "links page", 1, 10_000);
  const perPage = integer(source["perPage"], "links page", 1, 100);
  const total = integer(source["total"], "links page");
  const links = boundedArray(source["links"], "links page", perPage).map(link);
  if (links.length > total || (expected && (page !== expected.page || perPage !== expected.perPage))) invalid("links page context");
  return { links, total, page, perPage };
}

/** Deleted rows have their own envelope so purge policy can never be inferred in the browser. */
export function decodeLinkTrashResponse(value: unknown, expected: LinksPageContext): LinkTrashResponse {
  const source = record(value, "link trash");
  const page = integer(source["page"], "link trash", 1, 10_000);
  const perPage = integer(source["perPage"], "link trash", 1, 100);
  const total = integer(source["total"], "link trash");
  const retentionDays = integer(source["retentionDays"], "link trash retention", 1, 3650);
  if (page !== expected.page || perPage !== expected.perPage) invalid("link trash context");
  const links = boundedArray(source["links"], "link trash", perPage).map((value) => {
    const row = record(value, "trashed link");
    const decoded = link(row["link"]);
    const previous = row["previousState"] === null ? null : literal(row["previousState"], LINK_STATES, "trashed link previous state");
    if (decoded.state !== "deleted" || previous === "deleted") invalid("trashed link state");
    const deletedAt = isoTimestamp(row["deletedAt"], "trashed link deletion");
    const purgeAt = isoTimestamp(row["purgeAt"], "trashed link purge");
    if (Date.parse(purgeAt) <= Date.parse(deletedAt)) invalid("trashed link purge order");
    return {
      link: decoded,
      previousState: previous,
      deletedAt,
      purgeAt,
    };
  });
  if (links.length > total) invalid("link trash total");
  return { links, total, page, perPage, retentionDays };
}

export function decodeLinkResponse(value: unknown, expectedLinkId?: number): { link: LinkDto } {
  const source = record(value, "link response");
  const decoded = link(source["link"]);
  if (expectedLinkId !== undefined && decoded.id !== expectedLinkId) invalid("link response context");
  return { link: decoded };
}

export function decodeLinkDetailResponse(value: unknown, expectedLinkId?: number): LinkDetailResponse {
  const source = record(value, "link detail");
  const decodedLink = link(source["link"]);
  if (expectedLinkId !== undefined && decodedLink.id !== expectedLinkId) invalid("link detail context");
  return {
    link: decodedLink,
    rules: boundedArray(source["rules"], "redirect rules", 20).map(rule),
  };
}

export function decodeRulesResponse(value: unknown): { rules: RedirectRule[] } {
  const source = record(value, "redirect rules response");
  return { rules: boundedArray(source["rules"], "redirect rules", 20).map(rule) };
}

export function decodeAliasAvailability(value: unknown): { available: boolean; reason?: string } {
  const source = record(value, "alias availability");
  const available = boolean(source["available"], "alias availability");
  if (source["reason"] === undefined) return { available };
  return { available, reason: literal(source["reason"], new Set(["reserved", "invalid", "domain"]), "alias reason") };
}

function dimension(value: unknown, contract: string): Array<{ key: string; value: number }> {
  return boundedArray(value, contract, 8).map((item) => {
    const source = record(item, contract);
    return { key: text(source["key"], contract, 255), value: integer(source["value"], contract) };
  });
}

export function decodeAnalyticsOverview(value: unknown): AnalyticsOverview {
  const source = record(value, "analytics overview");
  const totals = record(source["totals"], "analytics totals");
  const dimensionTotals = record(source["dimensionTotals"], "analytics dimension totals");
  const countries = dimension(source["countries"], "analytics countries");
  const devices = dimension(source["devices"], "analytics devices");
  const browsers = dimension(source["browsers"], "analytics browsers");
  const os = dimension(source["os"], "analytics operating systems");
  const referrers = dimension(source["referrers"], "analytics referrers");
  const campaigns = dimension(source["campaigns"], "analytics campaigns");
  const decodedDimensionTotals = {
    countries: integer(dimensionTotals["countries"], "analytics country total"),
    devices: integer(dimensionTotals["devices"], "analytics device total"),
    browsers: integer(dimensionTotals["browsers"], "analytics browser total"),
    os: integer(dimensionTotals["os"], "analytics operating-system total"),
    referrers: integer(dimensionTotals["referrers"], "analytics referrer total"),
    campaigns: integer(dimensionTotals["campaigns"], "analytics campaign total"),
  };
  // A total smaller than the returned top-eight list proves that the response
  // mixed incompatible queries or contracts; reject it before rendering.
  if (decodedDimensionTotals.countries < countries.length
    || decodedDimensionTotals.devices < devices.length
    || decodedDimensionTotals.browsers < browsers.length
    || decodedDimensionTotals.os < os.length
    || decodedDimensionTotals.referrers < referrers.length
    || decodedDimensionTotals.campaigns < campaigns.length) invalid("analytics dimension totals");
  return {
    totals: { clicks: integer(totals["clicks"], "analytics totals"), visitors: integer(totals["visitors"], "analytics totals") },
    visitorMetric: literal(source["visitorMetric"], new Set(["daily_pseudonyms"]), "analytics visitor metric"),
    series: boundedArray(source["series"], "analytics series", 181).map((item) => {
      const row = record(item, "analytics series");
      return { day: text(row["day"], "analytics day", 16), clicks: integer(row["clicks"], "analytics series"), visitors: integer(row["visitors"], "analytics series") };
    }),
    topLinks: boundedArray(source["topLinks"], "analytics top links", 8).map((item) => {
      const row = record(item, "analytics top link");
      return {
        id: integer(row["id"], "analytics top link", 1),
        alias: text(row["alias"], "analytics top link", 64),
        destination: httpUrl(row["destination"], "analytics top link"),
        clicks: integer(row["clicks"], "analytics top link"),
        visitors: integer(row["visitors"], "analytics top link"),
      };
    }),
    countries,
    devices,
    browsers,
    os,
    referrers,
    campaigns,
    dimensionTotals: decodedDimensionTotals,
  };
}

export function decodeLinkActivityResponse(value: unknown): { events: AuditEvent[] } {
  const source = record(value, "link activity");
  const events = boundedArray(source["events"], "link activity", 50).map((item): AuditEvent => {
    const event = record(item, "link activity event");
    const metadata = event["metadata"];
    if (metadata !== null && typeof metadata !== "string" && (typeof metadata !== "object" || Array.isArray(metadata))) invalid("link activity metadata");
    return {
      id: integer(event["id"], "link activity event", 1),
      user_id: null,
      action: text(event["action"], "link activity event", 255),
      resource_type: null,
      resource_id: null,
      metadata: metadata as string | Record<string, unknown> | null,
      ip_hash: null,
      created_at: text(event["created_at"], "link activity event", 64),
    };
  });
  return { events };
}
