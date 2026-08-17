import { Router } from "express";
import { db, q } from "../db.js";
import { config } from "../config.js";

export const publicRouter = Router();

publicRouter.get("/health", (_req, res) => {
  q.prepare(`SELECT 1`).get();
  res.json({ ok: true, service: "uvh-api", time: new Date().toISOString() });
});

publicRouter.get("/robots.txt", (_req, res) => {
  res.type("text/plain").send(
    `User-agent: *\nAllow: /\nDisallow: /api/\nDisallow: /app/\n\nSitemap: https://${config.publicHost}/sitemap.xml\n`,
  );
});

// Only public, stable pages. Short links are user content and are deliberately
// excluded: exposing them would let bots crawl (and consume) single-use or
// click-limited links and would pollute analytics.
publicRouter.get("/sitemap.xml", (_req, res) => {
  const pages = ["/", "/legal/terminos", "/legal/privacidad", "/legal/denuncias"];
  const urls = pages
    .map((p) => `  <url><loc>https://${config.publicHost}${p}</loc></url>`)
    .join("\n");
  res.type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`,
  );
});
