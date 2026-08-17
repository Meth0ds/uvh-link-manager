import express from "express";
import cookieParser from "cookie-parser";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";
import { securityHeaders } from "./security.js";
import { hydrateSession, type AuthedRequest } from "./middleware/auth.js";
import { csrfProtection } from "./middleware/csrf.js";
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

/**
 * Serve the compiled Angular SPA (if present) so one Node process can host the
 * panel + API together. Known SPA routes fall back to index.html; everything
 * else continues to the link resolver.
 */
function serveSpa(app: express.Express): void {
  if (!fs.existsSync(path.join(SPA_DIST, "index.html"))) return;
  app.use(express.static(SPA_DIST, { index: false }));
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
  app.use(express.json({ limit: "256kb" }));
  app.use(cookieParser());
  app.use(hydrateSession);
  app.use(csrfProtection);

  // Public + metadata
  app.use("/", publicRouter);
  // Serve the built Angular SPA when it exists (single-process preview/deploy).
  serveSpa(app);

  // API v1
  app.use("/api/v1/auth", authRouter);
  app.use("/api/v1/links", linksRouter);
  app.use("/api/v1/analytics", analyticsRouter);
  app.use("/api/v1/workspaces", workspacesRouter);
  app.use("/api/v1/domains", domainsRouter);
  app.use("/api/v1/tokens", tokensRouter);
  app.use("/api/v1/webhooks", webhooksRouter);
  app.use("/api/v1/admin", adminRouter);
  app.use("/api/v1", abuseRouter);
  // Public redirect surface
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
