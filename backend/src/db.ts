import { createRequire } from "node:module";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { config } from "./config.js";
import { sha256Hex } from "./util/ids.js";
import { encryptAtRest } from "./util/crypto.js";

// Load via createRequire so Vite/vitest never tries to resolve the very new
// `node:sqlite` builtin (it is not in Vite's builtin list yet).
const require = createRequire(import.meta.url);
const { DatabaseSync } = require("node:sqlite") as typeof import("node:sqlite");

mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new DatabaseSync(config.dbPath);

type SQLValue = string | number | bigint | null | Uint8Array;

/** Normalize runtime values for node:sqlite (undefined → null, unknown → typed). */
function norm(v: unknown): SQLValue {
  if (v === undefined) return null;
  if (v === null) return null;
  // NaN/Infinity (e.g. Number("abc") on route params) would make node:sqlite
  // throw and turn typos into 500s; bind NULL instead so queries just match
  // nothing (404/empty result).
  if (typeof v === "number" && !Number.isFinite(v)) return null;
  if (typeof v === "string" || typeof v === "number" || typeof v === "bigint") return v;
  if (v instanceof Uint8Array) return v;
  return String(v);
}

/**
 * Typed query helper that accepts `unknown` params and coerces undefined to
 * NULL, so strict TypeScript stays happy without sprinkling `!` everywhere.
 */
export const q = {
  prepare(sql: string) {
    const stmt = db.prepare(sql);
    return {
      run(...params: unknown[]) {
        return stmt.run(...params.map(norm));
      },
      get(...params: unknown[]): Record<string, unknown> | undefined {
        return stmt.get(...params.map(norm)) as Record<string, unknown> | undefined;
      },
      all(...params: unknown[]): Array<Record<string, unknown>> {
        return stmt.all(...params.map(norm)) as Array<Record<string, unknown>>;
      },
    };
  },
};


// Durability + concurrency for SQLite
db.exec("PRAGMA journal_mode = WAL");
db.exec("PRAGMA synchronous = NORMAL");
db.exec("PRAGMA foreign_keys = ON");
db.exec("PRAGMA busy_timeout = 5000");

/** Run fn inside an atomic transaction (BEGIN IMMEDIATE). Rollback on error. */
export function tx<T>(fn: () => T): T {
  db.exec("BEGIN IMMEDIATE");
  try {
    const result = fn();
    db.exec("COMMIT");
    return result;
  } catch (err) {
    db.exec("ROLLBACK");
    throw err;
  }
}

export function migrate() {
  db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    name TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    email_verified_at TEXT NULL,
    is_admin INTEGER NOT NULL DEFAULT 0,
    mfa_enabled INTEGER NOT NULL DEFAULT 0,
    mfa_secret TEXT NULL,
    recovery_codes TEXT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    deleted_at TEXT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    user_agent TEXT NULL,
    ip_hash TEXT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    last_used_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    expires_at TEXT NOT NULL,
    revoked_at TEXT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

  CREATE TABLE IF NOT EXISTS workspaces (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    owner_user_id INTEGER NOT NULL REFERENCES users(id),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS memberships (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role TEXT NOT NULL CHECK (role IN ('owner','admin','editor','viewer')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (workspace_id, user_id)
  );
  CREATE INDEX IF NOT EXISTS idx_memberships_user ON memberships(user_id);

  CREATE TABLE IF NOT EXISTS invitations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    email TEXT NOT NULL COLLATE NOCASE,
    role TEXT NOT NULL CHECK (role IN ('admin','editor','viewer')),
    token TEXT NOT NULL UNIQUE,
    invited_by INTEGER NOT NULL REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','rejected','cancelled','expired')),
    expires_at TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (workspace_id, email)
  );

  CREATE TABLE IF NOT EXISTS custom_domains (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    domain TEXT NOT NULL COLLATE NOCASE,
    verification_token TEXT NOT NULL,
    state TEXT NOT NULL DEFAULT 'pending' CHECK (state IN ('pending','verifying','verified','active','error','disabled')),
    verified_at TEXT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    UNIQUE (domain)
  );

  CREATE TABLE IF NOT EXISTS links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    created_by INTEGER NOT NULL REFERENCES users(id),
    domain_id INTEGER NULL REFERENCES custom_domains(id) ON DELETE SET NULL,
    alias TEXT NOT NULL COLLATE NOCASE,
    destination TEXT NOT NULL,
    fallback_destination TEXT NULL,
    state TEXT NOT NULL DEFAULT 'active' CHECK (state IN ('scheduled','active','paused','expired','blocked','archived','deleted')),
    password_hash TEXT NULL,
    max_clicks INTEGER NULL,
    click_count INTEGER NOT NULL DEFAULT 0,
    single_use INTEGER NOT NULL DEFAULT 0,
    used_at TEXT NULL,
    scheduled_at TEXT NULL,
    expires_at TEXT NULL,
    notes TEXT NULL,
    utm_source TEXT NULL, utm_medium TEXT NULL, utm_campaign TEXT NULL, utm_term TEXT NULL, utm_content TEXT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    deleted_at TEXT NULL,
    UNIQUE (domain_id, alias)
  );
  CREATE INDEX IF NOT EXISTS idx_links_workspace ON links(workspace_id);
  CREATE INDEX IF NOT EXISTS idx_links_alias ON links(alias);
  -- SQLite treats NULLs as distinct in UNIQUE constraints, so the default-host
  -- aliases (domain_id IS NULL) need their own partial unique index to prevent
  -- collisions under concurrency (the app-level check alone has a TOCTOU race).
  CREATE UNIQUE INDEX IF NOT EXISTS idx_links_default_alias_unique ON links(alias) WHERE domain_id IS NULL;

  CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL COLLATE NOCASE,
    UNIQUE (workspace_id, name)
  );
  CREATE TABLE IF NOT EXISTS link_tags (
    link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
    PRIMARY KEY (link_id, tag_id)
  );

  CREATE TABLE IF NOT EXISTS redirect_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    priority INTEGER NOT NULL DEFAULT 0,
    country TEXT NULL,
    language TEXT NULL,
    device TEXT NULL,
    os TEXT NULL,
    time_from TEXT NULL,
    time_to TEXT NULL,
    referrer TEXT NULL,
    campaign TEXT NULL,
    destination TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_rules_link ON redirect_rules(link_id);

  CREATE TABLE IF NOT EXISTS click_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    occurred_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    country TEXT NULL,
    device TEXT NULL,
    browser TEXT NULL,
    os TEXT NULL,
    referrer_domain TEXT NULL,
    campaign TEXT NULL,
    visitor_hash TEXT NULL,
    password_ok INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_click_link_time ON click_events(link_id, occurred_at);

  CREATE TABLE IF NOT EXISTS metric_rollups (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    day TEXT NOT NULL,
    clicks INTEGER NOT NULL DEFAULT 0,
    visitors INTEGER NOT NULL DEFAULT 0,
    countries TEXT NULL,
    devices TEXT NULL,
    browsers TEXT NULL,
    os TEXT NULL,
    referrers TEXT NULL,
    campaigns TEXT NULL,
    UNIQUE (link_id, day)
  );

  CREATE TABLE IF NOT EXISTS api_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    token_hash TEXT NOT NULL UNIQUE,
    scopes TEXT NOT NULL,
    last_used_at TEXT NULL,
    expires_at TEXT NULL,
    revoked_at TEXT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS webhooks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    workspace_id INTEGER NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
    url TEXT NOT NULL,
    secret TEXT NOT NULL,
    events TEXT NOT NULL,
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS webhook_deliveries (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    webhook_id INTEGER NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
    event TEXT NOT NULL,
    event_id TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','success','failed')),
    attempts INTEGER NOT NULL DEFAULT 0,
    last_error TEXT NULL,
    next_attempt_at TEXT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now')),
    delivered_at TEXT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_deliveries_webhook ON webhook_deliveries(webhook_id);

  CREATE TABLE IF NOT EXISTS abuse_reports (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    link_id INTEGER NOT NULL REFERENCES links(id) ON DELETE CASCADE,
    reporter_email TEXT NULL,
    reason TEXT NOT NULL,
    details TEXT NULL,
    status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','reviewed','actioned','dismissed')),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS audit_events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NULL REFERENCES users(id) ON DELETE SET NULL,
    action TEXT NOT NULL,
    resource_type TEXT NULL,
    resource_id TEXT NULL,
    metadata TEXT NULL,
    ip_hash TEXT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_audit_time ON audit_events(created_at);

  CREATE TABLE IF NOT EXISTS quotas (
    workspace_id INTEGER PRIMARY KEY REFERENCES workspaces(id) ON DELETE CASCADE,
    links_limit INTEGER NOT NULL DEFAULT 1000,
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );

  CREATE TABLE IF NOT EXISTS email_tokens (
    id TEXT PRIMARY KEY,
    user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    kind TEXT NOT NULL CHECK (kind IN ('verify','reset','mfa_recovery')),
    expires_at TEXT NOT NULL,
    used_at TEXT NULL,
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ','now'))
  );
  CREATE INDEX IF NOT EXISTS idx_email_tokens_user ON email_tokens(user_id);

  -- Housekeeping purge indexes: keep the scheduler's DELETE ... WHERE scans
  -- off the hot path once tables grow. Partial indexes keep them small.
  CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
  CREATE INDEX IF NOT EXISTS idx_sessions_revoked ON sessions(revoked_at) WHERE revoked_at IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_email_tokens_created ON email_tokens(created_at);
  CREATE INDEX IF NOT EXISTS idx_click_time ON click_events(occurred_at);
  CREATE INDEX IF NOT EXISTS idx_deliveries_success_delivered ON webhook_deliveries(delivered_at) WHERE status = 'success';
  `);

  // api_tokens.created_by was added later than the original schema; SQLite
  // has no ALTER TABLE ... IF NOT EXISTS, so tolerate the duplicate-column error.
  try {
    db.exec(`ALTER TABLE api_tokens ADD COLUMN created_by INTEGER NULL REFERENCES users(id) ON DELETE SET NULL`);
  } catch {
    /* column already exists */
  }

  // Data migrations (idempotent).
  migrateLegacyTokens();
  // Re-encrypt at-rest secrets stored before encryption existed (they lack
  // the enc:v1: prefix). Once rewritten, a DB leak alone no longer exposes
  // TOTP secrets or webhook signing secrets.
  for (const [table, col] of [["users", "mfa_secret"], ["webhooks", "secret"]] as const) {
    const rows = q
      .prepare(`SELECT id FROM ${table} WHERE ${col} IS NOT NULL AND ${col} NOT LIKE 'enc:v1:%'`)
      .all() as Array<{ id: number }>;
    for (const row of rows) {
      const rec = q.prepare(`SELECT ${col} AS value FROM ${table} WHERE id = ?`).get(row.id) as { value: string } | undefined;
      if (rec?.value) {
        q.prepare(`UPDATE ${table} SET ${col} = ? WHERE id = ?`).run(encryptAtRest(rec.value), row.id);
      }
    }
  }
}

/**
 * One-time upgrade for databases created before the token-hashing hardening
 * (commit 4963dbc): email and invitation tokens used to be stored in plaintext
 * (base64url, 43 chars), while the app now stores sha256 hex (64 lowercase hex
 * chars) and looks tokens up by hash. Hash any legacy row in place so links
 * that were already emailed keep working after deploying over an existing DB.
 */
function migrateLegacyTokens(): void {
  const legacyTables = [
    ["email_tokens", "id"],
    ["invitations", "token"],
  ] as const;
  for (const [table, col] of legacyTables) {
    const legacy = q
      .prepare(`SELECT ${col} AS value FROM ${table} WHERE length(${col}) <> 64 OR ${col} GLOB '*[^0-9a-f]*'`)
      .all() as Array<{ value: string }>;
    if (legacy.length === 0) continue;
    tx(() => {
      for (const row of legacy) {
        q.prepare(`UPDATE ${table} SET ${col} = ? WHERE ${col} = ?`).run(sha256Hex(row.value), row.value);
      }
    });
  }
}
