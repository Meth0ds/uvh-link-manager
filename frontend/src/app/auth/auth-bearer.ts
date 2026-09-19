import type { ActivatedRoute } from "@angular/router";

/**
 * A bearer handed over in the URL.
 *
 * The fragment is the right place for one: it never reaches the server, the
 * access log or a `Referer` header, and it is not sent anywhere if the page is
 * reloaded. Query parameters are kept readable only for links that were already
 * delivered before the change.
 */
function fragmentBearer(route: ActivatedRoute, key: string): string {
  const fragment = route.snapshot.fragment ?? "";
  const current = new URLSearchParams(fragment).get(key);
  if (current) return current;

  // Temporary compatibility for links emitted before bearer fragments were
  // introduced. New links never place credentials in the query string.
  return route.snapshot.queryParamMap.get(key) ?? "";
}

/** Read new fragment bearers while retaining compatibility with old query links. */
export function authBearer(route: ActivatedRoute): string {
  return fragmentBearer(route, "token");
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
