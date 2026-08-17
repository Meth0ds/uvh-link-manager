import type { NextFunction, Request, Response } from "express";
import { randomBytes } from "node:crypto";
import type { AuthedRequest } from "./auth.js";

export const CSRF_COOKIE = "uvh_csrf";
const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

/**
 * Double-submit CSRF protection.
 * - Sets a random `uvh_csrf` cookie (not HttpOnly — the SPA reads it).
 * - Mutations must send it back in the `X-CSRF-Token` header.
 */
export function csrfProtection(req: AuthedRequest, res: Response, next: NextFunction): void {
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
  (req as Request & { csrfToken?: string }).csrfToken = token;
  if (SAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  const cookie = req.cookies?.[CSRF_COOKIE] as string | undefined;
  const supplied = (req.headers["x-csrf-token"] as string | undefined) ?? (req.body?._csrf as string | undefined);
  if (!cookie || !supplied || cookie !== supplied) {
    res.status(403).json({ error: "Token CSRF inválido" });
    return;
  }
  next();
}
