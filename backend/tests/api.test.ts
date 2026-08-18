import { afterAll, beforeAll, describe, expect, it } from "vitest";
import request from "supertest";
import path from "node:path";
import os from "node:os";
import fs from "node:fs";

// Isolated DB — set env BEFORE importing the app.
const DB_PATH = path.join(os.tmpdir(), `uvh-test-${Date.now()}.sqlite`);
process.env.DATABASE_PATH = DB_PATH;
process.env.APP_SECRET = "test-secret-0123456789";
process.env.RESEND_API_KEY = "";
process.env.NODE_ENV = "test";
process.env.REGISTER_LIMIT = "1000";
process.env.AUTH_LIMIT = "1000";
process.env.RESOLVE_LIMIT = "100000";

const { createApp } = await import("../src/app.js");
const { migrate } = await import("../src/db.js");
const db = await import("../src/db.js");
const { assertSafeHost, assertSafeUrl } = await import("../src/util/ssrf.js");
const { sha256Hex } = await import("../src/util/ids.js");

const app = createApp();

beforeAll(() => {
  migrate();
});

afterAll(() => {
  try {
    fs.rmSync(DB_PATH, { force: true });
    fs.rmSync(`${DB_PATH}-wal`, { force: true });
    fs.rmSync(`${DB_PATH}-shm`, { force: true });
  } catch {
    /* ignore */
  }
});

const PASSWORD = "password-123456";

interface Session {
  agent: ReturnType<typeof request.agent>;
  token: string;
}

async function newSession(): Promise<Session> {
  const agent = request.agent(app);
  const res = await agent.get("/api/v1/health");
  const cookie = (res.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("uvh_csrf="));
  const token = cookie!.split(";")[0]!.split("=")[1]!;
  return { agent, token };
}

let userSeq = 0;
function uniqueEmail(prefix: string): string {
  userSeq += 1;
  return `${prefix}${userSeq}@example.com`;
}

async function registerVerifiedLogin(s: Session, email: string): Promise<void> {
  await s.agent
    .post("/api/v1/auth/register")
    .set("X-CSRF-Token", s.token)
    .send({ name: "Test User", email, password: PASSWORD })
    .expect(201);
  const user = db.q.prepare(`SELECT id FROM users WHERE email = ?`).get(email.toLowerCase()) as { id: number };
  // Tokens are stored hashed; the plaintext is what the user receives by email.
  const plain = `verify-${userSeq}-${Date.now()}`;
  db.q.prepare(`INSERT INTO email_tokens (id, user_id, kind, expires_at) VALUES (?, ?, 'verify', ?)`).run(
    sha256Hex(plain), user.id, new Date(Date.now() + 3600_000).toISOString(),
  );
  await s.agent.post("/api/v1/auth/verify-email").set("X-CSRF-Token", s.token).send({ token: plain }).expect(200);
  await s.agent.post("/api/v1/auth/login").set("X-CSRF-Token", s.token).send({ email, password: PASSWORD }).expect(200);
}

async function createLink(s: Session, payload: Record<string, unknown>) {
  return s.agent
    .post("/api/v1/links")
    .set("X-CSRF-Token", s.token)
    .send(payload);
}

describe("Auth", () => {
  it("registers, verifies and logs in", async () => {
    const s = await newSession();
    const email = uniqueEmail("alice");
    await registerVerifiedLogin(s, email);
    const me = await s.agent.get("/api/v1/auth/me");
    expect(me.status).toBe(200);
    expect(me.body.user.email).toBe(email);
    expect(me.body.user.emailVerified).toBe(true);
  });

  it("does not reveal existing accounts on registration (uniform response)", async () => {
    const s = await newSession();
    const first = await s.agent
      .post("/api/v1/auth/register")
      .set("X-CSRF-Token", s.token)
      .send({ name: "Alice Dup", email: "dup@example.com", password: PASSWORD });
    const second = await s.agent
      .post("/api/v1/auth/register")
      .set("X-CSRF-Token", s.token)
      .send({ name: "Bob Dup", email: "dup@example.com", password: PASSWORD });
    // Byte-identical responses (status + body): the endpoint cannot be used to
    // confirm whether an account exists.
    expect(first.status).toBe(201);
    expect(second.status).toBe(201);
    expect(first.body).toEqual(second.body);
    expect(first.body).toEqual({ user: null });
  });

  it("stores one-time email tokens hashed, never in plaintext", async () => {
    const s = await newSession();
    const email = uniqueEmail("hash");
    await registerVerifiedLogin(s, email);
    const user = db.q.prepare(`SELECT id FROM users WHERE email = ?`).get(email) as { id: number };
    const rows = db.q.prepare(`SELECT id FROM email_tokens WHERE user_id = ?`).all(user.id) as Array<{ id: string }>;
    expect(rows.length).toBeGreaterThan(0);
    for (const r of rows) {
      expect(r.id).toMatch(/^[0-9a-f]{64}$/); // sha256 hex, not the raw bearer token
    }
  });

  it("rejects wrong passwords", async () => {
    const s = await newSession();
    const email = uniqueEmail("carol");
    await registerVerifiedLogin(s, email);
    const res = await s.agent
      .post("/api/v1/auth/login")
      .set("X-CSRF-Token", s.token)
      .send({ email, password: "wrong-password" });
    expect(res.status).toBe(401);
  });

  it("requires CSRF token for mutations", async () => {
    const s = await newSession();
    const res = await s.agent.post("/api/v1/auth/login").send({ email: "nobody@example.com", password: PASSWORD });
    expect(res.status).toBe(403);
  });

  it("logout revokes the session", async () => {
    const s = await newSession();
    const email = uniqueEmail("dave");
    await registerVerifiedLogin(s, email);
    await s.agent.post("/api/v1/auth/logout").set("X-CSRF-Token", s.token).expect(200);
    const me = await s.agent.get("/api/v1/auth/me");
    expect(me.status).toBe(401);
  });

  it("resets password through a token", async () => {
    const s = await newSession();
    const email = uniqueEmail("erin");
    await registerVerifiedLogin(s, email);
    await s.agent.post("/api/v1/auth/forgot-password").set("X-CSRF-Token", s.token).send({ email }).expect(200);
    const user = db.q.prepare(`SELECT id FROM users WHERE email = ?`).get(email) as { id: number };
    const plain = `reset-${userSeq}-${Date.now()}`;
    db.q.prepare(`INSERT INTO email_tokens (id, user_id, kind, expires_at) VALUES (?, ?, 'reset', ?)`).run(
      sha256Hex(plain), user.id, new Date(Date.now() + 3600_000).toISOString(),
    );
    await s.agent.post("/api/v1/auth/reset-password").set("X-CSRF-Token", s.token).send({ token: plain, password: "new-password-789" }).expect(200);
    const bad = await s.agent.post("/api/v1/auth/login").set("X-CSRF-Token", s.token).send({ email, password: PASSWORD });
    expect(bad.status).toBe(401);
    const good = await s.agent.post("/api/v1/auth/login").set("X-CSRF-Token", s.token).send({ email, password: "new-password-789" });
    expect(good.status).toBe(200);
  });
});

describe("Links + authorization (A vs B)", () => {
  it("creates links with auto and custom aliases; rejects reserved names", async () => {
    const s = await newSession();
    await registerVerifiedLogin(s, uniqueEmail("frank"));

    const auto = await createLink(s, { destination: "https://example.com/page" });
    expect(auto.status).toBe(201);
    expect(auto.body.link.alias).toMatch(/^[A-Za-z0-9]{8}$/);
    expect(auto.body.link.state).toBe("active");

    const custom = await createLink(s, { destination: "https://example.com/2", alias: "mi-oferta" });
    expect(custom.status).toBe(201);
    expect(custom.body.link.alias).toBe("mi-oferta");

    const reserved = await createLink(s, { destination: "https://example.com/3", alias: "admin" });
    expect(reserved.status).toBe(422);
  });

  it("rejects invalid destinations (javascript:, data:, credentials, CR/LF, ftp)", async () => {
    const s = await newSession();
    await registerVerifiedLogin(s, uniqueEmail("gina"));
    for (const bad of ["javascript:alert(1)", "data:text/html;base64,PHNjcmlwdD4=", "https://user:pass@example.com", "https://exa\nmple.com", "ftp://example.com"]) {
      const res = await createLink(s, { destination: bad });
      expect(res.status).toBe(422);
    }
  });

  it("user B cannot see, edit or delete user A's links", async () => {
    const a = await newSession();
    await registerVerifiedLogin(a, uniqueEmail("alice"));
    const created = await createLink(a, { destination: "https://example.com/private", alias: "privado" });
    const linkId = created.body.link.id;

    const b = await newSession();
    await registerVerifiedLogin(b, uniqueEmail("bob"));

    const list = await b.agent.get("/api/v1/links");
    expect(list.status).toBe(200);
    expect(list.body.links.length).toBe(0);

    expect((await b.agent.get(`/api/v1/links/${linkId}`)).status).toBe(404);
    expect((await b.agent.patch(`/api/v1/links/${linkId}`).set("X-CSRF-Token", b.token).send({ destination: "https://evil.example.com" })).status).toBe(404);
    expect((await b.agent.delete(`/api/v1/links/${linkId}`).set("X-CSRF-Token", b.token)).status).toBe(404);

    const stillThere = await a.agent.get(`/api/v1/links/${linkId}`);
    expect(stillThere.status).toBe(200);
  });

  it("pauses a link", async () => {
    const s = await newSession();
    await registerVerifiedLogin(s, uniqueEmail("hugo"));
    const created = await createLink(s, { destination: "https://example.com/x", alias: "pausable" });
    const id = created.body.link.id;
    const pause = await s.agent.post(`/api/v1/links/${id}/state`).set("X-CSRF-Token", s.token).send({ state: "paused" });
    expect(pause.status).toBe(200);
  });

  it("edits alias and destination while preserving lifecycle state", async () => {
    const s = await newSession();
    await registerVerifiedLogin(s, uniqueEmail("irene"));
    const created = await createLink(s, { destination: "https://example.com/original", alias: "antes" });
    expect(created.status).toBe(201);
    const id = created.body.link.id;

    await s.agent.post(`/api/v1/links/${id}/state`).set("X-CSRF-Token", s.token).send({ state: "paused" }).expect(200);

    const edited = await s.agent
      .patch(`/api/v1/links/${id}`)
      .set("X-CSRF-Token", s.token)
      .send({ destination: "https://example.com/edited", alias: "despues" });
    expect(edited.status).toBe(200);
    expect(edited.body.link.alias).toBe("despues");
    expect(edited.body.link.destination).toBe("https://example.com/edited");
    expect(edited.body.link.state).toBe("paused");

    const row = db.q.prepare(`SELECT alias, destination, state FROM links WHERE id = ?`).get(id) as {
      alias: string;
      destination: string;
      state: string;
    };
    expect(row.alias).toBe("despues");
    expect(row.destination).toBe("https://example.com/edited");
    expect(row.state).toBe("paused");
  });
});

describe("Redirect resolution", () => {
  it("returns a real HTTP redirect for an active link", async () => {
    const s = await newSession();
    await registerVerifiedLogin(s, uniqueEmail("redir"));
    const created = await createLink(s, { destination: "https://example.com/target", alias: "destino" });
    expect(created.status).toBe(201);
    const res = await request(app).get("/r/destino").set("Host", "uvh.es");
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe("https://example.com/target");
  });

  it("redirects are never cached (analytics/single-use integrity)", async () => {
    const s = await newSession();
    await registerVerifiedLogin(s, uniqueEmail("cache"));
    await createLink(s, { destination: "https://example.com/nc", alias: "nocache" });
    const res = await request(app).get("/r/nocache").set("Host", "uvh.es");
    expect(res.status).toBe(302);
    expect(res.headers["cache-control"]).toContain("no-store");
  });

  it("does not resolve on unknown hosts", async () => {
    const res = await request(app).get("/r/destino").set("Host", "evil.example.org");
    expect(res.status).toBe(404);
  });

  it("single-use link is consumed atomically under concurrency", async () => {
    const s = await newSession();
    await registerVerifiedLogin(s, uniqueEmail("single"));
    const created = await createLink(s, { destination: "https://example.com/once", alias: "unico", singleUse: true });
    const alias = created.body.link.alias;

    const results = await Promise.all(
      Array.from({ length: 12 }, () => request(app).get(`/r/${alias}`).set("Host", "uvh.es")),
    );
    const redirects = results.filter((r) => r.status === 302).length;
    const gone = results.filter((r) => r.status === 410).length;
    expect(redirects).toBe(1);
    expect(gone).toBe(11);
  });

  it("max-clicks is enforced atomically under concurrency", async () => {
    const s = await newSession();
    await registerVerifiedLogin(s, uniqueEmail("maxc"));
    const created = await createLink(s, { destination: "https://example.com/limit", alias: "limite", maxClicks: 2 });
    const alias = created.body.link.alias;

    const results = await Promise.all(
      Array.from({ length: 8 }, () => request(app).get(`/r/${alias}`).set("Host", "uvh.es")),
    );
    const redirects = results.filter((r) => r.status === 302).length;
    expect(redirects).toBe(2);
  });

  it("password-protected links require the password", async () => {
    const s = await newSession();
    await registerVerifiedLogin(s, uniqueEmail("pw"));
    const created = await createLink(s, { destination: "https://example.com/secret", alias: "secreto", password: "clave-secreta-123" });
    const alias = created.body.link.alias;

    const denied = await request(app).get(`/r/${alias}`).set("Host", "uvh.es");
    expect(denied.status).toBe(403);

    const agent = request.agent(app);
    const page = await agent.get(`/r/${alias}`).set("Host", "uvh.es"); // sets the CSRF cookie
    const csrfCookie = (page.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("uvh_csrf="));
    const csrf = csrfCookie!.split(";")[0]!.split("=")[1]!;
    const ok = await agent.post(`/r/${alias}/unlock`).set("Host", "uvh.es").send({ password: "clave-secreta-123", _csrf: csrf });
    expect([200, 302]).toContain(ok.status);
    const follow = await agent.get(`/r/${alias}`).set("Host", "uvh.es");
    expect(follow.status).toBe(302);
    expect(follow.headers.location).toBe("https://example.com/secret");
  });

  it("unlocks via the real HTML form (urlencoded body + hidden _csrf)", async () => {
    const s = await newSession();
    await registerVerifiedLogin(s, uniqueEmail("form"));
    await createLink(s, { destination: "https://example.com/form", alias: "formpw", password: "clave-form-123" });

    const agent = request.agent(app);
    const page = await agent.get("/r/formpw").set("Host", "uvh.es");
    expect(page.status).toBe(403);
    const m = (page.text ?? "").match(/name="_csrf" value="([^"]+)"/);
    expect(m).not.toBeNull();

    const res = await agent
      .post("/r/formpw/unlock")
      .set("Host", "uvh.es")
      .type("form")
      .send({ password: "clave-form-123", _csrf: m![1] });
    expect(res.status).toBe(302);

    const follow = await agent.get("/r/formpw").set("Host", "uvh.es");
    expect(follow.status).toBe(302);
    expect(follow.headers.location).toBe("https://example.com/form");
  });

  it("does not 500 on malformed Referer headers (hot path)", async () => {
    const s = await newSession();
    await registerVerifiedLogin(s, uniqueEmail("ref"));
    await createLink(s, { destination: "https://example.com/r", alias: "refok" });
    for (const ref of ["not-a-url", "http://[", "https://exa mple.com"]) {
      const res = await request(app).get("/r/refok").set("Host", "uvh.es").set("Referer", ref);
      expect(res.status).toBe(302);
    }
  });

  it("serves an unavailable page for paused links", async () => {
    const res = await request(app).get("/r/pausable").set("Host", "uvh.es");
    expect(res.status).toBe(404);
    expect(res.text).toContain("pausa");
  });
});

describe("Analytics hardening", () => {
  it("rejects malformed date ranges instead of crashing (500 → 422)", async () => {
    const s = await newSession();
    await registerVerifiedLogin(s, uniqueEmail("dates"));
    const res = await s.agent.get("/api/v1/analytics/overview?from=not-a-date");
    expect(res.status).toBe(422);
    const badPeriod = await s.agent.get("/api/v1/analytics/overview?period=forever");
    expect(badPeriod.status).toBe(422);
    const good = await s.agent.get("/api/v1/analytics/overview?period=7d");
    expect(good.status).toBe(200);
  });

  it("rejects inverted and oversized from/to ranges", async () => {
    const s = await newSession();
    await registerVerifiedLogin(s, uniqueEmail("range"));
    const inverted = await s.agent.get("/api/v1/analytics/overview?from=2025-06-01T00:00:00Z&to=2025-05-01T00:00:00Z");
    expect(inverted.status).toBe(422);
    const oversized = await s.agent.get("/api/v1/analytics/overview?from=2020-01-01T00:00:00Z&to=2020-12-31T00:00:00Z");
    expect(oversized.status).toBe(422);
    const ok = await s.agent.get("/api/v1/analytics/overview?from=2025-06-01T00:00:00Z&to=2025-06-30T00:00:00Z");
    expect(ok.status).toBe(200);
  });
});

describe("API tokens", () => {
  it("stores only the hash, enforces scopes, and rejects revoked tokens", async () => {
    const s = await newSession();
    await registerVerifiedLogin(s, uniqueEmail("api"));

    const created = await s.agent
      .post("/api/v1/tokens")
      .set("X-CSRF-Token", s.token)
      .send({ name: "CI", scopes: ["analytics:read"] });
    expect(created.status).toBe(201);
    const plain = created.body.plainToken as string;
    expect(plain.startsWith("uvh_")).toBe(true);

    const stored = db.q.prepare(`SELECT token_hash FROM api_tokens WHERE id = ?`).get(created.body.token.id) as { token_hash: string };
    expect(stored.token_hash).not.toContain(plain);

    const analytics = await request(app).get("/api/v1/analytics/public/overview").set("Authorization", `Bearer ${plain}`);
    expect(analytics.status).toBe(200);

    // Scope enforcement: without links:read the links endpoint is rejected
    const links = await request(app).get("/api/v1/links").set("Authorization", `Bearer ${plain}`);
    expect(links.status).not.toBe(200);

    const revoke = await s.agent.delete(`/api/v1/tokens/${created.body.token.id}`).set("X-CSRF-Token", s.token);
    expect(revoke.status).toBe(200);

    const afterRevoke = await request(app).get("/api/v1/analytics/public/overview").set("Authorization", `Bearer ${plain}`);
    expect(afterRevoke.status).toBe(401);
  });
});

describe("SSRF guards", () => {
  it("blocks loopback, private, link-local and metadata addresses", async () => {
    for (const host of ["127.0.0.1", "10.0.0.8", "192.168.0.1", "172.16.0.5", "169.254.169.254", "::1", "fc00::1"]) {
      await expect(assertSafeHost(host)).rejects.toThrow(/interno|no se pudo/);
    }
  });

  it("blocks non-http schemes and restricted ports", async () => {
    await expect(assertSafeUrl("ftp://example.com")).rejects.toThrow(/esquema/);
    await expect(assertSafeUrl("file:///etc/passwd")).rejects.toThrow(/esquema/);
    await expect(assertSafeUrl("http://example.com:21/")).rejects.toThrow(/puerto/);
    await expect(assertSafeUrl("https://user:pass@example.com/")).rejects.toThrow(/credenciales/);
  });
});

describe("Analytics spoofing", () => {
  it("ignores a spoofed country header unless explicitly trusted", async () => {
    const { countryFromHeaders } = await import("../src/util/analytics.js");
    // Default: TRUST_COUNTRY_HEADER is unset in tests → header ignored.
    expect(countryFromHeaders({ "cf-ipcountry": "ES" })).toBeNull();
  });
});

describe("Links: collision, quota and domains", () => {
  it("rejects a duplicate custom alias", async () => {
    const s = await newSession();
    await registerVerifiedLogin(s, uniqueEmail("collide"));
    expect((await createLink(s, { destination: "https://example.com/1", alias: "colision" })).status).toBe(201);
    expect((await createLink(s, { destination: "https://example.com/2", alias: "colision" })).status).toBe(409);
  });

  it("enforces unique default-host aliases at the database level (race safety)", async () => {
    const s = await newSession();
    const email = uniqueEmail("dbuniq");
    await registerVerifiedLogin(s, email);
    const user = db.q.prepare(`SELECT id FROM users WHERE email = ?`).get(email) as { id: number };
    const ws = db.q.prepare(`SELECT workspace_id FROM memberships WHERE user_id = ? ORDER BY id LIMIT 1`).get(user.id) as { workspace_id: number };
    db.q.prepare(`INSERT INTO links (workspace_id, created_by, alias, destination, state) VALUES (?, ?, 'db-dup', 'https://example.com/1', 'active')`).run(ws.workspace_id, user.id);
    expect(() =>
      db.q.prepare(`INSERT INTO links (workspace_id, created_by, alias, destination, state) VALUES (?, ?, 'db-dup', 'https://example.com/2', 'active')`).run(ws.workspace_id, user.id),
    ).toThrow();
  });

  it("enforces the workspace link quota", async () => {
    const s = await newSession();
    const email = uniqueEmail("quota");
    await registerVerifiedLogin(s, email);
    const user = db.q.prepare(`SELECT id FROM users WHERE email = ?`).get(email) as { id: number };
    const ws = db.q.prepare(`SELECT workspace_id FROM memberships WHERE user_id = ? ORDER BY id LIMIT 1`).get(user.id) as { workspace_id: number };
    db.q.prepare(`INSERT INTO quotas (workspace_id, links_limit) VALUES (?, 1) ON CONFLICT(workspace_id) DO UPDATE SET links_limit = 1`).run(ws.workspace_id);
    expect((await createLink(s, { destination: "https://example.com/q1", alias: "quota1" })).status).toBe(201);
    expect((await createLink(s, { destination: "https://example.com/q2", alias: "quota2" })).status).toBe(429);
  });

  it("does not serve links on a custom domain until it is verified", async () => {
    const s = await newSession();
    const email = uniqueEmail("domain");
    await registerVerifiedLogin(s, email);
    const user = db.q.prepare(`SELECT id FROM users WHERE email = ?`).get(email) as { id: number };
    const ws = db.q.prepare(`SELECT workspace_id FROM memberships WHERE user_id = ? ORDER BY id LIMIT 1`).get(user.id) as { workspace_id: number };

    const d = await s.agent.post("/api/v1/domains").set("X-CSRF-Token", s.token).send({ domain: "short.example.com" });
    expect(d.status).toBe(201);
    const domainId = d.body.domain.id as number;
    expect(d.body.domain.state).toBe("pending");

    // A pending domain cannot be used when creating a link.
    expect((await createLink(s, { destination: "https://example.com/x", domainId })).status).toBe(403);

    // Even a link inserted directly must not resolve while the domain is pending.
    db.q.prepare(`INSERT INTO links (workspace_id, created_by, domain_id, alias, destination, state) VALUES (?, ?, ?, 'dup', 'https://example.com/x', 'active')`).run(ws.workspace_id, user.id, domainId);
    const before = await request(app).get("/dup").set("Host", "short.example.com");
    expect(before.status).toBe(404);
    expect(before.text).toContain("Dominio no configurado");

    // Once active it resolves.
    db.q.prepare(`UPDATE custom_domains SET state = 'active' WHERE id = ?`).run(domainId);
    const after = await request(app).get("/dup").set("Host", "short.example.com");
    expect(after.status).toBe(302);
    expect(after.headers.location).toBe("https://example.com/x");
  });

  it("scopes password unlocks to the exact host (no cross-domain reuse)", async () => {
    const s = await newSession();
    const email = uniqueEmail("pw-host");
    await registerVerifiedLogin(s, email);
    const user = db.q.prepare(`SELECT id FROM users WHERE email = ?`).get(email) as { id: number };
    const ws = db.q.prepare(`SELECT workspace_id FROM memberships WHERE user_id = ? ORDER BY id LIMIT 1`).get(user.id) as { workspace_id: number };

    const dom = db.q.prepare(`INSERT INTO custom_domains (workspace_id, domain, verification_token, state) VALUES (?, 'secure.example.com', 'tok', 'active')`).run(ws.workspace_id);
    const domainId = Number(dom.lastInsertRowid);

    expect((await createLink(s, { destination: "https://default.example.com/a", alias: "dup2", password: "passA" })).status).toBe(201);
    expect((await createLink(s, { destination: "https://custom.example.com/b", alias: "dup2", domainId, password: "passB" })).status).toBe(201);

    // Unlock on the custom host.
    const agent = request.agent(app);
    const page = await agent.get("/r/dup2").set("Host", "secure.example.com");
    const csrfCookie = (page.headers["set-cookie"] as unknown as string[]).find((c) => c.startsWith("uvh_csrf="));
    const csrf = csrfCookie!.split(";")[0]!.split("=")[1]!;
    const unlock = await agent.post("/r/dup2/unlock").set("Host", "secure.example.com").send({ password: "passB", _csrf: csrf });
    expect([200, 302]).toContain(unlock.status);

    const custom = await agent.get("/r/dup2").set("Host", "secure.example.com");
    expect(custom.status).toBe(302);
    expect(custom.headers.location).toBe("https://custom.example.com/b");

    // The same alias on the default host must still require its password.
    const defaultHost = await agent.get("/r/dup2").set("Host", "uvh.es");
    expect(defaultHost.status).toBe(403);
  });
});

describe("Webhooks", () => {
  it("validates URL and secret on creation", async () => {
    const s = await newSession();
    await registerVerifiedLogin(s, uniqueEmail("wh"));
    expect((await s.agent.post("/api/v1/webhooks").set("X-CSRF-Token", s.token).send({ url: "javascript:alert(1)", events: ["link.created"] })).status).toBe(422);
    expect((await s.agent.post("/api/v1/webhooks").set("X-CSRF-Token", s.token).send({ url: "ftp://example.com", events: ["link.created"] })).status).toBe(422);
    expect((await s.agent.post("/api/v1/webhooks").set("X-CSRF-Token", s.token).send({ url: "https://example.com/hook", events: ["link.created"], secret: "short" })).status).toBe(422);
    const ok = await s.agent.post("/api/v1/webhooks").set("X-CSRF-Token", s.token).send({ url: "https://example.com/hook", events: ["link.created"], secret: "a-very-long-secret-0123456789" });
    expect(ok.status).toBe(201);
    expect(ok.body.webhook.hasSecret).toBe(true);
    expect(ok.body.secret).toBe("a-very-long-secret-0123456789");
  });
});

describe("Workspaces", () => {
  it("stores invitation tokens hashed and rotates them on resend", async () => {
    const s = await newSession();
    await registerVerifiedLogin(s, uniqueEmail("invite"));
    const ws = await s.agent.post("/api/v1/workspaces").set("X-CSRF-Token", s.token).send({ name: "Equipo" }).expect(201);
    const wsId = ws.body.workspace.id as number;
    await s.agent
      .post(`/api/v1/workspaces/${wsId}/invitations`)
      .set("X-CSRF-Token", s.token)
      .send({ email: "invitee@example.com", role: "viewer" })
      .expect(201);
    const row = db.q.prepare(`SELECT id, token FROM invitations WHERE workspace_id = ?`).get(wsId) as { id: number; token: string };
    expect(row.token).toMatch(/^[0-9a-f]{64}$/); // hashed, never the bearer token
    await s.agent.post(`/api/v1/workspaces/${wsId}/invitations/${row.id}/resend`).set("X-CSRF-Token", s.token).expect(200);
    const row2 = db.q.prepare(`SELECT token FROM invitations WHERE id = ?`).get(row.id) as { token: string };
    expect(row2.token).not.toBe(row.token); // resend rotates the token
  });

  it("creates a workspace and lists memberships", async () => {
    const s = await newSession();
    await registerVerifiedLogin(s, uniqueEmail("ws"));
    const created = await s.agent.post("/api/v1/workspaces").set("X-CSRF-Token", s.token).send({ name: "Equipo Marketing" });
    expect(created.status).toBe(201);
    const list = await s.agent.get("/api/v1/workspaces");
    expect(list.status).toBe(200);
    expect(list.body.workspaces.length).toBeGreaterThanOrEqual(2);
  });
});

describe("Legacy token migration (upgrade path)", () => {
  it("hashes plaintext email tokens so old verification links keep working", async () => {
    const s = await newSession();
    const email = uniqueEmail("legacy-mail");
    await s.agent
      .post("/api/v1/auth/register")
      .set("X-CSRF-Token", s.token)
      .send({ name: "Legacy User", email, password: PASSWORD })
      .expect(201);
    const user = db.q.prepare("SELECT id FROM users WHERE email = ?").get(email) as { id: number };
    // Simulate a row written by the pre-hashing code: plaintext bearer token.
    const plain = "legacy-verify-token-" + userSeq + "-" + Date.now();
    db.q.prepare("INSERT INTO email_tokens (id, user_id, kind, expires_at) VALUES (?, ?, 'verify', ?)").run(
      plain,
      user.id,
      new Date(Date.now() + 3600_000).toISOString(),
    );

    migrate();

    expect(db.q.prepare("SELECT id FROM email_tokens WHERE id = ?").get(sha256Hex(plain))).toBeDefined();
    expect(db.q.prepare("SELECT id FROM email_tokens WHERE id = ?").get(plain)).toBeUndefined();

    // The link that was already emailed still verifies end-to-end.
    const res = await s.agent.post("/api/v1/auth/verify-email").set("X-CSRF-Token", s.token).send({ token: plain });
    expect(res.status).toBe(200);
  });

  it("hashes plaintext invitation tokens so old invite links keep working", async () => {
    const owner = await newSession();
    await registerVerifiedLogin(owner, uniqueEmail("legacy-owner"));
    const ws = await owner.agent.post("/api/v1/workspaces").set("X-CSRF-Token", owner.token).send({ name: "Legacy WS" }).expect(201);
    const wsId = ws.body.workspace.id as number;
    const inviteEmail = uniqueEmail("legacy-invitee");
    await owner.agent
      .post("/api/v1/workspaces/" + wsId + "/invitations")
      .set("X-CSRF-Token", owner.token)
      .send({ email: inviteEmail, role: "viewer" })
      .expect(201);

    const plain = "legacy-invite-token-" + userSeq + "-" + Date.now();
    db.q.prepare("UPDATE invitations SET token = ? WHERE workspace_id = ?").run(plain, wsId);

    migrate();

    expect(db.q.prepare("SELECT token FROM invitations WHERE token = ?").get(sha256Hex(plain))).toBeDefined();
    expect(db.q.prepare("SELECT token FROM invitations WHERE token = ?").get(plain)).toBeUndefined();

    // The emailed link still works: the invitee registers and accepts with the
    // old plaintext token.
    const invitee = await newSession();
    await invitee.agent
      .post("/api/v1/auth/register")
      .set("X-CSRF-Token", invitee.token)
      .send({ name: "Invitee", email: inviteEmail, password: PASSWORD })
      .expect(201);
    // Registration no longer creates a session (anti-enumeration change), so
    // the invitee logs in before accepting.
    await invitee.agent.post("/api/v1/auth/login").set("X-CSRF-Token", invitee.token).send({ email: inviteEmail, password: PASSWORD }).expect(200);
    const accept = await invitee.agent
      .post("/api/v1/workspaces/invitations/accept")
      .set("X-CSRF-Token", invitee.token)
      .send({ token: plain });
    expect(accept.status).toBe(200);
  });
});

describe("Housekeeping scheduler", () => {
  const daysAgo = (d: number) => new Date(Date.now() - d * 86400_000).toISOString();
  const daysAhead = (d: number) => new Date(Date.now() + d * 86400_000).toISOString();

  function insertUser(): number {
    const info = db.q
      .prepare("INSERT INTO users (email, name, password_hash) VALUES (?, ?, ?)")
      .run(uniqueEmail("hk"), "HK User", "x");
    return Number(info.lastInsertRowid);
  }

  const opts = {
    analyticsRetentionDays: 180,
    sessionPurgeDays: 30,
    tokenPurgeDays: 7,
    deliveryPurgeDays: 90,
    auditPurgeDays: 365,
    purgeBatch: 1000,
    heavyIntervalMs: 0,
  };

  it("purges revoked sessions by revoked_at, not expires_at", async () => {
    const { runPurges } = await import("../src/housekeeping.js");
    const uid = insertUser();
    const mk = (id: string, revoked: string | null, expires: string) =>
      db.q
        .prepare(
          "INSERT INTO sessions (id, user_id, expires_at, revoked_at, created_at, last_used_at) VALUES (?, ?, ?, ?, ?, ?)",
        )
        .run(id, uid, expires, revoked, daysAgo(40), daysAgo(40));
    mk("s-revoked-old", daysAgo(31), daysAhead(10)); // old query kept this: expires_at in the future
    mk("s-expired-old", null, daysAgo(31));
    mk("s-revoked-recent", daysAgo(5), daysAhead(10));
    mk("s-active", null, daysAhead(10));

    runPurges(opts);

    const rows = db.q.prepare("SELECT id FROM sessions WHERE user_id = ?").all(uid) as Array<{ id: string }>;
    expect(new Set(rows.map((r) => r.id))).toEqual(new Set(["s-revoked-recent", "s-active"]));
  });

  it("purges deliveries and audit events in bounded batches", async () => {
    const { runPurges } = await import("../src/housekeeping.js");
    const uid = insertUser();
    const wsId = Number(
      db.q.prepare("INSERT INTO workspaces (name, slug, owner_user_id) VALUES ('HK', ?, ?)").run("hk-ws-" + userSeq, uid)
        .lastInsertRowid,
    );
    const whId = Number(
      db.q
        .prepare("INSERT INTO webhooks (workspace_id, url, secret, events) VALUES (?, 'https://example.com/h', 'sec', '[]')")
        .run(wsId).lastInsertRowid,
    );
    for (let i = 0; i < 25; i++) {
      db.q
        .prepare(
          "INSERT INTO webhook_deliveries (webhook_id, event, event_id, payload, status, delivered_at) VALUES (?, 'link.created', ?, '{}', 'success', ?)",
        )
        .run(whId, "ev-" + i, daysAgo(100));
      db.q.prepare("INSERT INTO audit_events (user_id, action, created_at) VALUES (?, 'test.action', ?)").run(uid, daysAgo(400));
    }

    runPurges({ ...opts, purgeBatch: 10 });

    expect((db.q.prepare("SELECT COUNT(*) AS c FROM webhook_deliveries").get() as { c: number }).c).toBe(0);
    // Only the rows this test inserted (400 days old) must be gone; audit rows
    // written by earlier tests have recent timestamps and stay.
    expect((db.q.prepare("SELECT COUNT(*) AS c FROM audit_events WHERE user_id = ?").get(uid) as { c: number }).c).toBe(0);
  });

  it("runs light jobs on every tick but throttles the heavy purge pass", async () => {
    const { runHousekeeping, runPurges } = await import("../src/housekeeping.js");
    const uid = insertUser();
    const wsId = Number(
      db.q.prepare("INSERT INTO workspaces (name, slug, owner_user_id) VALUES ('HKS', ?, ?)").run("hks-ws-" + userSeq, uid)
        .lastInsertRowid,
    );
    const linkId = Number(
      db.q
        .prepare(
          "INSERT INTO links (workspace_id, created_by, alias, destination, state, scheduled_at) VALUES (?, ?, ?, 'https://example.com/', 'scheduled', ?)",
        )
        .run(wsId, uid, "hk-sched-" + userSeq, daysAgo(1)).lastInsertRowid,
    );
    const whId = Number(
      db.q
        .prepare("INSERT INTO webhooks (workspace_id, url, secret, events) VALUES (?, 'https://example.com/h', 'sec', '[]')")
        .run(wsId).lastInsertRowid,
    );

    const throttled = { ...opts, heavyIntervalMs: 60_000 };
    runHousekeeping(throttled); // first call: light jobs + one heavy pass
    expect((db.q.prepare("SELECT state FROM links WHERE id = ?").get(linkId) as { state: string }).state).toBe("active");

    // Rows inserted after the heavy pass must survive the next tick (throttle).
    for (let i = 0; i < 5; i++) {
      db.q
        .prepare(
          "INSERT INTO webhook_deliveries (webhook_id, event, event_id, payload, status, delivered_at) VALUES (?, 'link.created', ?, '{}', 'success', ?)",
        )
        .run(whId, "th-" + i, daysAgo(100));
    }
    runHousekeeping(throttled); // heavy pass is throttled
    expect((db.q.prepare("SELECT COUNT(*) AS c FROM webhook_deliveries WHERE webhook_id = ?").get(whId) as { c: number }).c).toBe(5);

    // A direct purge call still cleans them up.
    runPurges(opts);
    expect((db.q.prepare("SELECT COUNT(*) AS c FROM webhook_deliveries WHERE webhook_id = ?").get(whId) as { c: number }).c).toBe(0);
  });
});

describe("API token hardening", () => {
  it("throttles api_tokens.last_used_at to one write per minute", async () => {
    const s = await newSession();
    await registerVerifiedLogin(s, uniqueEmail("tokthr"));
    const created = await s.agent
      .post("/api/v1/tokens")
      .set("X-CSRF-Token", s.token)
      .send({ name: "Throttle", scopes: ["analytics:read"] })
      .expect(201);
    const plain = created.body.plainToken as string;
    const tokenId = created.body.token.id as number;
    const lastUsed = () =>
      (db.q.prepare("SELECT last_used_at FROM api_tokens WHERE id = ?").get(tokenId) as { last_used_at: string | null })
        .last_used_at;

    const first = await request(app).get("/api/v1/analytics/public/overview").set("Authorization", "Bearer " + plain);
    expect(first.status).toBe(200);
    const t1 = lastUsed();
    expect(t1).not.toBeNull();

    const second = await request(app).get("/api/v1/analytics/public/overview").set("Authorization", "Bearer " + plain);
    expect(second.status).toBe(200);
    expect(lastUsed()).toBe(t1); // no write on the second request

    db.q.prepare("UPDATE api_tokens SET last_used_at = ? WHERE id = ?").run(
      new Date(Date.now() - 120_000).toISOString(),
      tokenId,
    );
    await request(app).get("/api/v1/analytics/public/overview").set("Authorization", "Bearer " + plain).expect(200);
    expect(lastUsed()).not.toBe(t1);
  });
});

describe("Config hardening", () => {
  it("rejects invalid booleans and integers instead of misinterpreting them", async () => {
    const { bool, intEnv } = await import("../src/config.js");
    // Case-insensitive: "TRUE" normalizes to "true" and is valid; a typo is not.
    expect(bool("TRUE", false)).toBe(true);
    expect(bool(" 1 ", false)).toBe(true);
    expect(() => bool("ture", false)).toThrow();
    expect(() => bool("yes please", false)).toThrow();
    expect(bool("true", false)).toBe(true);
    expect(bool("YES", false)).toBe(true);
    expect(bool("0", true)).toBe(false);
    expect(bool(undefined, true)).toBe(true);

    process.env.UVH_TEST_INT = "hola";
    expect(() => intEnv("UVH_TEST_INT", 30)).toThrow();
    process.env.UVH_TEST_INT = "-1";
    expect(() => intEnv("UVH_TEST_INT", 30)).toThrow();
    process.env.UVH_TEST_INT = "99999999999999999999";
    expect(() => intEnv("UVH_TEST_INT", 30)).toThrow();
    process.env.UVH_TEST_INT = "0";
    expect(() => intEnv("UVH_TEST_INT", 30, { min: 1 })).toThrow();
    process.env.UVH_TEST_INT = "30";
    expect(intEnv("UVH_TEST_INT", 7)).toBe(30);
    delete process.env.UVH_TEST_INT;
    expect(intEnv("UVH_TEST_INT", 30, { min: 1 })).toBe(30);
  });
});
