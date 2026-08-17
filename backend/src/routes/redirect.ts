import { Router, type Request } from "express";
import bcrypt from "bcryptjs";
import { z } from "zod";
import { db, q } from "../db.js";
import { resolveLink, resolveDomainId, normalizeHost, UNLOCK_COOKIE } from "../services/redirect.js";
import { recordClick } from "../services/analytics.js";
import { enqueue } from "../queue.js";
import { countryFromHeaders, parseUserAgent, referrerDomain, visitorHash } from "../util/analytics.js";
import { sign } from "../util/sign.js";
import { normalizeAlias } from "../util/url.js";
import { reportLimiter } from "../middleware/ratelimit.js";
import { issueCsrfToken, verifyCsrf } from "../middleware/csrf.js";

export const redirectRouter = Router();

function wantsHtml(req: { accepts: (t: string) => unknown }): boolean {
  return Boolean(req.accepts("html"));
}

function toResolveRequest(req: import("express").Request, alias: string): ResolveRequest {
  return {
    host: req.hostname,
    alias,
    userAgent: req.headers["user-agent"],
    acceptLanguage: req.headers["accept-language"],
    referrer: req.headers.referer,
    ip: req.ip,
    country: countryFromHeaders(req.headers as Record<string, string | undefined>),
    unlockToken: (req.cookies?.[UNLOCK_COOKIE] as string | undefined) ?? null,
    accepts: (t) => req.accepts(t) as unknown,
  };
}

function page(title: string, body: string, status: number): { html: string; status: number } {
  return {
    status,
    html: `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
    <title>${title} · UVH</title><style>
      body{font-family:Manrope,Segoe UI,Arial,sans-serif;background:#F6F8FC;color:#07111F;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
      .card{background:#fff;border:1px solid #E3E8F0;border-radius:16px;padding:40px;max-width:420px;text-align:center}
      h1{font-size:22px;margin:0 0 8px} p{color:#33415C;line-height:1.6;margin:0}
      .brand{font-weight:800;color:#2457F5;margin-bottom:16px} .brand b{color:#00A99D}
      a.btn{display:inline-block;margin-top:20px;background:#2457F5;color:#fff;text-decoration:none;padding:12px 22px;border-radius:8px;font-weight:600}
    </style></head><body><div class="card"><div class="brand">UVH <b>· Enlaces cortos. Control total.</b></div>
    <h1>${title}</h1><p>${body}</p></div></body></html>`,
  };
}

function passwordPage(alias: string, csrf?: string): string {
  return `<!doctype html><html lang="es"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Enlace protegido · UVH</title><style>
    body{font-family:Manrope,Segoe UI,Arial,sans-serif;background:#F6F8FC;color:#07111F;display:flex;align-items:center;justify-content:center;min-height:100vh;margin:0}
    .card{background:#fff;border:1px solid #E3E8F0;border-radius:16px;padding:40px;max-width:400px;width:100%}
    h1{font-size:20px;margin:0 0 4px} p{color:#33415C;margin:0 0 16px}
    input{width:100%;box-sizing:border-box;padding:12px;border:1px solid #CBD3E0;border-radius:8px;font-size:15px}
    button{width:100%;margin-top:12px;background:#2457F5;color:#fff;border:0;padding:12px;border-radius:8px;font-size:15px;font-weight:600;cursor:pointer}
    .err{color:#C62828;font-size:13px;margin-top:10px}
  </style></head><body><div class="card"><h1>Enlace protegido</h1><p>Este enlace está protegido con contraseña. Introdúcela para continuar.</p>
  <form method="post" action="/r/${encodeURIComponent(alias)}/unlock">
    <input type="password" name="password" placeholder="Contraseña" autofocus required>
    <input type="hidden" name="_csrf" value="${csrf ?? ""}">
    <button type="submit">Continuar</button>
  </form></div></body></html>`;
}

interface ResolveRequest {
  host: string;
  alias: string;
  userAgent?: string;
  acceptLanguage?: string;
  referrer?: string;
  ip?: string;
  country?: string | null;
  unlockToken?: string | null;
  accepts: (t: string) => unknown;
}

function resolveAndRespond(req: ResolveRequest, expressReq: import("express").Request, res: import("express").Response): void {
  const outcome = resolveLink(req);
  if (outcome.kind === "redirect") {
    enqueue(() => {
      recordClick(outcome.linkId, {
        country: req.country ?? null,
        device: parseUserAgent(req.userAgent).device,
        browser: parseUserAgent(req.userAgent).browser,
        os: parseUserAgent(req.userAgent).os,
        referrerDomain: referrerDomain(req.referrer),
        campaign: outcome.campaign,
        visitorHash: visitorHash(req.ip, req.userAgent),
      });
    });
    // 302: allows link editing without breaking cached redirects
    res.status(302).setHeader("Location", outcome.location);
    res.end();
    return;
  }
  if (outcome.kind === "password_required") {
    if (wantsHtml(req)) {
      // Issue CSRF only here (not on the redirect hot path) so the unlock form can submit.
      res.status(403).send(passwordPage(req.alias, issueCsrfToken(expressReq, res)));
    } else {
      res.status(403).json({ error: "Enlace protegido con contraseña", passwordRequired: true });
    }
    return;
  }
  if (outcome.kind === "gone") {
    const p = page("Enlace agotado", "Este enlace ya no está disponible (límite de clics o uso único alcanzado).", 410);
    res.status(p.status).send(p.html);
    return;
  }
  if (outcome.kind === "unavailable") {
    const labels: Record<string, [string, string]> = {
      paused: ["Enlace en pausa", "Este enlace está temporalmente desactivado."],
      expired: ["Enlace caducado", "Este enlace ha expirado."],
      blocked: ["Enlace bloqueado", "Este enlace fue bloqueado por incumplir nuestras normas."],
      archived: ["Enlace archivado", "Este enlace ya no está activo."],
      scheduled: ["Enlace programado", "Este enlace se activará pronto."],
      domain: ["Dominio no configurado", "El dominio de este enlace no está activo."],
    };
    const [t, b] = labels[outcome.reason] ?? ["No disponible", "Este enlace no está disponible."];
    const p = page(t, b, 404);
    res.status(p.status).send(p.html);
    return;
  }
  const p = page("Enlace no encontrado", "El enlace que buscas no existe o fue eliminado.", 404);
  res.status(p.status).send(p.html);
}

// Canonical public surface: /{alias} (uvh.es) and /r/{alias} (API-friendly)
redirectRouter.get("/r/:alias", (req, res) => {
  resolveAndRespond(toResolveRequest(req, req.params.alias ?? ""), req, res);
});

redirectRouter.get("/:alias", (req, res) => {
  // Top-level paths resolve only when the Host is a UVH public domain.
  resolveAndRespond(toResolveRequest(req, req.params.alias ?? ""), req, res);
});

// Unlock a password-protected link and follow with a redirect.
redirectRouter.post("/r/:alias/unlock", reportLimiter, async (req, res) => {
  if (!verifyCsrf(req)) {
    res.status(403).json({ error: "Token CSRF inválido" });
    return;
  }
  const parsed = z.object({ password: z.string().min(1).max(256) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Contraseña requerida" });
    return;
  }
  // Resolve the link by host + alias (not alias alone) so the unlock always
  // targets the link that actually lives on the requesting host.
  const alias = normalizeAlias(req.params.alias ?? "");
  const host = normalizeHost(req.hostname);
  const domainId = resolveDomainId(host);
  if (domainId === -1) {
    res.status(404).json({ error: "Enlace no encontrado" });
    return;
  }
  const link = q
    .prepare(`SELECT id, password_hash FROM links WHERE domain_id IS ? AND alias = ? AND deleted_at IS NULL`)
    .get(domainId, alias) as { id: number; password_hash: string | null } | undefined;
  if (!link?.password_hash) {
    res.status(404).json({ error: "Enlace no encontrado" });
    return;
  }
  const ok = await bcrypt.compare(parsed.data.password, link.password_hash);
  if (!ok) {
    if (req.accepts("html")) {
      res.status(403).send(passwordPage(alias, issueCsrfToken(req, res)).replace("</form>", `<div class="err">Contraseña incorrecta</div></form>`));
    } else {
      res.status(403).json({ error: "Contraseña incorrecta" });
    }
    return;
  }
  const token = sign(JSON.stringify({ alias, host }), 10 * 60_000);
  res.cookie(UNLOCK_COOKIE, token, {
    httpOnly: true,
    secure: req.secure,
    sameSite: "lax",
    path: "/",
    maxAge: 10 * 60_000,
  });
  if (req.accepts("html")) {
    res.redirect(302, `/r/${encodeURIComponent(alias)}`);
  } else {
    res.json({ ok: true });
  }
});
