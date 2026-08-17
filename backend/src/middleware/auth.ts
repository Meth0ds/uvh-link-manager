import type { NextFunction, Request, Response } from "express";
import { db, q } from "../db.js";
import { config } from "../config.js";
import { randomToken, sha256Hex } from "../util/ids.js";

export interface AuthUser {
  id: number;
  email: string;
  name: string;
  isAdmin: boolean;
  emailVerified: boolean;
  mfaEnabled: boolean;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
  sessionId?: string;
  ipHash?: string;
}

export function currentUser(req: AuthedRequest): AuthUser | null {
  return req.user ?? null;
}

export function createSession(userId: number, req: Request): string {
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + config.sessionTtlDays * 86400_000).toISOString();
  // Store only a hash of the session token; the raw token lives in the cookie.
  q.prepare(
    `INSERT INTO sessions (id, user_id, user_agent, ip_hash, expires_at)
     VALUES (?, ?, ?, ?, ?)`,
  ).run(sha256Hex(token), userId, req.headers["user-agent"] ?? null, req.ip ? sha256Hex(req.ip) : null, expiresAt);
  return token;
}

export function setSessionCookie(res: Response, token: string): void {
  res.cookie(config.sessionCookieName, token, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
    domain: config.cookieDomain, // scoped to app host; never ".uvh.es"
    maxAge: config.sessionTtlDays * 86400_000,
  });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(config.sessionCookieName, {
    httpOnly: true,
    secure: config.cookieSecure,
    sameSite: "lax",
    path: "/",
    domain: config.cookieDomain,
  });
}

/** Populate req.user from the session cookie. Does not reject. */
export function hydrateSession(req: AuthedRequest, _res: Response, next: NextFunction): void {
  const token = req.cookies?.[config.sessionCookieName] as string | undefined;
  if (token) {
    const row = db
      .prepare(
        `SELECT s.id AS session_id, s.expires_at, s.revoked_at, u.id, u.email, u.name,
                u.is_admin, u.email_verified_at, u.mfa_enabled
         FROM sessions s JOIN users u ON u.id = s.user_id
         WHERE s.id = ?`,
      )
      .get(sha256Hex(token)) as
      | {
          session_id: string;
          expires_at: string;
          revoked_at: string | null;
          id: number;
          email: string;
          name: string;
          is_admin: number;
          email_verified_at: string | null;
          mfa_enabled: number;
        }
      | undefined;
    if (row && !row.revoked_at && new Date(row.expires_at).getTime() > Date.now()) {
      req.user = {
        id: row.id,
        email: row.email,
        name: row.name,
        isAdmin: row.is_admin === 1,
        emailVerified: !!row.email_verified_at,
        mfaEnabled: row.mfa_enabled === 1,
      };
      req.sessionId = row.session_id;
      q.prepare(`UPDATE sessions SET last_used_at = ? WHERE id = ?`).run(
        new Date().toISOString(),
        row.session_id,
      );
    }
  }
  next();
}

/** Require an authenticated user. */
export function requireAuth(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  next();
}

/** Require an authenticated user that has confirmed their email. */
export function requireVerified(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  if (!req.user.emailVerified) {
    res.status(403).json({ error: "Verifica tu email para continuar" });
    return;
  }
  next();
}

export function requireAdmin(req: AuthedRequest, res: Response, next: NextFunction): void {
  if (!req.user) {
    res.status(401).json({ error: "No autenticado" });
    return;
  }
  if (!req.user.isAdmin) {
    res.status(403).json({ error: "Acceso restringido" });
    return;
  }
  next();
}
