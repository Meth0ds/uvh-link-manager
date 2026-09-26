/** Fictional read responses, compiled only by the explicit preview entry point.
 * There is no HttpClient/fetch fallback: unrecognised reads and ALL writes fail.
 * Never import this module from src/ or treat it as authorization evidence.
 */
import { signal } from "@angular/core";
import type { AnalyticsOverview, LinkDto, WorkspaceGettingStarted } from "../src/app/core/models";
import { ApiRequestError } from "../src/app/core/services/api.service";
import { sampleStatus, sampleWebhook, sampleDeliveries } from "./service-fixture";

export type FixtureMode = "populated" | "empty" | "error" | "loading";
export const fixtureMode = signal<FixtureMode>("populated");
export const currentId = signal<number | null>(1);
export const blocked = (): Promise<never> => Promise.reject(new Error("Design preview has no backend"));

const aliases = ["cuaderno-de-verano", "edicion-limitada", "taller-de-identidad", "notas-del-estudio", "un-alias-deliberadamente-largo-para-revisar-la-lectura-en-movil"];
const states: LinkDto["state"][] = ["active", "paused", "scheduled", "active", "expired"];
const links: LinkDto[] = aliases.map((alias, i) => ({
  id: i + 1, alias, destination: `https://estudio.example.invalid/editorial/${alias}?origen=ejemplo-de-diseno`,
  shortUrl: `https://uvh.example.invalid/${alias}`, fallbackDestination: null, state: states[i],
  clickCount: [2318, 1084, 0, 675, 42][i], maxClicks: null, singleUse: false, usedAt: null,
  scheduledAt: null, expiresAt: null, notes: null, passwordProtected: false,
  utm: { source: null, medium: null, campaign: null, term: null, content: null },
  domainId: null, domain: null, collectionId: null, collection: null, tags: i % 2 ? ["editorial", "septiembre"] : ["campaña"], createdAt: "2026-09-08T12:00:00Z", updatedAt: "2026-09-08T12:00:00Z", version: 1,
}));

function sampleOverview(period: unknown, empty: boolean): AnalyticsOverview {
  const days = period === "24h" ? 1 : period === "7d" ? 7 : period === "90d" ? 90 : 30;
  const series = empty ? [] : Array.from({ length: days }, (_, i) => {
    const day = new Date(Date.UTC(2026, 8, 9 - days + i)).toISOString().slice(0, 10);
    return { day, clicks: 18 + (i * 13 % 67) + (i % 9 === 0 ? 44 : 0), visitors: 11 + (i * 7 % 23) };
  });
  const clicks = series.reduce((sum, row) => sum + row.clicks, 0);
  return {
    totals: { clicks, visitors: series.reduce((sum, row) => sum + row.visitors, 0) }, visitorMetric: "daily_pseudonyms", series,
    topLinks: empty ? [] : links.slice(0, 4).map((link, i) => ({ id: link.id, alias: link.alias, destination: link.destination, clicks: Math.floor(clicks / (i + 2)), visitors: 4 })),
    countries: empty ? [] : [{ key: "ES", value: Math.floor(clicks * .7) }, { key: "MX", value: Math.floor(clicks * .2) }, { key: "AR", value: clicks - Math.floor(clicks * .7) - Math.floor(clicks * .2) }],
    devices: empty ? [] : [{ key: "Móvil", value: Math.floor(clicks * .61) }, { key: "Escritorio", value: Math.floor(clicks * .34) }, { key: "Tablet", value: clicks - Math.floor(clicks * .61) - Math.floor(clicks * .34) }],
    browsers: empty ? [] : [{ key: "Chrome", value: Math.floor(clicks * .55) }, { key: "Safari", value: Math.floor(clicks * .3) }, { key: "Firefox", value: clicks - Math.floor(clicks * .55) - Math.floor(clicks * .3) }],
    os: empty ? [] : [{ key: "Android", value: Math.floor(clicks * .42) }, { key: "iOS", value: Math.floor(clicks * .31) }, { key: "Windows", value: clicks - Math.floor(clicks * .42) - Math.floor(clicks * .31) }],
    referrers: empty ? [] : [{ key: "Directo / desconocido", value: Math.floor(clicks * .58) }, { key: "newsletter.example.invalid", value: Math.floor(clicks * .27) }, { key: "revista.example.invalid", value: clicks - Math.floor(clicks * .58) - Math.floor(clicks * .27) }],
    campaigns: empty ? [] : [{ key: "lanzamiento-septiembre", value: Math.floor(clicks * .63) }, { key: "boletin-del-estudio", value: clicks - Math.floor(clicks * .63) }],
    dimensionTotals: { countries: empty ? 0 : 3, devices: empty ? 0 : 3, browsers: empty ? 0 : 3, os: empty ? 0 : 3, referrers: empty ? 0 : 3, campaigns: empty ? 0 : 2 },
  };
}

export async function fixtureRead<T>(path: string, params?: Record<string, unknown>, decoder?: (value: unknown) => T,
  options?: { signal?: AbortSignal }): Promise<T> {
  const mode = fixtureMode();
  if (mode === "error") throw new ApiRequestError("Error simulado. No se ha contactado con ningún servidor.", 503);
  if (mode === "loading") {
    // Remains visibly pending until a different scenario destroys the view.
    return new Promise<T>((_resolve, reject) => {
      const cancel = () => reject(new Error("Preview read cancelled"));
      if (options?.signal?.aborted) cancel();
      else options?.signal?.addEventListener("abort", cancel, { once: true });
    });
  }
  const empty = mode === "empty";
  let value: unknown;
  if (path === "/api/v1/analytics/overview") value = sampleOverview(params?.["period"], empty);
  else if (path === "/api/v1/public-status") value = sampleStatus();
  else if (path === "/api/v1/webhooks") value = { webhooks: empty && !location.pathname.match(/webhooks\/\d+/) ? [] : [sampleWebhook] };
  else if (path === "/api/v1/webhooks/9001/deliveries") value = { deliveries: empty ? [] : sampleDeliveries, total: empty ? 0 : sampleDeliveries.length, page: 1, perPage: 20 };
  else if (path === "/api/v1/tokens") value = { tokens: empty ? [] : [
    { id: 9001, name: "Publicación editorial", scopes: ["links:read", "links:write"],
      createdAt: "2026-09-08T12:00:00Z", lastUsedAt: "2026-09-12T12:00:00Z", expiresAt: "2026-12-31T12:00:00Z", revokedAt: null },
    { id: 9002, name: "IntegracionConNombreLargoSinEspaciosParaComprobarLaLecturaEnPantallasEstrechas", scopes: ["analytics:read", "domains:read", "domains:write"],
      createdAt: "2026-09-01T12:00:00Z", lastUsedAt: null, expiresAt: null, revokedAt: "2026-09-12T12:00:00Z" },
  ] };
  else if (path === "/api/v1/notifications/unread") value = { unread: empty ? 0 : 2 };
  else if (path === "/api/v1/notifications") value = { notifications: empty ? [] : [
    { id: 3, kind: "password_changed", subject: null, workspaceId: null, route: "/app/settings/security", createdAt: "2026-09-26T12:30:00Z", readAt: null },
    { id: 2, kind: "password_changed", subject: "CuentaEditorialConNombreLargoSinEspaciosParaComprobarQueNoSeRecortaEnUnaPantallaEstrecha", workspaceId: 1, route: "/app/settings/security", createdAt: "2026-09-25T08:00:00Z", readAt: null },
    { id: 1, kind: "password_changed", subject: "Cuenta de ejemplo", workspaceId: null, route: null, createdAt: "2026-09-24T09:15:00Z", readAt: "2026-09-24T10:00:00Z" },
  ], unread: empty ? 0 : 2, nextCursor: null };
  else if (/^\/api\/v1\/links\/\d+\/activity$/.test(path)) value = { events: [], truncated: false };
  else if (/^\/api\/v1\/links\/\d+$/.test(path)) value = { link: links.find(link => link.id === Number(path.split("/").pop())), rules: [], appeal: null, blockReason: null };
  else if (path === "/api/v1/links") {
    const q = String(params?.["q"] ?? "").toLowerCase();
    const filtered = empty ? [] : links.filter(link =>
      (!q || `${link.alias} ${link.destination}`.toLowerCase().includes(q)) &&
      (!params?.["state"] || link.state === params["state"]) &&
      (!params?.["tag"] || link.tags.includes(String(params["tag"]))));
    const page = Number(params?.["page"] ?? 1);
    const perPage = Number(params?.["perPage"] ?? 20);
    value = { links: filtered.slice((page - 1) * perPage, page * perPage), total: filtered.length, page, perPage };
  }
  else if (path === `/api/v1/workspaces/${currentId()}/getting-started`) {
    const workspaceId = currentId();
    if (workspaceId === null) return blocked();
    const viewer = currentId() === 2;
    value = { workspaceId, dismissedAt: null, role: viewer ? "viewer" : "owner",
      facts: { linkPresent: !empty, redirectObserved: !empty, mfaEnabled: false, domainPresent: false, teammatePresent: false, invitationPending: viewer ? null : false },
      capabilities: { createLink: !viewer, addDomain: !viewer, inviteTeam: !viewer },
    } satisfies WorkspaceGettingStarted;
  } else return blocked();
  // Exercise the real read decoder as well as the actual component template.
  if (!decoder) throw new Error("Preview read requires an explicit decoder");
  return decoder(value);
}
