import { TestBed } from "@angular/core/testing";
import { provideHttpClient } from "@angular/common/http";
import { provideHttpClientTesting, HttpTestingController } from "@angular/common/http/testing";
import { decodeGlobalSearch, GlobalSearchService } from "./global-search.service";
import { SessionContextService } from "./session-context.service";
import { WorkspaceService } from "./workspace.service";
import { isWorkspaceScopedPath } from "../api-request-scope";
import type { AuthUser } from "../models";

describe("Workspace global search contracts and ownership", () => {
  const empty = () => ({ version: 1, links: [], domains: [], moreLinks: false, moreDomains: false });
  const row = () => ({ id: 1, name: "Carta 🍽", shortUrl: "https://uvh.test/carta", state: "active" });
  const user: AuthUser = { id: 1, name: "Ana", email: "ana@example.test", isAdmin: false, emailVerified: true, mfaEnabled: false };
  it("accepts bounded results and rejects unsupported versions, unsafe URLs and deleted links", () => {
    expect(decodeGlobalSearch({ ...empty(), links: [row()] }).links[0].name).toBe("Carta 🍽");
    for (const change of [{ version: 2 }, { moreLinks: "true" }, { links: Array.from({ length: 11 }, row) }, { links: [row(), row()] }, { links: [{ ...row(), state: "deleted" }] }, { links: [{ ...row(), shortUrl: "javascript:alert(1)" }] }, { links: [{ ...row(), name: "hidden\u202e" }] }]) expect(() => decodeGlobalSearch({ ...empty(), ...change })).toThrow();
  });
  it("is a workspace scoped request even with query parameters", () => {
    expect(isWorkspaceScopedPath("/api/v1/search?q=carta")).toBeTrue();
    expect(isWorkspaceScopedPath("/api/v1/search-foreign")).toBeFalse();
  });
  it("shares navigation permissions and denies creating to readers", () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const session = TestBed.inject(SessionContextService); session.user.set(user);
    const workspaces = TestBed.inject(WorkspaceService);
    workspaces.setList([{ id: 1, name: "A", slug: "a", role: "viewer", createdAt: "2026-10-11T00:00:00Z" }]);
    const search = TestBed.inject(GlobalSearchService);
    expect(search.canCreate()).toBeFalse();
    expect(search.navigation().flatMap(group => group.items).some(item => item.path === "/app/activity" || item.path === "/app/admin")).toBeFalse();
    workspaces.setList([{ ...workspaces.list()[0], role: "owner" }]);
    expect(search.canCreate()).toBeTrue();
    expect(search.navigation().flatMap(group => group.items).some(item => item.path === "/app/activity")).toBeTrue();
  });
  it("aborts a read without allowing an old response to survive a workspace change", async () => {
    TestBed.configureTestingModule({ providers: [provideHttpClient(), provideHttpClientTesting()] });
    const session = TestBed.inject(SessionContextService); session.user.set(user);
    const workspaces = TestBed.inject(WorkspaceService); workspaces.setList([{ id: 1, name: "A", slug: "a", role: "owner", createdAt: "2026-10-11T00:00:00Z" }]);
    const search = TestBed.inject(GlobalSearchService); const controller = new AbortController();
    const result = search.search("carta", controller.signal).catch(error => error);
    const http = TestBed.inject(HttpTestingController); const request = http.expectOne("/api/v1/search?q=carta");
    const previous = search.context(); workspaces.select(2); controller.abort();
    expect(search.context()).not.toBe(previous); expect(request.cancelled).toBeTrue();
    expect(await result).toEqual(jasmine.any(Error)); http.verify();
  });
});
