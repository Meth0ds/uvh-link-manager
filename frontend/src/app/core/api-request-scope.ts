/** Routes whose authorization context is carried by X-Workspace-Id. */
const WORKSPACE_SCOPED = /^\/api\/v1\/(?:links|domains|tokens|webhooks|tags|collections|link-templates)(?:\/|$)|^\/api\/v1\/analytics\/(?:overview|export)(?:\/|$)/;

export function apiPathname(url: string): string {
  try {
    return new URL(url, "https://uvh.invalid").pathname;
  } catch {
    return url.split(/[?#]/, 1)[0];
  }
}

export function isWorkspaceScopedPath(url: string): boolean {
  return WORKSPACE_SCOPED.test(apiPathname(url));
}
