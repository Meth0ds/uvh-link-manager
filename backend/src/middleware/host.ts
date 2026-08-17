import type { NextFunction, Request, Response } from "express";
import { config, isProd } from "../config.js";

/**
 * Host separation (production only):
 * - `uvh.es` (PUBLIC_HOST) → landing, legal, sitemap/robots, report form and
 *   link resolution (`/{alias}`, `/r/*`), plus custom domains for resolution.
 * - `app.uvh.es` (APP_HOST) → Angular panel (`/auth`, `/app`) and `/api/v1`.
 *
 * In dev/test the whole app runs on a single host behind a proxy, so the guard
 * is a no-op and nothing is blocked.
 */

export function normalizeHost(host: string): string {
  return host.toLowerCase().replace(/:\d+$/, "");
}

export function isPublicHost(host: string): boolean {
  const h = normalizeHost(host);
  const p = config.publicHost.toLowerCase();
  return h === p || h === `www.${p}`;
}

export function isAppHost(host: string): boolean {
  const h = normalizeHost(host);
  const a = config.appHost.toLowerCase();
  return h === a || h === `www.${a}`;
}

// Public endpoints that live under /api/v1 but are part of the public site,
// not the authenticated panel.
const PUBLIC_API_PATHS = new Set([
  "/api/v1/report",
  "/api/v1/status",
  "/api/v1/create",
  "/api/v1/csrf",
  "/api/v1/config",
]);

function isAppPath(path: string): boolean {
  return (
    path === "/api/v1" ||
    path.startsWith("/api/v1/") ||
    path === "/auth" ||
    path.startsWith("/auth/") ||
    path === "/app" ||
    path.startsWith("/app/")
  );
}

function isPublicPath(path: string): boolean {
  return (
    path === "/" ||
    path === "/legal" ||
    path.startsWith("/legal/") ||
    path === "/robots.txt" ||
    path === "/sitemap.xml"
  );
}

export function hostGuard(req: Request, res: Response, next: NextFunction): void {
  if (!isProd) {
    next();
    return;
  }

  const host = normalizeHost(req.hostname);
  const path = req.path;

  // Infra health check: reachable on any host.
  if (path === "/health") {
    next();
    return;
  }

  if (PUBLIC_API_PATHS.has(path)) {
    if (isPublicHost(host) || isAppHost(host)) {
      next();
      return;
    }
    res.status(404).end();
    return;
  }

  if (isAppPath(path)) {
    if (isAppHost(host)) {
      next();
      return;
    }
    res.status(404).end();
    return;
  }

  if (isPublicPath(path)) {
    if (isPublicHost(host)) {
      next();
      return;
    }
    res.status(404).end();
    return;
  }

  // Redirect surface (`/{alias}`, `/r/*`): public host + custom domains, never
  // the app host. Unknown hosts are rejected later by the link resolver.
  if (isAppHost(host)) {
    res.status(404).end();
    return;
  }
  next();
}
