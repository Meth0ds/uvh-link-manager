import type { Response } from "express";
import { db, q } from "./db.js";
import type { AuthedRequest } from "./middleware/auth.js";

export type Role = "owner" | "admin" | "editor" | "viewer";

const ROLE_RANK: Record<Role, number> = { viewer: 0, editor: 1, admin: 2, owner: 3 };

export const ROLE_ORDER: Role[] = ["viewer", "editor", "admin", "owner"];

export function roleAtLeast(role: Role, min: Role): boolean {
  return ROLE_RANK[role] >= ROLE_RANK[min];
}

export interface Membership {
  workspaceId: number;
  role: Role;
}

export function getMembership(userId: number, workspaceId: number): Membership | null {
  const row = db
    .prepare(`SELECT workspace_id, role FROM memberships WHERE user_id = ? AND workspace_id = ?`)
    .get(userId, workspaceId) as { workspace_id: number; role: Role } | undefined;
  return row ? { workspaceId: row.workspace_id, role: row.role } : null;
}

export function getDefaultWorkspace(userId: number): number | null {
  const row = db
    .prepare(
      `SELECT workspace_id FROM memberships WHERE user_id = ? ORDER BY
         CASE role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END,
         workspace_id LIMIT 1`,
    )
    .get(userId) as { workspace_id: number } | undefined;
  return row?.workspace_id ?? null;
}

/** Resolve the workspace from the `X-Workspace-Id` header or the user's default. */
export function resolveWorkspace(req: AuthedRequest): { workspaceId: number; role: Role } | null {
  if (!req.user) return null;
  const header = req.headers["x-workspace-id"];
  const wid = header ? Number(header) : getDefaultWorkspace(req.user.id);
  if (!wid) return null;
  const m = getMembership(req.user.id, wid);
  return m ? { workspaceId: m.workspaceId, role: m.role } : null;
}

/** Middleware: require membership in a workspace and at least `min` role. */
export function requireWorkspace(min: Role = "viewer") {
  return (req: AuthedRequest, res: Response, next: () => void): void => {
    const ws = resolveWorkspace(req);
    if (!ws) {
      res.status(403).json({ error: "Sin acceso a este workspace" });
      return;
    }
    if (!roleAtLeast(ws.role, min)) {
      res.status(403).json({ error: "Permisos insuficientes" });
      return;
    }
    res.locals.workspaceId = ws.workspaceId;
    res.locals.role = ws.role;
    next();
  };
}

/** Ensure a link belongs to the resolved workspace. */
export function assertLinkInWorkspace(linkId: number, workspaceId: number): boolean {
  const row = q.prepare(`SELECT id FROM links WHERE id = ? AND workspace_id = ? AND deleted_at IS NULL`).get(linkId, workspaceId);
  return !!row;
}
