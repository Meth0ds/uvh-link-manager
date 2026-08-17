import type { NextFunction, Request, Response } from "express";
import rateLimit from "express-rate-limit";

/** Simple in-memory store (single process). Documented limitation for horizontal scale. */
function key(req: Request): string {
  return req.ip ?? "unknown";
}

export function makeLimiter(opts: { windowMs: number; limit: number; message?: string }) {
  return rateLimit({
    windowMs: opts.windowMs,
    limit: opts.limit,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: key,
    message: { error: opts.message ?? "Demasiadas peticiones. Inténtalo más tarde." },
  });
}

export const authLimiter = makeLimiter({ windowMs: 15 * 60_000, limit: Number(process.env.AUTH_LIMIT ?? 10), message: "Demasiados intentos. Espera unos minutos." });
export const registerLimiter = makeLimiter({ windowMs: 60 * 60_000, limit: Number(process.env.REGISTER_LIMIT ?? 10), message: "Demasiados registros desde esta IP." });
export const linkCreateLimiter = makeLimiter({ windowMs: 60_000, limit: 30, message: "Demasiados enlaces en poco tiempo." });
export const apiLimiter = makeLimiter({ windowMs: 60_000, limit: 120, message: "Rate limit de API excedido." });
export const reportLimiter = makeLimiter({ windowMs: 60_000, limit: 10, message: "Demasiadas denuncias." });
// Public link resolution: generous per-IP cap so a single NAT is not affected,
// but scripted floods of the redirect hot path are slowed down.
export const resolveLimiter = makeLimiter({ windowMs: 60_000, limit: Number(process.env.RESOLVE_LIMIT ?? 600), message: "Demasiadas resoluciones de enlaces." });
export const adminLimiter = makeLimiter({ windowMs: 60_000, limit: 60, message: "Rate limit administrativo." });

export function nextAfter(next: NextFunction): void {
  next();
}
