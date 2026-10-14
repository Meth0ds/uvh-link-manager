import type {
  AnalyticsReport,
  PublicReport,
  ReportSection,
  ReportSpec,
  SocialPreviewSpec,
} from "../sharing";
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
const SECTIONS = new Set<ReportSection>([
  "visits",
  "series",
  "countries",
  "devices",
]);
function sections(value: unknown): ReportSection[] {
  const result = boundedArray(value, "sections", 4).map((v) =>
    literal(v, SECTIONS, "section"),
  );
  if (!result.length || new Set(result).size !== result.length)
    invalid("sections");
  return result;
}
function date(value: unknown): string {
  const result = text(value, "date", 64);
  if (
    !/^\d{4}-\d{2}-\d{2}T/.test(result) ||
    !Number.isFinite(Date.parse(result))
  )
    invalid("date");
  return result;
}
function day(value: unknown): string {
  const result = text(value, "day", 10);
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(result) ||
    new Date(result).toISOString().slice(0, 10) !== result
  )
    invalid("day");
  return result;
}
function spec(value: unknown): ReportSpec {
  const s = record(value, "report spec");
  if (s["version"] !== 1) invalid("report version");
  return {
    version: 1,
    title: text(s["title"], "title", 120),
    description: text(s["description"], "description", 500, true),
    period: literal(
      s["period"],
      new Set(["7d", "30d", "90d", "custom"] as const),
      "period",
    ),
    from: s["from"] === null ? null : day(s["from"]),
    to: s["to"] === null ? null : day(s["to"]),
    sections: sections(s["sections"]),
  };
}
export function decodeReport(value: unknown): AnalyticsReport {
  const r = record(value, "report");
  return {
    id: integer(r["id"], "report id", 1),
    publicId: text(r["publicId"], "public id", 36),
    version: integer(r["version"], "report version", 1),
    spec: spec(r["spec"]),
    links: boundedArray(r["links"], "links", 100).map((v) => {
      const l = record(v, "link");
      return {
        linkId: integer(l["linkId"], "link id", 1),
        label: text(l["label"], "label", 120),
      };
    }),
    passwordProtected: boolean(r["passwordProtected"], "password"),
    expiresAt: r["expiresAt"] === null ? null : date(r["expiresAt"]),
    state: literal(
      r["state"],
      new Set(["active", "expired", "revoked", "needs_review"] as const),
      "report state",
    ),
    shareUrl: httpUrl(r["shareUrl"], "sharing url"),
  };
}
export function decodeReportResponse(value: unknown): {
  report: AnalyticsReport;
} {
  return { report: decodeReport(record(value, "report response")["report"]) };
}
export function decodeReportList(value: unknown): {
  reports: AnalyticsReport[];
  page: number;
  lastPage: number;
} {
  const r = record(value, "reports");
  return {
    reports: boundedArray(r["reports"], "reports", 20).map(decodeReport),
    page: integer(r["page"], "page", 1),
    lastPage: integer(r["lastPage"], "last page", 1),
  };
}
export function decodePublicReport(value: unknown): PublicReport {
  const r = record(value, "public report");
  if (r["version"] !== 1) invalid("public version");
  const dimension = (v: unknown) =>
    boundedArray(v, "dimension", 8).map((x) => {
      const o = record(x, "category");
      return {
        key: text(o["key"], "key", 100),
        value: integer(o["value"], "count"),
      };
    });
  return {
    version: 1,
    title: text(r["title"], "title", 120),
    description: text(r["description"], "description", 500, true),
    sections: sections(r["sections"]),
    labels: boundedArray(r["labels"], "labels", 100).map((v) =>
      text(v, "label", 120),
    ),
    from: date(r["from"]),
    to: date(r["to"]),
    updatedAt: date(r["updatedAt"]),
    retainedFrom: date(r["retainedFrom"]),
    visits: nullableInteger(r["visits"], "visits"),
    series: boundedArray(r["series"], "series", 182).map((x) => {
      const o = record(x, "point");
      return {
        day: day(o["day"]),
        visits: integer(o["visits"], "visits"),
        available: boolean(o["available"], "available"),
      };
    }),
    countries: dimension(r["countries"]),
    devices: dimension(r["devices"]),
  };
}
export function decodeSocialPreview(value: unknown): SocialPreviewSpec | null {
  if (value === null || value === undefined) return null;
  const s = record(value, "social preview");
  if (s["version"] !== 1) invalid("social version");
  const enabled = boolean(s["enabled"], "enabled");
  return {
    version: 1,
    enabled,
    title: text(s["title"], "social title", 120, !enabled),
    description: nullableText(
      s["description"],
      "social description",
      240,
      true,
    ),
    imageAssetId: nullableInteger(s["imageAssetId"], "image id", 1),
    imageAlt: nullableText(s["imageAlt"], "image alt", 160, true),
  };
}
