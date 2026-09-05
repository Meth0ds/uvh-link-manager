import type { WorkspaceActivityEvent, WorkspaceActivityPage } from "../../core/models";

const record = (value: unknown): value is Record<string, unknown> => typeof value === "object" && value !== null && !Array.isArray(value);
const id = (value: unknown): value is string => typeof value === "string" && /^[1-9][0-9]{0,18}$/.test(value) && !/\s/.test(value);
const text = (value: unknown): value is string => typeof value === "string" && value.length > 0 && value.length <= 160 && !/[\u0000-\u001f\u007f]/.test(value);

/** Treat the wire response as unknown; only copy the public, bounded fields. */
export function readActivityPage(value: unknown, workspaceId: number, limit: number): WorkspaceActivityPage {
  const invalid = () => { throw new Error("Invalid workspace activity response"); };
  if (!record(value) || value["workspaceId"] !== workspaceId || value["coverage"] !== "attributed_events_only"
    || !Array.isArray(value["events"]) || value["events"].length > limit) return invalid();
  const cursor = value["nextCursor"];
  // Check transport shape only, not its encrypted meaning. Authorization and
  // cursor authenticity remain server responsibilities on every page.
  if (cursor !== null && (typeof cursor !== "string" || cursor.length === 0 || cursor.length > 2048
    || !/^[A-Za-z0-9+/]+={0,2}$/.test(cursor) || /\s/.test(cursor) || value["events"].length === 0)) return invalid();
  const seen = new Set<string>();
  const events = value["events"].map((item: unknown): WorkspaceActivityEvent => {
    if (!record(item) || !id(item["id"]) || seen.has(item["id"]) || !text(item["label"])
      || typeof item["action"] !== "string" || !text(item["action"]) || !/^[a-z_]+\.[a-z_]{1,80}$/.test(item["action"])
      || typeof item["outcome"] !== "string" || !["completed", "pending", "failed", "unknown"].includes(item["outcome"])
      || !record(item["actor"]) || !text(item["actor"]["label"])
      || (item["actor"]["id"] !== null && !id(item["actor"]["id"]))
      || !record(item["resource"]) || typeof item["resource"]["type"] !== "string"
      || !["link", "domain", "api_token", "webhook", "workspace"].includes(item["resource"]["type"])
      || (item["resource"]["id"] !== null && !id(item["resource"]["id"]))
      || typeof item["createdAt"] !== "string" || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}\+00:00$/.test(item["createdAt"])) return invalid();
    const date = item["createdAt"];
    const milliseconds = Date.parse(date);
    if (!Number.isFinite(milliseconds) || new Date(milliseconds).toISOString() !== date.slice(0, 23) + "Z") return invalid();
    seen.add(item["id"]);
    // Do not retain unexpected metadata in component state, even if a future
    // backend accidentally adds fields. Text is interpolated, never innerHTML.
    return {
      id: item["id"], action: item["action"], label: item["label"],
      outcome: item["outcome"] as WorkspaceActivityEvent["outcome"],
      actor: { id: item["actor"]["id"] as string | null, label: item["actor"]["label"] },
      resource: { type: item["resource"]["type"] as WorkspaceActivityEvent["resource"]["type"], id: item["resource"]["id"] as string | null },
      createdAt: date,
    };
  });
  return { workspaceId, events, nextCursor: cursor as string | null, coverage: "attributed_events_only" };
}
