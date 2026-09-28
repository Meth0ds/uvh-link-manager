import type { ActivatedRoute } from "@angular/router";
import { authBearer, bearerExpiry, hasAuthBearer, intentBearer } from "./auth-bearer";

/** Minimal route stub: the two carriers a link can arrive in. */
function route(fragment: string | null, query: Record<string, string> = {}): ActivatedRoute {
  return {
    snapshot: {
      fragment,
      // `ParamMap.get` answers `null` for a key that is not there; a `Map`
      // answers `undefined`, and that difference is the one this stub has to
      // keep or it would test a contract the router does not have.
      queryParamMap: {
        get: (key: string) => query[key] ?? null,
        has: (key: string) => Object.hasOwn(query, key),
      } as never,
    },
  } as unknown as ActivatedRoute;
}

describe("auth-bearer", () => {
  const token = "peIU1MjEBo77UdZauxlQtw2nx4rxOgiObdGqcHkW2ss";

  it("reads a bearer from the fragment the router already decoded", () => {
    expect(authBearer(route(`token=${token}`))).toBe(token);
    expect(intentBearer(route(`intent=${token}`))).toBe(token);
  });

  it("keeps a plus in the declared deadline instead of reading it as a space", () => {
    // The router decodes `%2B` to `+` before the app sees the fragment; form
    // encoding would turn it back into a space and lose the UTC offset.
    const expiry = "2026-09-28T14:00:54+00:00";
    expect(bearerExpiry(route(`token=${token}&expiresAt=2026-09-28T14%3A00%3A54%2B00%3A00`)))
      .toBe(expiry);
    expect(Number.isFinite(Date.parse(bearerExpiry(route(`token=${token}&expiresAt=2026-09-28T14%3A00%3A54%2B00%3A00`))!)))
      .toBe(true);
  });

  it("still reads links emitted before fragments carried the bearer", () => {
    expect(authBearer(route(null, { token }))).toBe(token);
    expect(bearerExpiry(route(null, { expiresAt: "2026-09-28T14:00:54+00:00" }))).toBe("2026-09-28T14:00:54+00:00");
  });

  it("reports nothing when the link carries neither", () => {
    expect(authBearer(route(null))).toBe("");
    expect(bearerExpiry(route(null))).toBeNull();
  });

  it("rejects malformed email-action bearers from fragments and legacy query links", () => {
    expect(authBearer(route("token=preview-only"))).toBe("");
    expect(authBearer(route(null, { token: "preview-only" }))).toBe("");
    expect(authBearer(route(`token=${"a".repeat(44)}`))).toBe("");
    expect(authBearer(route(`token=${"a".repeat(42)}!`))).toBe("");
  });

  it("distinguishes an explicit bad bearer from an absent bearer", () => {
    expect(hasAuthBearer(route("token=preview-only"))).toBeTrue();
    expect(hasAuthBearer(route("token="))).toBeTrue();
    expect(hasAuthBearer(route(null, { token: "" }))).toBeTrue();
    expect(hasAuthBearer(route(null))).toBeFalse();
  });

  it("does not substitute a query bearer when the fragment explicitly has an empty bearer", () => {
    expect(authBearer(route("token=", { token }))).toBe("");
    expect(authBearer(route("token=preview-only", { token }))).toBe("");
  });
});
