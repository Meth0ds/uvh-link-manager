import { Router } from "express";
import { z } from "zod";
import { db, q, tx } from "../db.js";
import { config } from "../config.js";
import { requireAuth, requireVerified, type AuthedRequest } from "../middleware/auth.js";
import { getMembership, roleAtLeast, ROLE_ORDER, type Role } from "../workspace.js";
import { audit } from "../util/audit.js";
import { randomToken, sha256Hex } from "../util/ids.js";
import { invitationEmail, sendMail } from "../util/email.js";

export const workspacesRouter = Router();
workspacesRouter.use(requireAuth);

const ROLE_SET = new Set(ROLE_ORDER);

function workspaceDto(w: Record<string, unknown>, role?: string) {
  return { id: w.id, name: w.name, slug: w.slug, role: role ?? null, createdAt: w.created_at };
}

function membersOf(workspaceId: number) {
  return db
    .prepare(
      `SELECT u.id, u.email, u.name, m.role, m.created_at AS joined_at
       FROM memberships m JOIN users u ON u.id = m.user_id
       WHERE m.workspace_id = ? ORDER BY CASE m.role WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'editor' THEN 2 ELSE 3 END, u.name`,
    )
    .all(workspaceId);
}

function invitationsOf(workspaceId: number) {
  return db
    .prepare(`SELECT id, email, role, status, expires_at, created_at FROM invitations WHERE workspace_id = ? ORDER BY created_at DESC`)
    .all(workspaceId);
}

// List my workspaces
workspacesRouter.get("/", (req: AuthedRequest, res) => {
  const rows = db
    .prepare(
      `SELECT w.*, m.role FROM workspaces w JOIN memberships m ON m.workspace_id = w.id
       WHERE m.user_id = ? ORDER BY w.created_at`,
    )
    .all(req.user!.id) as Array<Record<string, unknown>>;
  res.json({ workspaces: rows.map((r) => workspaceDto(r, r.role as string)) });
});

// Create workspace — verified users only: unverified accounts must not be
// able to farm workspaces (and invitations) freely.
workspacesRouter.post("/", requireVerified, (req: AuthedRequest, res) => {
  const parsed = z
    .object({ name: z.string().trim().min(2).max(80).regex(/^[^\u0000-\u001f\u007f]+$/, "El nombre contiene caracteres no permitidos") })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Nombre inválido" });
    return;
  }
  const wid = tx(() => {
    const info = db
      .prepare(`INSERT INTO workspaces (name, slug, owner_user_id) VALUES (?, ?, ?)`)
      .run(parsed.data.name, `ws-${randomToken(6).toLowerCase()}`, req.user!.id);
    const id = Number(info.lastInsertRowid);
    q.prepare(`INSERT INTO memberships (workspace_id, user_id, role) VALUES (?, ?, 'owner')`).run(id, req.user!.id);
    q.prepare(`INSERT INTO quotas (workspace_id, links_limit) VALUES (?, 1000)`).run(id);
    return id;
  });
  audit({ userId: req.user!.id, ip: req.ip }, "workspace.create", "workspace", wid);
  res.status(201).json({ workspace: workspaceDto(q.prepare(`SELECT * FROM workspaces WHERE id = ?`).get(wid) as Record<string, unknown>) });
});

// Detail + members + invitations
workspacesRouter.get("/:id", (req: AuthedRequest, res) => {
  const wid = Number(req.params.id);
  const m = getMembership(req.user!.id, wid);
  if (!m) {
    res.status(403).json({ error: "Sin acceso a este workspace" });
    return;
  }
  const w = q.prepare(`SELECT * FROM workspaces WHERE id = ?`).get(wid) as Record<string, unknown>;
  res.json({
    workspace: workspaceDto(w, m.role),
    members: membersOf(wid),
    invitations: roleAtLeast(m.role, "admin") ? invitationsOf(wid) : [],
  });
});

// Rename
workspacesRouter.patch("/:id", (req: AuthedRequest, res) => {
  const wid = Number(req.params.id);
  const m = getMembership(req.user!.id, wid);
  if (!m || !roleAtLeast(m.role, "admin")) {
    res.status(403).json({ error: "Permisos insuficientes" });
    return;
  }
  const parsed = z
    .object({ name: z.string().trim().min(2).max(80).regex(/^[^\u0000-\u001f\u007f]+$/, "El nombre contiene caracteres no permitidos") })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Nombre inválido" });
    return;
  }
  q.prepare(`UPDATE workspaces SET name = ?, updated_at = ? WHERE id = ?`).run(parsed.data.name, new Date().toISOString(), wid);
  audit({ userId: req.user!.id, ip: req.ip }, "workspace.rename", "workspace", wid);
  res.json({ ok: true });
});

// Members: change role
workspacesRouter.patch("/:id/members/:userId", (req: AuthedRequest, res) => {
  const wid = Number(req.params.id);
  const m = getMembership(req.user!.id, wid);
  if (!m || !roleAtLeast(m.role, "admin")) {
    res.status(403).json({ error: "Permisos insuficientes" });
    return;
  }
  const parsed = z.object({ role: z.string() }).safeParse(req.body);
  const role = parsed.success ? (parsed.data.role as Role) : null;
  if (!role || !ROLE_SET.has(role)) {
    res.status(422).json({ error: "Rol inválido" });
    return;
  }
  const target = Number(req.params.userId);
  const targetM = getMembership(target, wid);
  if (!targetM) {
    res.status(404).json({ error: "Miembro no encontrado" });
    return;
  }
  if (targetM.role === "owner") {
    res.status(403).json({ error: "No se puede cambiar el rol del propietario" });
    return;
  }
  // Only the owner may assign the owner role or manage other admins; without
  // this, any workspace admin could promote themselves to owner (privilege
  // escalation) or demote their fellow admins.
  if (m.role !== "owner" && (role === "owner" || targetM.role === "admin")) {
    res.status(403).json({ error: "Solo el propietario puede asignar el rol de propietario o gestionar administradores" });
    return;
  }
  q.prepare(`UPDATE memberships SET role = ? WHERE workspace_id = ? AND user_id = ?`).run(role, wid, target);
  audit({ userId: req.user!.id, ip: req.ip }, "workspace.role_change", "workspace", wid, { userId: target, role });
  res.json({ ok: true });
});

// Remove member
workspacesRouter.delete("/:id/members/:userId", (req: AuthedRequest, res) => {
  const wid = Number(req.params.id);
  const m = getMembership(req.user!.id, wid);
  if (!m || !roleAtLeast(m.role, "admin")) {
    res.status(403).json({ error: "Permisos insuficientes" });
    return;
  }
  const target = Number(req.params.userId);
  const targetM = getMembership(target, wid);
  if (!targetM) {
    res.status(404).json({ error: "Miembro no encontrado" });
    return;
  }
  if (targetM.role === "owner") {
    res.status(403).json({ error: "No se puede eliminar al propietario" });
    return;
  }
  if (m.role !== "owner" && targetM.role === "admin") {
    res.status(403).json({ error: "Solo el propietario puede eliminar administradores" });
    return;
  }
  q.prepare(`DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?`).run(wid, target);
  audit({ userId: req.user!.id, ip: req.ip }, "workspace.member_remove", "workspace", wid, { userId: target });
  res.json({ ok: true });
});

// Leave workspace
workspacesRouter.post("/:id/leave", (req: AuthedRequest, res) => {
  const wid = Number(req.params.id);
  const m = getMembership(req.user!.id, wid);
  if (!m) {
    res.status(404).json({ error: "No eres miembro" });
    return;
  }
  if (m.role === "owner") {
    res.status(403).json({ error: "El propietario no puede abandonar el workspace" });
    return;
  }
  q.prepare(`DELETE FROM memberships WHERE workspace_id = ? AND user_id = ?`).run(wid, req.user!.id);
  audit({ userId: req.user!.id, ip: req.ip }, "workspace.leave", "workspace", wid);
  res.json({ ok: true });
});

// Delete workspace (owner only)
workspacesRouter.delete("/:id", (req: AuthedRequest, res) => {
  const wid = Number(req.params.id);
  const m = getMembership(req.user!.id, wid);
  if (!m || m.role !== "owner") {
    res.status(403).json({ error: "Solo el propietario puede eliminar el workspace" });
    return;
  }
  tx(() => {
    q.prepare(`DELETE FROM invitations WHERE workspace_id = ?`).run(wid);
    q.prepare(`DELETE FROM memberships WHERE workspace_id = ?`).run(wid);
    q.prepare(`DELETE FROM workspaces WHERE id = ?`).run(wid);
  });
  audit({ userId: req.user!.id, ip: req.ip }, "workspace.delete", "workspace", wid);
  res.json({ ok: true });
});

// ---------------- Invitations ----------------
// Invitations send real emails from the UVH domain; require a verified account
// so unverified registrations cannot be used as a spam/phishing relay.
workspacesRouter.post("/:id/invitations", requireVerified, (req: AuthedRequest, res) => {
  const wid = Number(req.params.id);
  const m = getMembership(req.user!.id, wid);
  if (!m || !roleAtLeast(m.role, "admin")) {
    res.status(403).json({ error: "Permisos insuficientes" });
    return;
  }
  const parsed = z.object({ email: z.string().email().max(254), role: z.enum(["admin", "editor", "viewer"]) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Datos inválidos" });
    return;
  }
  const email = parsed.data.email.toLowerCase();
  // Only the owner may invite someone with the admin role; otherwise any
  // workspace admin could mint new admins without owner consent.
  if (parsed.data.role === "admin" && m.role !== "owner") {
    res.status(403).json({ error: "Solo el propietario puede invitar administradores" });
    return;
  }
  const existing = q.prepare(`SELECT id FROM memberships WHERE workspace_id = ? AND user_id IN (SELECT id FROM users WHERE email = ?)`).get(wid, email);
  if (existing) {
    res.status(409).json({ error: "Este usuario ya es miembro" });
    return;
  }
  const pending = q.prepare(`SELECT id FROM invitations WHERE workspace_id = ? AND email = ? AND status = 'pending'`).get(wid, email);
  if (pending) {
    res.status(409).json({ error: "Ya existe una invitación pendiente" });
    return;
  }
  const token = randomToken(32);
  const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
  // Only the hash is stored; the plaintext token is the bearer credential sent
  // by email. Resending rotates the token (see below).
  q.prepare(
    `INSERT INTO invitations (workspace_id, email, role, token, invited_by, expires_at) VALUES (?, ?, ?, ?, ?, ?)`,
  ).run(wid, email, parsed.data.role, sha256Hex(token), req.user!.id, expiresAt);
  const ws = q.prepare(`SELECT name FROM workspaces WHERE id = ?`).get(wid) as { name: string };
  void sendMail(invitationEmail(email, `${config.appUrl}/invitations/accept?token=${encodeURIComponent(token)}`, ws.name, parsed.data.role));
  audit({ userId: req.user!.id, ip: req.ip }, "workspace.invite", "workspace", wid, { email, role: parsed.data.role });
  res.status(201).json({ ok: true });
});

// Accept an invitation (authenticated)
workspacesRouter.post("/invitations/accept", (req: AuthedRequest, res) => {
  const parsed = z.object({ token: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Token inválido" });
    return;
  }
  const inv = q.prepare(`SELECT * FROM invitations WHERE token = ?`).get(sha256Hex(parsed.data.token)) as
    | { id: number; workspace_id: number; email: string; role: string; status: string; expires_at: string }
    | undefined;
  if (!inv || inv.status !== "pending" || new Date(inv.expires_at).getTime() < Date.now()) {
    res.status(400).json({ error: "Invitación inválida o caducada" });
    return;
  }
  if (inv.email.toLowerCase() !== req.user!.email.toLowerCase()) {
    res.status(403).json({ error: "Esta invitación no está dirigida a tu cuenta" });
    return;
  }
  tx(() => {
    q.prepare(`UPDATE invitations SET status = 'accepted' WHERE id = ?`).run(inv.id);
    q.prepare(`INSERT OR IGNORE INTO memberships (workspace_id, user_id, role) VALUES (?, ?, ?)`).run(
      inv.workspace_id, req.user!.id, inv.role,
    );
  });
  audit({ userId: req.user!.id, ip: req.ip }, "workspace.invitation_accepted", "workspace", inv.workspace_id);
  res.json({ ok: true, workspaceId: inv.workspace_id });
});

// Reject an invitation
workspacesRouter.post("/invitations/reject", (req: AuthedRequest, res) => {
  const parsed = z.object({ token: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Token inválido" });
    return;
  }
  const inv = q.prepare(`SELECT * FROM invitations WHERE token = ?`).get(sha256Hex(parsed.data.token)) as
    | { id: number; email: string; status: string }
    | undefined;
  if (!inv || inv.status !== "pending" || inv.email.toLowerCase() !== req.user!.email.toLowerCase()) {
    res.status(400).json({ error: "Invitación inválida" });
    return;
  }
  q.prepare(`UPDATE invitations SET status = 'rejected' WHERE id = ?`).run(inv.id);
  res.json({ ok: true });
});

// Cancel invitation
workspacesRouter.delete("/:id/invitations/:invitationId", (req: AuthedRequest, res) => {
  const wid = Number(req.params.id);
  const m = getMembership(req.user!.id, wid);
  if (!m || !roleAtLeast(m.role, "admin")) {
    res.status(403).json({ error: "Permisos insuficientes" });
    return;
  }
  const inv = q.prepare(`SELECT id FROM invitations WHERE id = ? AND workspace_id = ?`).get(Number(req.params.invitationId), wid);
  if (!inv) {
    res.status(404).json({ error: "Invitación no encontrada" });
    return;
  }
  q.prepare(`UPDATE invitations SET status = 'cancelled' WHERE id = ?`).run(Number(req.params.invitationId));
  audit({ userId: req.user!.id, ip: req.ip }, "workspace.invitation_cancelled", "workspace", wid);
  res.json({ ok: true });
});

// Resend invitation (verified accounts only — see above)
workspacesRouter.post("/:id/invitations/:invitationId/resend", requireVerified, (req: AuthedRequest, res) => {
  const wid = Number(req.params.id);
  const m = getMembership(req.user!.id, wid);
  if (!m || !roleAtLeast(m.role, "admin")) {
    res.status(403).json({ error: "Permisos insuficientes" });
    return;
  }
  const inv = q.prepare(`SELECT * FROM invitations WHERE id = ? AND workspace_id = ?`).get(Number(req.params.invitationId), wid) as
    | { id: number; email: string; role: string; token: string; status: string; expires_at: string }
    | undefined;
  if (!inv || inv.status !== "pending") {
    res.status(404).json({ error: "Invitación no encontrada o no pendiente" });
    return;
  }
  // Resending rotates the token (the stored value is a hash, so the previous
  // plaintext can never be recovered) and extends the expiry.
  const newToken = randomToken(32);
  const expiresAt = new Date(Date.now() + 7 * 86400_000).toISOString();
  q.prepare(`UPDATE invitations SET token = ?, expires_at = ? WHERE id = ?`).run(sha256Hex(newToken), expiresAt, inv.id);
  const ws = q.prepare(`SELECT name FROM workspaces WHERE id = ?`).get(wid) as { name: string };
  void sendMail(invitationEmail(inv.email, `${config.appUrl}/invitations/accept?token=${encodeURIComponent(newToken)}`, ws.name, inv.role));
  res.json({ ok: true });
});
