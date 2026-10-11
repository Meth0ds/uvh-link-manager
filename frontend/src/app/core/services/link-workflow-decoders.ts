import type { DestinationInspection, ExpiredPageSpec, LinkFilterSpec, LinkNoticeContent, LinkWorkflowCapabilities, SavedLinkFilter } from "../link-workflows";
import { boolean, boundedArray, finiteNumber, httpUrl, integer, invalid, literal, nullableInteger, nullableMultiline, nullableText, record, text } from "./response-decoder-helpers";

const SORTS = new Set(["created_at_desc", "created_at_asc", "clicks_desc", "alias_asc", "name_asc", "name_desc"]);
function notice(value: unknown): LinkNoticeContent {
  const r = record(value, "link notice");
  const title = text(r["title"], "notice title", 80), message = nullableMultiline(r["message"], "notice message", 500) ?? "";
  const buttonLabel = text(r["buttonLabel"], "notice button", 40, true);
  const buttonUrl = r["buttonUrl"] === null ? null : httpUrl(r["buttonUrl"], "notice button URL");
  if (!message || /[<>]/.test(title + message + buttonLabel) || Boolean(buttonLabel) !== Boolean(buttonUrl)) invalid("link notice");
  return { title, message, buttonLabel, buttonUrl };
}
export function decodeExpiredPage(value: unknown): ExpiredPageSpec {
  const r = record(value, "expired page");
  if (r["version"] !== 1) invalid("expired page version");
  return { version: 1, enabled: boolean(r["enabled"], "expired page enabled"), expired: notice(r["expired"]), exhausted: notice(r["exhausted"]) };
}
export function decodeFilterSpec(value: unknown): LinkFilterSpec {
  const r = record(value, "filter spec");
  if (r["version"] !== 1) invalid("filter version");
  return { version: 1, q: text(r["q"], "filter search", 300, true), state: r["state"] === "" ? "" : literal(r["state"], new Set(["active", "scheduled", "paused", "expired", "archived", "blocked"] as const), "filter state"),
    tag: text(r["tag"], "filter tag", 40, true), domainId: nullableInteger(r["domainId"], "filter domain", 1),
    collectionId: nullableInteger(r["collectionId"], "filter collection", 1), utmCampaign: text(r["utmCampaign"], "filter campaign", 100, true),
    favorites: boolean(r["favorites"], "filter favorites"), sort: literal(r["sort"], SORTS, "filter sort") };
}
function savedFilter(value: unknown): SavedLinkFilter {
  const r = record(value, "saved filter");
  const valid = boolean(r["valid"], "filter validity");
  const invalidReferences = boundedArray(r["invalidReferences"], "filter references", 3).map(v => literal(v, new Set(["tag", "domainId", "collectionId"]), "filter reference"));
  if (valid !== (invalidReferences.length === 0) || new Set(invalidReferences).size !== invalidReferences.length) invalid("filter validity");
  return { id: integer(r["id"], "filter id", 1), name: text(r["name"], "filter name", 80), spec: decodeFilterSpec(r["spec"]),
    version: integer(r["version"], "filter revision", 1), valid, invalidReferences };
}
export function decodeSavedFilters(value: unknown): { filters: SavedLinkFilter[] } {
  const r = record(value, "saved filters"); return { filters: boundedArray(r["filters"], "saved filters", 50).map(savedFilter) };
}
export function decodeSavedFilter(value: unknown): { filter: SavedLinkFilter } { return { filter: savedFilter(record(value, "saved filter response")["filter"]) }; }
export function decodeFavorite(value: unknown): { favorite: boolean } { return { favorite: boolean(record(value, "favorite")["favorite"], "favorite flag") }; }
export function decodeWorkflows(value: unknown): LinkWorkflowCapabilities {
  const r = record(value, "link workflows");
  const ratio = finiteNumber(r["reminderClickRatio"], "reminder ratio"); if (ratio <= 0 || ratio >= 1) invalid("reminder ratio");
  return { enabled: boolean(r["enabled"], "workflows enabled"), reminderHours: integer(r["reminderHours"], "reminder hours", 1, 168),
    reminderClickRatio: ratio, maxSavedFilters: integer(r["maxSavedFilters"], "filter limit", 1, 50) };
}
export function decodeInspection(value: unknown): DestinationInspection {
  const r = record(record(value, "inspection response")["inspection"], "inspection");
  const id = text(r["id"], "inspection id", 36); if (!/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(id)) invalid("inspection id");
  const status = literal(r["status"], new Set(["pending", "ready", "stale"] as const), "inspection status");
  if (r["result"] === null) { if (status === "ready") invalid("ready inspection"); return { id, status, result: null }; }
  const d = record(r["result"], "inspection result"); if (d["version"] !== 1 || status !== "ready") invalid("inspection result state");
  const httpStatus = d["httpStatus"] === null ? null : integer(d["httpStatus"], "HTTP status", 100, 599);
  const iconUrl = nullableText(d["iconUrl"], "inspection icon", 180);
  if (iconUrl !== null && iconUrl !== `/api/v1/destination-inspections/${id}/icon`) invalid("inspection icon origin");
  const checkedAt = text(d["checkedAt"], "inspection timestamp", 64); if (!Number.isFinite(Date.parse(checkedAt))) invalid("inspection timestamp");
  return { id, status, result: { version: 1, status: literal(d["status"], new Set(["reachable", "restricted", "http_error", "network_error", "not_checkable"] as const), "destination status"),
    httpStatus, title: nullableText(d["title"], "destination title", 200),
    domain: text(d["domain"], "destination domain", 253), iconUrl, checkedAt, reason: nullableText(d["reason"], "destination reason", 200) } };
}
