import { decodeLinkName } from "./link-name-decoder";
import { Injectable, computed, inject } from "@angular/core";
import { ApiService } from "./api.service";
import { AuthService } from "./auth.service";
import { WorkspaceService } from "./workspace.service";
import { boolean, boundedArray, httpUrl, integer, invalid, literal, record, text } from "./response-decoder-helpers";
import { LINK_STATES } from "../link-state-label";
import type { LinkState } from "../models";
import { canEditLinks, visiblePanelNavigation } from "../../panel/panel-navigation";

export interface SearchLink { id: number; name: string | null; shortUrl: string; state: LinkState }
export interface SearchDomain { id: number; hostname: string; state: "online" | "degraded" | "provisioning" | "offline" }
export interface GlobalSearchResponse { version: 1; links: SearchLink[]; domains: SearchDomain[]; moreLinks: boolean; moreDomains: boolean }
const DOMAIN_STATES = new Set<SearchDomain["state"]>(["online", "degraded", "provisioning", "offline"]);

export function decodeGlobalSearch(value: unknown): GlobalSearchResponse {
  const source = record(value, "global search");
  if (source["version"] !== 1) invalid("global search version");
  const links = boundedArray(source["links"], "search links", 10).map(value => {
    const row = record(value, "search link");
    const name = decodeLinkName(row["name"]);
    if (name !== null && /[\p{Cc}\p{Cf}]/u.test(name)) invalid("search name");
    const state = literal(row["state"], LINK_STATES, "search link state");
    if (state === "deleted") invalid("search deleted link");
    return { id: integer(row["id"], "search link id", 1), name, shortUrl: httpUrl(row["shortUrl"], "search short URL"), state };
  });
  const domains = boundedArray(source["domains"], "search domains", 5).map(value => {
    const row = record(value, "search domain");
    return { id: integer(row["id"], "search domain id", 1), hostname: text(row["hostname"], "search hostname", 253), state: literal(row["state"], DOMAIN_STATES, "search domain state") };
  });
  if (new Set(links.map(link => link.id)).size !== links.length || new Set(domains.map(domain => domain.id)).size !== domains.length) invalid("duplicate search results");
  return { version: 1, links, domains, moreLinks: boolean(source["moreLinks"], "more links"), moreDomains: boolean(source["moreDomains"], "more domains") };
}

@Injectable({ providedIn: "root" })
export class GlobalSearchService {
  private readonly api = inject(ApiService);
  readonly auth = inject(AuthService);
  readonly workspaces = inject(WorkspaceService);
  readonly navigation = computed(() => visiblePanelNavigation(this.auth.user(), this.workspaces.currentRole()));
  readonly canCreate = computed(() => canEditLinks(this.auth.user(), this.workspaces.currentRole()));
  context(): string {
    const user = this.auth.user();
    return JSON.stringify([this.auth.sessionGeneration(), user?.id, user?.emailVerified, user?.isAdmin,
      this.workspaces.currentId(), this.workspaces.selectionGeneration(), this.workspaces.currentRole(),
      this.workspaces.list().map(workspace => [workspace.id, workspace.role])]);
  }
  search(q: string, signal: AbortSignal): Promise<GlobalSearchResponse> {
    return this.api.get("/api/v1/search", { q }, decodeGlobalSearch, { signal });
  }
}
