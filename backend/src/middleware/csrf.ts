import type { NextFunction, Request, Response } from "express";
import { randomBytes } from "node:crypto";

export const CSRF_COOKIE = "uvh_csrf";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

interface CsrfRequest extends Request {
  csrfToken?: string;
}

/** Read or create the double-submit token, setting the cookie only when needed. */
export function issueCsrfToken(req: Request, res: Response): string {
  let token = req.cookies?.[CSRF_COOKIE] as string | undefined;
  if (!token) {
    token = randomBytes(24).toString("base64url");
    res.cookie(CSRF_COOKIE, token, {
      httpOnly: false,
      secure: req.secure,
      sameSite: "lax",
      path: "/",
    });
  }
  (req as CsrfRequest).csrfToken = token;
  return token;
}

/** Verify the token on unsafe methods; safe methods always pass. */
export function verifyCsrf(req: Request): boolean {
  if (SAFE_METHODS.has(req.method)) return true;
  const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const supplied = (req.headers["x-csrf-token"] as string | undefined) ?? (req.body?._csrf as string | undefined);
  return Boolean(cookie && supplied && cookie === supplied);
}

/**
 * CSRF middleware for the API surface (`/api/v1`) and public forms that mutate
 * state. It is intentionally NOT global: the redirect hot path must not issue
 * cookies for anonymous visitors.
 */
export function csrfProtection(req: Request, res: Response, next: NextFunction): void {
  issueCsrfToken(req, res);
  if (!verifyCsrf(req)) {
    res.status(403).json({ error: "Token CSRF inválido" });
    return;
  }
  next();
}
