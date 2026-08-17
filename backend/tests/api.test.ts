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

const { createApp } = await import("../src/app.js");
const { migrate } = await import("../src/db.js");
const db = await import("../src/db.js");
const { assertSafeHost, assertSafeUrl } = await import("../src/util/ssrf.js");

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
  const tok = db.q.prepare(`SELECT id FROM email_tokens WHERE user_id = ? AND kind = 'verify' ORDER BY created_at DESC LIMIT 1`).get(user.id) as { id: string };
  await s.agent.post("/api/v1/auth/verify-email").set("X-CSRF-Token", s.token).send({ token: tok.id }).expect(200);
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

  it("rejects duplicate emails", async () => {
    const s = await newSession();
    await s.agent
      .post("/api/v1/auth/register")
      .set("X-CSRF-Token", s.token)
      .send({ name: "Alice Dup", email: "dup@example.com", password: PASSWORD })
      .expect(201);
    const res = await s.agent
      .post("/api/v1/auth/register")
      .set("X-CSRF-Token", s.token)
      .send({ name: "Bob Dup", email: "dup@example.com", password: PASSWORD });
    expect(res.status).toBe(409);
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
    const tok = db.q.prepare(`SELECT id FROM email_tokens WHERE user_id = ? AND kind = 'reset' LIMIT 1`).get(user.id) as { id: string };
    await s.agent.post("/api/v1/auth/reset-password").set("X-CSRF-Token", s.token).send({ token: tok.id, password: "new-password-789" }).expect(200);
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

  it("serves an unavailable page for paused links", async () => {
    const res = await request(app).get("/r/pausable").set("Host", "uvh.es");
    expect(res.status).toBe(404);
    expect(res.text).toContain("pausa");
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
