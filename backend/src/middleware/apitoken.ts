import type { NextFunction, Response } from "express";
import { db, q } from "../db.js";
import { sha256Hex } from "../util/ids.js";
import type { AuthedRequest } from "./auth.js";

export const API_SCOPES = ["links:read", "links:write", "analytics:read", "domains:read", "domains:write"] as const;
export type ApiScope = (typeof API_SCOPES)[number];

export interface ApiTokenAuth {
  workspaceId: number;
  /** api_tokens.id — used as the key of the per-token rate limiter. */
  tokenId: number;
  scopes: ApiScope[];
}

declare module "http" {
  interface IncomingMessage {
    apiAuth?: ApiTokenAuth;
  }
}

/**
 * Authenticate via `Authorization: Bearer <token>`. Looks up by hash so the
 * plaintext secret is never stored.
 */
export function requireApiToken(...required: ApiScope[]) {
  return (req: AuthedRequest, res: Response, next: NextFunction): void => {
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : null;
    if (!token) {
      res.status(401).json({ error: "Token de API requerido" });
      return;
    }
    const row = db
      .prepare(`SELECT id, workspace_id, scopes, revoked_at, expires_at, last_used_at FROM api_tokens WHERE token_hash = ?`)
      .get(sha256Hex(token)) as
      | {
          id: number;
          workspace_id: number;
          scopes: string;
          revoked_at: string | null;
          expires_at: string | null;
          last_used_at: string | null;
        }
      | undefined;
    if (!row || row.revoked_at || (row.expires_at && new Date(row.expires_at).getTime() < Date.now())) {
      res.status(401).json({ error: "Token inválido o revocado" });
      return;
    }
    const scopes = JSON.parse(row.scopes) as ApiScope[];
    for (const r of required) {
      if (!scopes.includes(r)) {
        res.status(403).json({ error: `Scope requerido: ${r}` });
        return;
      }
    }
    req.apiAuth = { workspaceId: row.workspace_id, tokenId: row.id, scopes };
    // Throttle the last_used_at write to at most once a minute per token —
    // the same technique used for sessions. Otherwise every authenticated API
    // request costs a SQLite write for almost no informational value.
    const lastUsed = row.last_used_at ? new Date(row.last_used_at).getTime() : 0;
    if (Date.now() - lastUsed > 60_000) {
      q.prepare(`UPDATE api_tokens SET last_used_at = ? WHERE id = ?`).run(new Date().toISOString(), row.id);
    }
    next();
  };
}
