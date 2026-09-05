import type { ActivatedRoute } from "@angular/router";

/** Read new fragment bearers while retaining compatibility with old query links. */
export function authBearer(route: ActivatedRoute): string {
  const fragment = route.snapshot.fragment ?? "";
  const current = new URLSearchParams(fragment).get("token");
  if (current) return current;

  // Temporary compatibility for links emitted before bearer fragments were
  // introduced. New links never place credentials in the query string.
  return route.snapshot.queryParamMap.get("token") ?? "";
}
