import type { ActivatedRoute } from "@angular/router";

/**
 * Credentials handed over in the URL fragment, as the router already decoded
 * them.
 *
 * The router decodes the fragment before this sees it, so a `+` here is a plus.
 * `URLSearchParams` reads form encoding, where `+` means a space, and would
 * turn the deadline of an invitation link (`2026-09-28T14:00:54+00:00`) into an
 * unparseable value — which is exactly how an invitation ended up refused as
 * "not available". Re-encoding the plus before parsing keeps the decoded value
 * intact.
 */
function fragmentParams(route: ActivatedRoute): URLSearchParams {
  return new URLSearchParams((route.snapshot.fragment ?? "").replace(/\+/g, "%2B"));
}

/**
 * A bearer handed over in the URL.
 *
 * The fragment is the right place for one: it never reaches the server, the
 * access log or a `Referer` header, and it is not sent anywhere if the page is
 * reloaded. Query parameters are kept readable only for links that were already
 * delivered before the change.
 */
function fragmentBearer(route: ActivatedRoute, key: string): string {
  const current = fragmentParams(route).get(key);
  if (current) return current;

  // Temporary compatibility for links emitted before bearer fragments were
  // introduced. New links never place credentials in the query string.
  return route.snapshot.queryParamMap.get(key) ?? "";
}

/** Read new fragment bearers while retaining compatibility with old query links. */
export function authBearer(route: ActivatedRoute): string {
  return fragmentBearer(route, "token");
}

/** Deadline the link declares next to its bearer, if it declares one. */
export function bearerExpiry(route: ActivatedRoute): string | null {
  return fragmentParams(route).get("expiresAt") ?? route.snapshot.queryParamMap.get("expiresAt");
}

/**
 * The opaque token the public site hands over with a prepared destination.
 *
 * Same rule as every other bearer: the fragment, not the query string, so the
 * destination's handoff never puts a credential in browser history entries that
 * servers see.
 */
export function intentBearer(route: ActivatedRoute): string {
  return fragmentBearer(route, "intent");
}
