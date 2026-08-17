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

publicRouter.get("/sitemap.xml", (_req, res) => {
  const links = db
    .prepare(`SELECT alias FROM links WHERE domain_id IS NULL AND state = 'active' AND deleted_at IS NULL LIMIT 1000`)
    .all() as Array<{ alias: string }>;
  const urls = links
    .map((l) => `  <url><loc>https://${config.publicHost}/${l.alias}</loc></url>`)
    .join("\n");
  res.type("application/xml").send(
    `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls}\n</urlset>`,
  );
});
