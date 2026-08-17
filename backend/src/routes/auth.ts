import { Router } from "express";
import bcrypt from "bcryptjs";
import { authenticator } from "otplib";
import { z } from "zod";
import { db, q, tx } from "../db.js";
import { config } from "../config.js";
import {
  clearSessionCookie,
  createSession,
  currentUser,
  requireAuth,
  setSessionCookie,
  type AuthedRequest,
} from "../middleware/auth.js";
import { authLimiter, registerLimiter } from "../middleware/ratelimit.js";
import { audit } from "../util/audit.js";
import { randomToken, sha256Hex } from "../util/ids.js";
import { decryptAtRest, encryptAtRest } from "../util/crypto.js";
import { resetPasswordEmail, sendMail, verificationEmail } from "../util/email.js";

export const authRouter = Router();

const emailSchema = z.string().email().max(254);
const passwordSchema = z.string().min(10).max(128);

function publicUser(u: {
  id: number; email: string; name: string; is_admin: number;
  email_verified_at: string | null; mfa_enabled: number;
}) {
  return {
    id: u.id,
    email: u.email,
    name: u.name,
    isAdmin: u.is_admin === 1,
    emailVerified: !!u.email_verified_at,
    mfaEnabled: u.mfa_enabled === 1,
  };
}

function findUserByEmail(email: string) {
  return db
    .prepare(`SELECT * FROM users WHERE email = ? AND deleted_at IS NULL`)
    .get(email.toLowerCase()) as
    | {
        id: number; email: string; name: string; password_hash: string;
        is_admin: number; email_verified_at: string | null; mfa_enabled: number;
        mfa_secret: string | null; recovery_codes: string | null;
      }
    | undefined;
}

// ---------------- Register ----------------
authRouter.post("/register", registerLimiter, async (req: AuthedRequest, res) => {
  const parsed = z
    .object({ name: z.string().trim().min(2).max(80), email: emailSchema, password: passwordSchema })
    .safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Datos inválidos", details: parsed.error.flatten() });
    return;
  }
  const { name, email, password } = parsed.data;
  const exists = q.prepare(`SELECT id FROM users WHERE email = ?`).get(email.toLowerCase());
  if (exists) {
    // Anti-enumeration: the response is byte-for-byte identical to a fresh
    // registration (201 + { user: null }) and takes a similar time (dummy
    // bcrypt), so the endpoint cannot be used to confirm account existence.
    audit({}, "auth.register_duplicate", "user", exists.id as number);
    await bcrypt.hash(password, 12); // timing equalization only
    res.status(201).json({ user: null });
    return;
  }
  const passwordHash = await bcrypt.hash(password, 12);
  const userId = tx(() => {
    const info = db
      .prepare(`INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)`)
      .run(email.toLowerCase(), name, passwordHash);
    const uid = Number(info.lastInsertRowid);
    const wsInfo = db
      .prepare(`INSERT INTO workspaces (name, slug, owner_user_id) VALUES (?, ?, ?)`)
      .run(`Workspace de ${name}`, `ws-${randomToken(6).toLowerCase()}`, uid);
    const wid = Number(wsInfo.lastInsertRowid);
    q.prepare(`INSERT INTO memberships (workspace_id, user_id, role) VALUES (?, ?, 'owner')`).run(wid, uid);
    q.prepare(`INSERT INTO quotas (workspace_id, links_limit) VALUES (?, 1000)`).run(wid);
    return uid;
  });

  // Send verification email (fire and forget). Only the hash is stored; the
  // plaintext token is the bearer credential in the email link.
  const token = randomToken(32);
  q.prepare(`INSERT INTO email_tokens (id, user_id, kind, expires_at) VALUES (?, ?, 'verify', ?)`).run(
    sha256Hex(token), userId, new Date(Date.now() + 86400_000).toISOString(),
  );
  const verifyUrl = `${config.appUrl}/auth/verify-email?token=${encodeURIComponent(token)}`;
  void sendMail(verificationEmail(email, verifyUrl));

  audit({ userId }, "auth.register", "user", userId);
  // Uniform response (anti-enumeration): identical shape to the duplicate path.
  // No session is created at registration; the frontend always shows the
  // "check your email" step.
  res.status(201).json({ user: null });
});

// ---------------- Login (with MFA challenge) ----------------
const mfaChallenges = new Map<string, { userId: number; expiresAt: number }>();
const MFA_CHALLENGE_TTL = 5 * 60_000;

/** Bound the in-memory challenge map: drop expired entries on every insert. */
function pruneMfaChallenges(): void {
  const now = Date.now();
  for (const [k, v] of mfaChallenges) {
    if (v.expiresAt < now) mfaChallenges.delete(k);
  }
}

authRouter.post("/login", authLimiter, async (req: AuthedRequest, res) => {
  const parsed = z.object({ email: emailSchema, password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Datos inválidos" });
    return;
  }
  const user = findUserByEmail(parsed.data.email);
  // Constant-time-ish: always run bcrypt so the response time does not reveal
  // whether the email exists (user enumeration via timing).
  const DUMMY_HASH = "$2a$12$/GUN2z.VnhsX9hCNc/gLLeqmo0rqp7vEF.MoYHWfxDG8X7AnJCx32";
  const ok = await bcrypt.compare(parsed.data.password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) {
    res.status(401).json({ error: "Credenciales incorrectas" });
    return;
  }
  audit({ userId: user.id }, "auth.login", "user", user.id);
  if (user.mfa_enabled === 1) {
    pruneMfaChallenges();
    const challenge = randomToken(24);
    mfaChallenges.set(challenge, { userId: user.id, expiresAt: Date.now() + MFA_CHALLENGE_TTL });
    res.json({ mfaRequired: true, challenge });
    return;
  }
  const session = createSession(user.id, req);
  setSessionCookie(res, session);
  res.json({ user: publicUser(user) });
});

authRouter.post("/mfa/verify", authLimiter, async (req: AuthedRequest, res) => {
  const parsed = z.object({ challenge: z.string().min(1), code: z.string().regex(/^\d{6}$/) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Código inválido" });
    return;
  }
  const ch = mfaChallenges.get(parsed.data.challenge);
  if (!ch || ch.expiresAt < Date.now()) {
    mfaChallenges.delete(parsed.data.challenge);
    res.status(401).json({ error: "Sesión MFA caducada" });
    return;
  }
  const user = q.prepare(`SELECT * FROM users WHERE id = ?`).get(ch.userId) as
    | { id: number; email: string; name: string; is_admin: number; email_verified_at: string | null; mfa_enabled: number; mfa_secret: string | null }
    | undefined;
  if (!user?.mfa_secret) {
    res.status(401).json({ error: "MFA no configurado" });
    return;
  }
  const valid = authenticator.check(parsed.data.code, decryptAtRest(user.mfa_secret));
  if (!valid) {
    res.status(401).json({ error: "Código incorrecto" });
    return;
  }
  mfaChallenges.delete(parsed.data.challenge);
  const session = createSession(user.id, req);
  setSessionCookie(res, session);
  res.json({ user: publicUser(user) });
});

authRouter.post("/mfa/recovery", authLimiter, async (req: AuthedRequest, res) => {
  const parsed = z.object({ email: emailSchema, code: z.string().trim().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Datos inválidos" });
    return;
  }
  const user = findUserByEmail(parsed.data.email);
  if (!user || user.mfa_enabled !== 1 || !user.recovery_codes) {
    res.status(401).json({ error: "No se puede usar un código de recuperación" });
    return;
  }
  const codes = JSON.parse(user.recovery_codes) as string[];
  const idx = codes.indexOf(sha256Hex(parsed.data.code.trim().toUpperCase()));
  if (idx === -1) {
    res.status(401).json({ error: "Código de recuperación incorrecto" });
    return;
  }
  codes.splice(idx, 1);
  q.prepare(`UPDATE users SET recovery_codes = ? WHERE id = ?`).run(JSON.stringify(codes), user.id);
  audit({ userId: user.id }, "auth.mfa_recovery", "user", user.id);
  const session = createSession(user.id, req);
  setSessionCookie(res, session);
  res.json({ user: publicUser(user) });
});

// ---------------- Logout ----------------
authRouter.post("/logout", (req: AuthedRequest, res) => {
  if (req.sessionId) {
    q.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).run(new Date().toISOString(), req.sessionId);
    audit({ userId: req.user?.id }, "auth.logout", "session", req.sessionId);
  }
  clearSessionCookie(res);
  res.json({ ok: true });
});

// ---------------- Email verification ----------------
authRouter.post("/verify-email", async (req: AuthedRequest, res) => {
  const parsed = z.object({ token: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Token inválido" });
    return;
  }
  const row = q.prepare(`SELECT * FROM email_tokens WHERE id = ? AND kind = 'verify'`).get(sha256Hex(parsed.data.token)) as
    | { id: string; user_id: number; expires_at: string; used_at: string | null }
    | undefined;
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
    res.status(400).json({ error: "Token inválido o caducado" });
    return;
  }
  tx(() => {
    q.prepare(`UPDATE email_tokens SET used_at = ? WHERE id = ?`).run(new Date().toISOString(), row.id);
    q.prepare(`UPDATE users SET email_verified_at = ? WHERE id = ?`).run(new Date().toISOString(), row.user_id);
  });
  audit({ userId: row.user_id }, "auth.email_verified", "user", row.user_id);
  res.json({ ok: true });
});

authRouter.post("/resend-verification", requireAuth, async (req: AuthedRequest, res) => {
  const user = req.user!;
  if (user.emailVerified) {
    res.status(400).json({ error: "El email ya está verificado" });
    return;
  }
  const token = randomToken(32);
  q.prepare(`INSERT INTO email_tokens (id, user_id, kind, expires_at) VALUES (?, ?, 'verify', ?)`).run(
    sha256Hex(token), user.id, new Date(Date.now() + 86400_000).toISOString(),
  );
  void sendMail(verificationEmail(user.email, `${config.appUrl}/auth/verify-email?token=${encodeURIComponent(token)}`));
  res.json({ ok: true });
});

// ---------------- Password recovery ----------------
authRouter.post("/forgot-password", authLimiter, async (req: AuthedRequest, res) => {
  const parsed = z.object({ email: emailSchema }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Email inválido" });
    return;
  }
  const user = findUserByEmail(parsed.data.email);
  if (user) {
    const token = randomToken(32);
    q.prepare(`INSERT INTO email_tokens (id, user_id, kind, expires_at) VALUES (?, ?, 'reset', ?)`).run(
      sha256Hex(token), user.id, new Date(Date.now() + 60 * 60_000).toISOString(),
    );
    void sendMail(resetPasswordEmail(user.email, `${config.appUrl}/auth/reset-password?token=${encodeURIComponent(token)}`));
  }
  // Always return the same response to avoid user enumeration.
  res.json({ ok: true });
});

authRouter.post("/reset-password", authLimiter, async (req: AuthedRequest, res) => {
  const parsed = z.object({ token: z.string().min(1), password: passwordSchema }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Datos inválidos" });
    return;
  }
  const row = q.prepare(`SELECT * FROM email_tokens WHERE id = ? AND kind = 'reset'`).get(sha256Hex(parsed.data.token)) as
    | { id: string; user_id: number; expires_at: string; used_at: string | null }
    | undefined;
  if (!row || row.used_at || new Date(row.expires_at).getTime() < Date.now()) {
    res.status(400).json({ error: "Token inválido o caducado" });
    return;
  }
  const passwordHash = await bcrypt.hash(parsed.data.password, 12);
  tx(() => {
    q.prepare(`UPDATE email_tokens SET used_at = ? WHERE id = ?`).run(new Date().toISOString(), row.id);
    q.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).run(
      passwordHash, new Date().toISOString(), row.user_id,
    );
    // Revoke all sessions after a password reset (session fixation defense)
    q.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).run(
      new Date().toISOString(), row.user_id,
    );
  });
  audit({ userId: row.user_id }, "auth.password_reset", "user", row.user_id);
  res.json({ ok: true });
});

// ---------------- Authenticated ----------------
authRouter.get("/me", requireAuth, (req: AuthedRequest, res) => {
  const row = q.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user!.id) as never;
  res.json({ user: publicUser(row) });
});

authRouter.patch("/profile", requireAuth, (req: AuthedRequest, res) => {
  const parsed = z.object({ name: z.string().trim().min(2).max(80) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Nombre inválido" });
    return;
  }
  q.prepare(`UPDATE users SET name = ?, updated_at = ? WHERE id = ?`).run(parsed.data.name, new Date().toISOString(), req.user!.id);
  audit({ userId: req.user!.id }, "auth.profile_update", "user", req.user!.id);
  res.json({ user: publicUser(q.prepare(`SELECT * FROM users WHERE id = ?`).get(req.user!.id) as never) });
});

authRouter.post("/change-password", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z.object({ current: z.string().min(1), newPassword: passwordSchema }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Datos inválidos" });
    return;
  }
  const user = q.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(req.user!.id) as { password_hash: string };
  const ok = await bcrypt.compare(parsed.data.current, user.password_hash);
  if (!ok) {
    res.status(403).json({ error: "Contraseña actual incorrecta" });
    return;
  }
  const passwordHash = await bcrypt.hash(parsed.data.newPassword, 12);
  tx(() => {
    q.prepare(`UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?`).run(
      passwordHash, new Date().toISOString(), req.user!.id,
    );
    q.prepare(`UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND id != ?`).run(
      new Date().toISOString(), req.user!.id, req.sessionId ?? "",
    );
  });
  audit({ userId: req.user!.id }, "auth.password_change", "user", req.user!.id);
  res.json({ ok: true });
});

authRouter.get("/sessions", requireAuth, (req: AuthedRequest, res) => {
  const rows = db
    .prepare(`SELECT id, user_agent, created_at, last_used_at, expires_at, revoked_at FROM sessions WHERE user_id = ? ORDER BY last_used_at DESC`)
    .all(req.user!.id) as Array<{ id: string; user_agent: string | null; created_at: string; last_used_at: string; expires_at: string; revoked_at: string | null }>;
  res.json({ sessions: rows });
});

authRouter.post("/sessions/:id/revoke", requireAuth, (req: AuthedRequest, res) => {
  const row = q.prepare(`SELECT id FROM sessions WHERE id = ? AND user_id = ?`).get(req.params.id, req.user!.id);
  if (!row) {
    res.status(404).json({ error: "Sesión no encontrada" });
    return;
  }
  q.prepare(`UPDATE sessions SET revoked_at = ? WHERE id = ?`).run(new Date().toISOString(), req.params.id);
  audit({ userId: req.user!.id }, "auth.session_revoke", "session", req.params.id);
  res.json({ ok: true });
});

// ---------------- MFA setup ----------------
authRouter.post("/mfa/setup", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Contraseña requerida" });
    return;
  }
  const user = q.prepare(`SELECT password_hash, mfa_enabled FROM users WHERE id = ?`).get(req.user!.id) as {
    password_hash: string; mfa_enabled: number;
  };
  const ok = await bcrypt.compare(parsed.data.password, user.password_hash);
  if (!ok) {
    res.status(403).json({ error: "Contraseña incorrecta" });
    return;
  }
  const secret = authenticator.generateSecret();
  q.prepare(`UPDATE users SET mfa_secret = ? WHERE id = ?`).run(encryptAtRest(secret), req.user!.id);
  const uri = authenticator.keyuri(req.user!.email, "UVH", secret);
  audit({ userId: req.user!.id }, "auth.mfa_setup", "user", req.user!.id);
  res.json({ secret, uri });
});

authRouter.post("/mfa/enable", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z.object({ code: z.string().regex(/^\d{6}$/) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Código inválido" });
    return;
  }
  const user = q.prepare(`SELECT mfa_secret FROM users WHERE id = ?`).get(req.user!.id) as { mfa_secret: string | null };
  if (!user.mfa_secret || !authenticator.check(parsed.data.code, decryptAtRest(user.mfa_secret))) {
    res.status(403).json({ error: "Código incorrecto" });
    return;
  }
  const recoveryCodes = Array.from({ length: 10 }, () => randomToken(5).toUpperCase().slice(0, 10));
  // Store only hashes of the one-time recovery codes; the plaintext is shown once.
  q.prepare(`UPDATE users SET mfa_enabled = 1, recovery_codes = ?, updated_at = ? WHERE id = ?`).run(
    JSON.stringify(recoveryCodes.map((c) => sha256Hex(c))), new Date().toISOString(), req.user!.id,
  );
  audit({ userId: req.user!.id }, "auth.mfa_enable", "user", req.user!.id);
  res.json({ recoveryCodes });
});

authRouter.post("/mfa/disable", requireAuth, async (req: AuthedRequest, res) => {
  const parsed = z.object({ password: z.string().min(1) }).safeParse(req.body);
  if (!parsed.success) {
    res.status(422).json({ error: "Contraseña requerida" });
    return;
  }
  const user = q.prepare(`SELECT password_hash FROM users WHERE id = ?`).get(req.user!.id) as { password_hash: string };
  const ok = await bcrypt.compare(parsed.data.password, user.password_hash);
  if (!ok) {
    res.status(403).json({ error: "Contraseña incorrecta" });
    return;
  }
  q.prepare(`UPDATE users SET mfa_enabled = 0, mfa_secret = NULL, recovery_codes = NULL, updated_at = ? WHERE id = ?`).run(
    new Date().toISOString(), req.user!.id,
  );
  audit({ userId: req.user!.id }, "auth.mfa_disable", "user", req.user!.id);
  res.json({ ok: true });
});

export { currentUser };
