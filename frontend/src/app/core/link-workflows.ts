import type { LinkState } from "./models";

export interface LinkNoticeContent { title: string; message: string; buttonLabel: string; buttonUrl: string | null }
export interface ExpiredPageSpec { version: 1; enabled: boolean; expired: LinkNoticeContent; exhausted: LinkNoticeContent }
export interface LinkFilterSpec {
  version: 1; q: string; state: "" | LinkState; tag: string; domainId: number | null;
  collectionId: number | null; utmCampaign: string; favorites: boolean; sort: string;
}
export interface SavedLinkFilter { id: number; name: string; spec: LinkFilterSpec; version: number; valid: boolean; invalidReferences: string[] }
export interface LinkWorkflowCapabilities { enabled: boolean; ruleSimulator: boolean; linkHistory: boolean; linkHistoryRestore: boolean; reminderHours: number; reminderClickRatio: number; maxSavedFilters: number }
export interface DestinationResult {
  version: 1; status: "reachable" | "restricted" | "http_error" | "network_error" | "not_checkable";
  httpStatus: number | null; title: string | null; domain: string; iconUrl: string | null; checkedAt: string; reason: string | null;
}
export interface DestinationInspection { id: string; status: "pending" | "ready" | "stale"; result: DestinationResult | null }

export function emptyLinkFilter(): LinkFilterSpec {
  return { version: 1, q: "", state: "", tag: "", domainId: null, collectionId: null, utmCampaign: "", favorites: false, sort: "created_at_desc" };
}
export function defaultExpiredPage(): ExpiredPageSpec {
  return { version: 1, enabled: false,
    expired: { title: "Este enlace ha caducado", message: "El contenido ya no está disponible. Puedes pedir un enlace nuevo a quien te lo compartió.", buttonLabel: "", buttonUrl: null },
    exhausted: { title: "Este enlace se ha agotado", message: "Este enlace ha alcanzado su límite de usos. Puedes pedir un enlace nuevo a quien te lo compartió.", buttonLabel: "", buttonUrl: null } };
}
