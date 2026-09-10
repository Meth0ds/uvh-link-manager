/** Fictional read responses, compiled only by the explicit preview entry point.
 * There is no HttpClient/fetch fallback: unrecognised reads and ALL writes fail.
 * Never import this module from src/ or treat it as authorization evidence.
 */
import { signal } from "@angular/core";
import type { AnalyticsOverview, LinkDto, WorkspaceGettingStarted } from "../src/app/core/models";
import { ApiRequestError } from "../src/app/core/services/api.service";

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
  domainId: null, domain: null, tags: [], createdAt: "2026-09-08T12:00:00Z", updatedAt: "2026-09-08T12:00:00Z", version: 1,
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
    devices: [], browsers: [], os: [], referrers: [], campaigns: [],
    dimensionTotals: { countries: empty ? 0 : 3, devices: 0, browsers: 0, os: 0, referrers: 0, campaigns: 0 },
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
  else if (path === "/api/v1/links") value = { links: empty ? [] : links, total: empty ? 0 : links.length, page: 1, perPage: 5 };
  else if (path === `/api/v1/workspaces/${currentId()}/getting-started`) {
    const viewer = currentId() === 2;
    value = { workspaceId: currentId(), role: viewer ? "viewer" : "owner",
      facts: { linkPresent: !empty, redirectObserved: !empty, mfaEnabled: false, domainPresent: false, teammatePresent: false, invitationPending: viewer ? null : false },
      capabilities: { createLink: !viewer, addDomain: !viewer, inviteTeam: !viewer },
    } satisfies WorkspaceGettingStarted;
  } else return blocked();
  // Exercise the real read decoder as well as the actual component template.
  if (!decoder) throw new Error("Preview read requires an explicit decoder");
  return decoder(value);
}
