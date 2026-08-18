import type { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";
import { intEnv } from "../config.js";

/** Simple in-memory store (single process). Documented limitation for horizontal scale. */
function key(req: Request): string {
  return req.ip ?? "unknown";
}

export function makeLimiter(opts: {
  windowMs: number;
  limit: number;
  message?: string;
  keyGenerator?: (req: Request) => string;
}) {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: opts.keyGenerator ?? key,
    message: { error: opts.message ?? "Demasiadas peticiones. Inténtalo más tarde." },
  });
}

// Limits are validated strictly at boot (intEnv throws on invalid values).
export const authLimiter = makeLimiter({ windowMs: 15 * 60_000, limit: intEnv("AUTH_LIMIT", 10, { min: 1 }), message: "Demasiados intentos. Espera unos minutos." });
export const registerLimiter = makeLimiter({ windowMs: 60 * 60_000, limit: intEnv("REGISTER_LIMIT", 10, { min: 1 }), message: "Demasiados registros desde esta IP." });
export const linkCreateLimiter = makeLimiter({ windowMs: 60_000, limit: intEnv("LINK_CREATE_LIMIT", 30, { min: 1 }), message: "Demasiados enlaces en poco tiempo." });
export const apiLimiter = makeLimiter({ windowMs: 60_000, limit: 120, message: "Rate limit de API excedido." });
export const reportLimiter = makeLimiter({ windowMs: 60_000, limit: 10, message: "Demasiadas denuncias." });
// Public link resolution: generous per-IP cap so a single NAT is not affected,
// but scripted floods of the redirect hot path are slowed down.
export const resolveLimiter = makeLimiter({ windowMs: 60_000, limit: intEnv("RESOLVE_LIMIT", 600, { min: 1 }), message: "Demasiadas resoluciones de enlaces." });
export const adminLimiter = makeLimiter({ windowMs: 60_000, limit: 60, message: "Rate limit administrativo." });

/**
 * Second layer for API-token endpoints, keyed by the authenticated token (not
 * the IP). The IP layer (apiLimiter) runs before authentication; this one runs
 * after requireApiToken and caps the *aggregate* usage of one token, so a
 * leaked token cannot fan out across many IPs. In-memory store: documented
 * limitation for multi-instance deployments (use a shared store like Redis).
 */
export const apiTokenLimiter = rateLimit({
  windowMs: 60_000,
  limit: intEnv("API_TOKEN_LIMIT", 600, { min: 1 }),
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req: Request) =>
    req.apiAuth ? `token:${req.apiAuth.tokenId}` : `ip:${req.ip ?? "unknown"}`,
  message: { error: "Rate limit de API excedido para este token." },
});

export function nextAfter(next: NextFunction): void {
  next();
}
