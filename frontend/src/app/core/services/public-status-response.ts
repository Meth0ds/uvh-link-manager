import type { PublicServiceStatus, PublicStatusSnapshot } from "../models";
import { boolean, boundedArray, literal, nullableText, record, text } from "./response-decoder-helpers";

const OVERALL = new Set<PublicServiceStatus>(["operational", "degraded", "major_outage", "maintenance", "unknown"]);
const COMPONENT_STATUS = new Set<Exclude<PublicServiceStatus, "unknown">>(["operational", "degraded", "major_outage", "maintenance"]);
const COMPONENT_IDS = new Set<"links" | "panel" | "webhooks">(["links", "panel", "webhooks"]);
const INCIDENT_STATUS = new Set<PublicStatusSnapshot["incidents"][number]["status"]>(["investigating", "identified", "monitoring", "resolved"]);
const SOURCES = new Set<PublicStatusSnapshot["source"]>(["external_monitor", "external_monitor_unavailable"]);

function date(value: unknown, nullable = false): string | null {
  const decoded = nullable ? nullableText(value, "public status timestamp", 64) : text(value, "public status timestamp", 64);
  if (decoded !== null && (!/^\d{4}-\d{2}-\d{2}T/.test(decoded) || !Number.isFinite(Date.parse(decoded)))) throw new Error("Invalid public status response");
  return decoded;
}

export function decodePublicStatus(value: unknown): PublicStatusSnapshot {
  const source = record(value, "public status");
  const overall = literal(source["overall"], OVERALL, "public status");
  const stale = boolean(source["stale"], "public status stale flag");
  const feed = literal(source["source"], SOURCES, "public status source");
  const components = boundedArray(source["components"], "public status components", 3).map((item) => {
    const row = record(item, "public status component");
    return { id: literal(row["id"], COMPONENT_IDS, "public status component"), label: text(row["label"], "public status component", 80), status: literal(row["status"], COMPONENT_STATUS, "public status component") };
  });
  if (new Set(components.map((item) => item.id)).size !== components.length || (feed === "external_monitor" && components.length !== 3)) throw new Error("Invalid public status response");
  const incidents = boundedArray(source["incidents"], "public status incidents", 20).map((item) => {
    const row = record(item, "public status incident");
    return { id: text(row["id"], "public status incident", 80), title: text(row["title"], "public status incident", 160), message: text(row["message"], "public status incident", 1000), status: literal(row["status"], INCIDENT_STATUS, "public status incident"), startedAt: date(row["startedAt"])!, updatedAt: date(row["updatedAt"])! };
  });
  const generatedAt = date(source["generatedAt"], true);
  if ((feed === "external_monitor_unavailable") !== (overall === "unknown" && stale && generatedAt === null && components.length === 0 && incidents.length === 0)) throw new Error("Invalid public status response");
  return { overall, generatedAt, stale, source: feed, components, incidents };
}
