import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { config, isProd } from "./config.js";
import { securityHeaders } from "./security.js";
import { hydrateSession, type AuthedRequest } from "./middleware/auth.js";
import { csrfProtection } from "./middleware/csrf.js";
import { hostGuard } from "./middleware/host.js";
import { authRouter } from "./routes/auth.js";
import { linksRouter } from "./routes/links.js";
import { analyticsRouter } from "./routes/analytics.js";
import { workspacesRouter } from "./routes/workspaces.js";
import { domainsRouter } from "./routes/domains.js";
import { tokensRouter } from "./routes/tokens.js";
import { webhooksRouter } from "./routes/webhooks.js";
import { adminRouter } from "./routes/admin.js";
import { abuseRouter } from "./routes/abuse.js";
import { publicRouter } from "./routes/public.js";
import { redirectRouter } from "./routes/redirect.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
// Angular's application builder emits the browser bundle one level down.
const SPA_DIST = path.resolve(__dirname, "..", "..", "frontend", "dist", "uvh", "browser");
const SPA_ROUTES = ["/", "/auth", "/app", "/legal"];

/** Serve the compiled SPA assets. Both the public and app hosts load this bundle. */
function serveStatic(app: express.Express): void {
  if (!fs.existsSync(path.join(SPA_DIST, "index.html"))) return;
  app.use(express.static(SPA_DIST, { index: false }));
}

/** Serve index.html for client-side routes. Host access is already enforced by hostGuard. */
function serveSpaFallback(app: express.Express): void {
  if (!fs.existsSync(path.join(SPA_DIST, "index.html"))) return;
  app.use((req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") return next();
    if (SPA_ROUTES.some((p) => req.path === p || req.path.startsWith(`${p}/`))) {
      res.sendFile(path.join(SPA_DIST, "index.html"));
      return;
    }
    next();
  });
}

export function createApp() {
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);

  app.use(securityHeaders);
  serveStatic(app);
  // Host separation: panel/API only on app host, public + redirect only on public
  // host/custom domains. No-op outside production (single-host dev/preview).
  app.use(hostGuard);
  app.use(express.json({ limit: "256kb" }));
  // Needed by the public password-unlock form (HTML forms post urlencoded).
  app.use(express.urlencoded({ extended: false, limit: "16kb" }));
  app.use(cookieParser());
  app.use(hydrateSession);

  // CSRF for API + public mutating forms (never on the redirect hot path).
  app.use("/api/v1", csrfProtection);

  // Public endpoints (reachable from both hosts).
  app.get("/api/v1/csrf", (req, res) => {
    res.json({ csrfToken: (req as AuthedRequest & { csrfToken?: string }).csrfToken });
  });
  app.get("/api/v1/config", (req, res) => {
    const appUrl = isProd ? config.appUrl : `${req.protocol}://${req.get("host")}`;
    res.json({ appUrl, publicHost: config.publicHost, appHost: config.appHost });
  });
  app.use("/api/v1", abuseRouter);

  // Authenticated panel API (app host only in production).
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/links", linksRouter);
  app.use("/api/v1/analytics", analyticsRouter);
  app.use("/api/v1/workspaces", workspacesRouter);
  app.use("/api/v1/domains", domainsRouter);
  app.use("/api/v1/tokens", tokensRouter);
  app.use("/api/v1/webhooks", webhooksRouter);
  app.use("/api/v1/admin", adminRouter);

  // Public site: landing, legal, health, robots, sitemap.
  app.use("/", publicRouter);

  // SPA fallback for client routes (host-guarded in production).
  serveSpaFallback(app);

  // Public redirect surface: /r/{alias} and /{alias}.
  app.use("/r", redirectRouter);
  app.use("/", redirectRouter);

  // API 404
  app.use("/api", (_req, res) => {
    res.status(404).json({ error: "Ruta no encontrada" });
  });

  // Error handler
  app.use((err: Error, _req: AuthedRequest, res: express.Response, _next: express.NextFunction) => {
    console.error("[error]", err);
    res.status(500).json({ error: "Error interno del servidor" });
  });

  return app;
}
