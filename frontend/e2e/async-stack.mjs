import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Asynchronous end-to-end harness.
 *
 * The browser suite stops at the HTTP response. Everything a request puts on
 * a queue is therefore unverified there: the suite would pass with every
 * worker stopped. This harness runs the real topology (one worker per queue
 * class plus the scheduler) against deterministic providers and follows each
 * chain to its final durable state:
 *
 *   HTTP -> transaction -> commit -> queue -> correct worker -> retry -> end
 *
 * Retries are driven by the real scheduler tick, exactly as in production.
 * Only the retry *schedule* is advanced (see async-inspect.php), because the
 * first outbox backoff is 60 real seconds.
 */

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..");
const project = "uvh-async-e2e";
const composeFile = "docker-compose.async-e2e.yml";
const compose = ["compose", "-p", project, "-f", composeFile];

const backendPort = process.env.UVH_ASYNC_BACKEND_PORT ?? "8011";
const backend = `http://127.0.0.1:${backendPort}`;
const control = {
  webhook: `http://127.0.0.1:${process.env.UVH_ASYNC_WEBHOOK_CONTROL_PORT ?? "8090"}`,
  dns: `http://127.0.0.1:${process.env.UVH_ASYNC_DNS_CONTROL_PORT ?? "8091"}`,
  mail: `http://127.0.0.1:${process.env.UVH_ASYNC_MAIL_CONTROL_PORT ?? "8092"}`,
};
const schedulerDeadlineMs = Number(process.env.UVH_ASYNC_SCHEDULER_DEADLINE_MS ?? 150_000);

const password = "Glass-Falcon_Orbit-742!";
const csrfToken = "uvh-async-e2e-csrf";
const fixtureSecret = "fixture-secret-0123456789";
const hookUrl = "http://11.0.0.10:8080/hook";

const results = [];

function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  return Boolean(ok);
}

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function until(label, probe, { deadlineMs = 60_000, intervalMs = 400 } = {}) {
  const startedAt = Date.now();
  let last = { reason: "no attempt" };
  while (Date.now() - startedAt < deadlineMs) {
    try {
      const value = await probe();
      if (value !== undefined && value !== null && value !== false) return value;
      last = { reason: value === undefined ? "undefined" : String(value) };
    } catch (error) {
      last = { reason: error instanceof Error ? error.message : String(error) };
    }
    await sleep(intervalMs);
  }
  throw new Error(`${label} did not settle within ${deadlineMs}ms (last: ${last.reason})`);
}

/**
 * Windows reports a failed process *creation* as 0xC0000142 (3221225794),
 * with no output at all. Docker Desktop does this intermittently under memory
 * pressure — the CLI never ran, so retrying is not re-executing anything. A
 * real command failure is different: the CLI ran and returned output plus a
 * status, and those are never retried.
 */
const SPAWN_FAILURE_STATUS = 3221225794; // 0xC0000142 on Windows.

/** Blocking sleep: the callers are synchronous by construction. */
const sleepSync = (ms) => Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);

function docker(args, { capture = false } = {}) {
  const attempt = () =>
    execFileSync("docker", [...compose, ...args], {
      cwd: repositoryRoot,
      encoding: "utf8",
      stdio: capture ? ["ignore", "pipe", "pipe"] : "inherit",
      timeout: 900_000,
    });

  // Docker Desktop needs time to settle before it can initialise a new CLI
  // process again, so the waits grow instead of hammering it.
  const backoffMs = [5_000, 15_000, 30_000];

  for (let tries = 0; ; tries += 1) {
    try {
      return attempt();
    } catch (error) {
      // The status is the discriminator, not the output: with an inherited
      // stdio the output arrays are empty on a real non-zero exit too.
      if (error?.status !== SPAWN_FAILURE_STATUS || tries >= backoffMs.length) throw error;
      console.error(
        `docker ${args.slice(0, 2).join(" ")} could not be spawned; retrying in ${backoffMs[tries] / 1000}s (${tries + 1}/${backoffMs.length})`,
      );
      sleepSync(backoffMs[tries]);
    }
  }
}

function inspect(...args) {
  const stdout = docker(["exec", "-T", "app", "php", "tests/E2E/async-inspect.php", ...args], { capture: true });
  return JSON.parse(stdout.trim());
}

async function api(method, requestPath, { json, session, workspaceId, redirect = "follow" } = {}) {
  const headers = {
    Accept: "application/json",
    "X-CSRF-Token": csrfToken,
    Cookie: `uvh_csrf=${csrfToken}${session ? `; uvh_async_session=${session}` : ""}`,
  };
  if (json !== undefined) headers["Content-Type"] = "application/json";
  if (workspaceId) headers["X-Workspace-Id"] = String(workspaceId);
  const response = await fetch(backend + requestPath, {
    method,
    headers,
    redirect,
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const raw = await response.text();
  const body = (() => {
    try {
      return raw === "" ? null : JSON.parse(raw);
    } catch {
      return raw;
    }
  })();
  const cookies = typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [];
  const sessionCookie = cookies
    .map((value) => value.split(";")[0])
    .find((value) => value.startsWith("uvh_async_session="));
  return {
    status: response.status,
    body,
    raw,
    headers: response.headers,
    session: sessionCookie ? sessionCookie.split("=").slice(1).join("=") : undefined,
  };
}

async function fixture(base, requestPath, { method = "GET", json } = {}) {
  const response = await fetch(base + requestPath, {
    method,
    headers: json === undefined ? {} : { "Content-Type": "application/json" },
    body: json === undefined ? undefined : JSON.stringify(json),
  });
  const raw = await response.text();
  const body = (() => {
    try {
      return raw === "" ? null : JSON.parse(raw);
    } catch {
      return raw;
    }
  })();
  return { status: response.status, body, raw };
}

const setState = (base, json) => fixture(base, "/__state", { method: "POST", json });

/** Undo quoted-printable and base64 part encoding, then list every URL. */
function readableMessage(raw) {
  const unfolded = raw.replace(/=\r?\n/g, "");
  let text = unfolded;
  if (/Content-Transfer-Encoding:\s*base64/i.test(unfolded)) {
    text = unfolded.replace(/[A-Za-z0-9+/=\r\n]{60,}/g, (chunk) => {
      try {
        return Buffer.from(chunk.replace(/\s/g, ""), "base64").toString("utf8");
      } catch {
        return chunk;
      }
    });
  }
  text = text.replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(Number.parseInt(hex, 16)));
  return text;
}

/**
 * Extract a bearer from a message. Both the decoded and the raw form are
 * tried: a body that is not quoted-printable can contain a literal `=a3`, and
 * the transport is free to choose the encoding.
 */
/** First 12 hex characters of the stored hash for a bearer. */
function hashToken(token) {
  return crypto.createHash("sha256").update(token).digest("hex").slice(0, 12);
}

function tokenFromUrl(raw) {
  // Every bearer in this suite is a 32-byte base64url value (43 characters).
  // Prefer the exact length so a quoted-printable artefact cannot be glued to
  // the front of the token; fall back to a loose match for diagnostics.
  const patterns = [
    /[#?&]token=([A-Za-z0-9_-]{43})(?![A-Za-z0-9_-])/,
    /[#?&]token=([A-Za-z0-9_-]{20,})/,
  ];
  const candidates = [readableMessage(raw), raw.replace(/=\r?\n/g, "").replace(/=3D/gi, "=")];
  for (const candidate of candidates) {
    for (const pattern of patterns) {
      const match = candidate.match(pattern);
      if (match) return match[1];
    }
  }
  return null;
}

/** Every message the SMTP provider accepted for a recipient, oldest first. */
async function messagesFor(email) {
  const listing = await fixture(control.mail, "/__files?dir=messages");
  const files = Array.isArray(listing.body?.files) ? listing.body.files : [];
  const matches = [];
  for (const name of files) {
    const file = await fixture(control.mail, `/__file?name=messages/${encodeURIComponent(name)}`);
    if (file.raw.toLowerCase().includes(email.toLowerCase())) {
      matches.push({ name, raw: file.raw });
    }
  }
  return matches;
}

/** The one accepted message matching a predicate, or undefined while absent. */
async function messageMatching(email, predicate) {
  const matches = await messagesFor(email);
  return matches.find((message) => predicate(readableMessage(message.raw), message));
}

async function attemptsFor(email) {
  const file = await fixture(control.mail, "/__file?name=attempts.jsonl");
  if (typeof file.raw !== "string" || file.raw.trim() === "") return [];
  return file.raw
    .trim()
    .split("\n")
    .map((line) => JSON.parse(line))
    .filter((entry) => Array.isArray(entry.rcpt) && entry.rcpt.some((value) => String(value).toLowerCase() === email.toLowerCase()));
}

function uniqueEmail(prefix) {
  return `${prefix}-${Date.now()}-${Math.floor(Math.random() * 10_000)}@example.test`;
}

async function register(email, name = "Persona Async") {
  return api("POST", "/api/v1/auth/register", {
    json: {
      name,
      email,
      password,
      captchaToken: `uvh-e2e-pass-${crypto.randomBytes(8).toString("hex")}`,
      acceptTerms: true,
      termsVersion: "2026-08-30",
      privacyVersion: "2026-08-30",
    },
  });
}

async function login(email) {
  const response = await api("POST", "/api/v1/auth/login", {
    json: { email, password, captchaToken: `uvh-e2e-pass-${crypto.randomBytes(8).toString("hex")}` },
  });
  if (response.status !== 200 || !response.session) {
    throw new Error(`login failed: ${response.status} ${response.raw.slice(0, 200)}`);
  }
  return response.session;
}

async function workspaces(session) {
  const response = await api("GET", "/api/v1/workspaces", { session });
  const list = response.body?.workspaces ?? [];
  if (list.length === 0) throw new Error("the registered account has no workspace");
  return list;
}

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/** Registration -> outbox -> mail worker -> SMTP -> the link actually works. */
async function mailChain() {
  const email = uniqueEmail("async-mail");
  const registered = await register(email);
  check("mail: registration admitted", registered.status === 200 || registered.status === 201, `HTTP ${registered.status}`);

  const message = await until(
    "mail: provider receives the verification message",
    () => messageMatching(email, (text) => /verificar|verify/i.test(text)),
    { deadlineMs: 45_000 },
  ).catch((error) => {
    check("mail: provider receives the verification message", false, error.message);
    return null;
  });
  if (!message) return null;

  const token = tokenFromUrl(message.raw);
  check("mail: accepted message carries a verification bearer", Boolean(token));

  const verified = await api("POST", "/api/v1/auth/verify-email", { json: { token } });
  check("mail: bearer from the provider verifies the account", verified.status === 200, `HTTP ${verified.status}`);

  // Delivered rows erase their envelope, so this read is addressed by kind
  // rather than by recipient; the stack starts empty and only this scenario
  // creates a verification row at this point.
  const rows = inspect("mail-kind", "verification");
  check("mail: exactly one outbox row was created", rows.length === 1, `rows=${rows.length}`);
  check("mail: outbox row is sent by a worker", rows[0]?.status === "sent" && Boolean(rows[0]?.sent_at), `status=${rows[0]?.status}`);
  check("mail: exactly one provider attempt was needed", rows[0]?.attempts === 1, `attempts=${rows[0]?.attempts}`);

  const session = await login(email);
  const list = await workspaces(session);
  return { email, session, workspaceId: list[0].id };
}

/** 302 -> analytics worker -> click_event -> rollup, with the counter immediate. */
async function analyticsChain({ session, workspaceId }) {
  const alias = `async-${crypto.randomBytes(4).toString("hex")}`;
  const created = await api("POST", "/api/v1/links", {
    session,
    workspaceId,
    json: { destination: "https://example.org/async-analytics", alias },
  });
  const linkId = created.body?.link?.id;
  check("analytics: link created through the panel API", created.status === 201 && Boolean(linkId), `HTTP ${created.status}`);

  const redirect = await api("GET", `/r/${alias}`, { redirect: "manual" });
  check("analytics: redirect answers 302", redirect.status === 302, `HTTP ${redirect.status}`);

  const settled = await until("analytics: analytics worker persists the click", () => {
    const state = inspect("analytics", String(linkId));
    return state.click_events >= 1 && state.rollup_clicks >= 1 ? state : undefined;
  }, { deadlineMs: 30_000 }).catch((error) => {
    check("analytics: analytics worker persists the click", false, error.message);
    return null;
  });
  if (!settled) return;
  check("analytics: click event and daily rollup agree", settled.click_events === settled.rollup_clicks, JSON.stringify(settled));
  check("analytics: visible counter is exact and immediate", settled.click_count === 1, `click_count=${settled.click_count}`);
}

/** Add -> verify -> domains worker -> controlled resolver -> state transition. */
async function domainChain({ session, workspaceId }) {
  await setState(control.dns, {});
  const added = await api("POST", "/api/v1/domains", { session, workspaceId, json: { domain: "alfa.e2e.uvh" } });
  const domainId = added.body?.domain?.id;
  const token = added.body?.domain?.verificationToken;
  check("dns: domain admitted for verification", added.status === 201 && Boolean(domainId && token), `HTTP ${added.status}`);

  await setState(control.dns, {
    txt: { "_uvh-verification.alfa.e2e.uvh": token },
    cname: { "alfa.e2e.uvh": "edge.e2e.uvh" },
  });
  const queued = await api("POST", `/api/v1/domains/${domainId}/verify`, { session, workspaceId });
  check("dns: verification request accepted", queued.status === 200 || queued.status === 202, `HTTP ${queued.status}`);

  const verified = await until("dns: domains worker reaches a verified state", () => {
    const state = inspect("domain", String(domainId));
    return state.state === "verified" ? state : undefined;
  }, { deadlineMs: 30_000 }).catch((error) => {
    check("dns: domains worker reaches a verified state", false, error.message);
    return null;
  });
  if (verified) {
    check(
      "dns: ownership and routing were both proven",
      Boolean(verified.ownership_verified_at) && Boolean(verified.routing_verified_at),
      JSON.stringify({ ownership: verified.ownership_verified_at, routing: verified.routing_verified_at }),
    );
  }

  const missing = await api("POST", "/api/v1/domains", { session, workspaceId, json: { domain: "beta.e2e.uvh" } });
  const missingId = missing.body?.domain?.id;
  await api("POST", `/api/v1/domains/${missingId}/verify`, { session, workspaceId });
  const failed = await until("dns: an unproven domain fails closed", () => {
    const state = inspect("domain", String(missingId));
    return state.state === "error" ? state : undefined;
  }, { deadlineMs: 30_000 }).catch((error) => {
    check("dns: an unproven domain fails closed", false, error.message);
    return null;
  });
  if (failed) {
    check("dns: the failure names the missing records", failed.dns_error === "ownership_and_routing_missing", `dns_error=${failed.dns_error}`);
  }
}

/** Request -> exports worker -> artifact -> download -> acknowledge -> expired. */
async function exportChain({ email, session, workspaceId }) {
  const requested = await api("POST", "/api/v1/auth/data-export", { session, workspaceId, json: { password } });
  check("export: request admitted with step-up", requested.status === 200 || requested.status === 202, `HTTP ${requested.status}`);
  if (requested.status !== 200 && requested.status !== 202) return;

  const requestedRow = inspect("export-latest");

  // The bearer is matched against the stored hash rather than against the URL
  // path or the order in which messages arrived: the provider stores what it
  // received, and only the hash proves it is the message this request meant.
  const confirmation = await until("export: confirmation message reaches the provider", async () => {
    for (const message of await messagesFor(email)) {
      const token = tokenFromUrl(message.raw);
      if (token && hashToken(token) === requestedRow.confirmation_hash) return { message, token };
    }
    return undefined;
  }, { deadlineMs: 45_000 }).catch((error) => {
    const outbox = inspect("mail-kind", "data_export_confirmation");
    check("export: confirmation message reaches the provider", false, `${error.message} | request=${JSON.stringify(requestedRow)} outbox=${JSON.stringify(outbox)}`);
    return null;
  });
  if (!confirmation) return;

  const confirmToken = confirmation.token;
  const confirmed = await api("POST", "/api/v1/auth/data-export/confirm", { json: { token: confirmToken } });
  check("export: bearer from the provider confirms the request", confirmed.status === 200, `HTTP ${confirmed.status}`);

  const ready = await until("export: exports worker produces the artifact", () => {
    const state = inspect("export-latest");
    return state.status === "ready" && state.artifact ? state : undefined;
  }, { deadlineMs: 60_000 }).catch((error) => {
    check("export: exports worker produces the artifact", false, `${error.message} | ${JSON.stringify(inspect("export-latest"))}`);
    return null;
  });
  if (!ready) return;

  // Waiting for the second bearer here also proves the worker's own mail
  // admission reached the provider.
  const readyToken = await until("export: ready message reaches the provider", async () => {
    for (const message of await messagesFor(email)) {
      const token = tokenFromUrl(message.raw);
      if (token && hashToken(token) === ready.download_hash) return token;
    }
    return undefined;
  }, { deadlineMs: 45_000 }).catch((error) => {
    check("export: ready message reaches the provider", false, `${error.message} | ${JSON.stringify(ready)}`);
    return null;
  });
  check("export: ready message carries a different bearer", Boolean(readyToken) && readyToken !== confirmToken);
  if (!readyToken) return;

  const downloaded = await api("POST", "/api/v1/auth/data-export/download", { json: { token: readyToken } });
  check("export: artifact downloads once", downloaded.status === 200 && downloaded.raw.length > 0, `HTTP ${downloaded.status} bytes=${downloaded.raw.length}`);

  const consumed = await api("POST", "/api/v1/auth/data-export/download/acknowledge", { json: { token: readyToken } });
  check("export: download acknowledged", consumed.status === 200, `HTTP ${consumed.status}`);
  const after = inspect("export-latest");
  check("export: artifact is retired after consumption", after.status === "downloaded" && after.artifact === null, JSON.stringify(after));
}

/** Webhook event -> webhooks worker -> 500 -> scheduled retry -> 200 -> delivered. */
async function webhookChain({ session, workspaceId }) {
  await fixture(control.webhook, "/__reset", { method: "POST" });
  const created = await api("POST", "/api/v1/webhooks", {
    session,
    workspaceId,
    json: { url: hookUrl, events: ["link.created"], secret: fixtureSecret },
  });
  const webhookId = created.body?.webhook?.id;
  const secret = created.body?.secret ?? fixtureSecret;
  check("webhook: subscription created through the panel API", created.status === 201 && Boolean(webhookId), `HTTP ${created.status}`);

  await setState(control.webhook, { failures: 1, status: 200 });

  const alias = `hook-${crypto.randomBytes(4).toString("hex")}`;
  const link = await api("POST", "/api/v1/links", {
    session,
    workspaceId,
    json: { destination: "https://example.org/async-webhook", alias },
  });
  check("webhook: business event committed", link.status === 201, `HTTP ${link.status}`);

  // The scheduler's housekeeping is what re-publishes a refused delivery, and
  // it can do so seconds after the first refusal. Reading the row costs a full
  // application boot (over ten seconds on a bind-mounted workspace), which is
  // longer than that window, so the row would be observed as already retried or
  // already delivered and the intermediate state would never be seen. Holding
  // the re-publisher still — the same reason a worker is paused in the
  // queue-depth drill — makes the read deterministic without touching the
  // path under test: the row is still written by the worker, and the retry is
  // still driven by the real scheduler once it resumes.
  const scheduler = runningService("scheduler");
  if (scheduler !== null) docker(["pause", scheduler]);
  let attempted;
  try {
    attempted = await until("webhook: worker attempts the delivery and records the failure", () => {
      const rows = inspect("webhook", String(webhookId));
      const row = rows[0];
      if (row && row.attempts >= 1 && row.status === "pending") return row;
      // Surfaces the state that was actually in the table when it does not
      // match, instead of the opaque `undefined` a bare predicate produces.
      throw new Error(JSON.stringify(rows));
    }, { deadlineMs: 30_000 }).catch((error) => {
      check("webhook: worker attempts the delivery and records the failure", false, error.message);
      return null;
    });
  } finally {
    if (scheduler !== null) docker(["unpause", scheduler]);
  }
  if (!attempted) return null;
  check("webhook: provider failure schedules a retry instead of dropping the event", Boolean(attempted.next_attempt_at), `last_error=${attempted.last_error}`);

  const received = await fixture(control.webhook, "/__received");
  const first = Array.isArray(received.body) ? received.body[0] : null;
  check("webhook: first attempt was refused by the receiver", first?.responded === 500, `responded=${first?.responded}`);

  return { webhookId, secret };
}

/** Registration whose provider rejects the first attempt. */
async function mailRetryChain() {
  const email = uniqueEmail("async-retry");
  await setState(control.mail, { mode: "accept", rejectNext: 1 });
  const registered = await register(email, "Persona Reintento");
  check("mail retry: registration admitted", registered.status === 200 || registered.status === 201, `HTTP ${registered.status}`);

  const pending = await until("mail retry: outbox keeps the message after a provider failure", () => {
    const rows = inspect("mail", email);
    const row = rows[0];
    return row && row.attempts >= 1 && row.status === "pending" ? row : undefined;
  }, { deadlineMs: 30_000 }).catch((error) => {
    check("mail retry: outbox keeps the message after a provider failure", false, error.message);
    return null;
  });
  if (!pending) return null;

  check("mail retry: the failure is recorded without losing the envelope", pending.last_error === "transport_unavailable", `last_error=${pending.last_error}`);
  return { email, id: pending.id };
}

/**
 * Name of a service whose container is running, or null when it is absent.
 *
 * `compose pause`/`unpause` address services, not container ids: passing the id
 * back fails with "no such service". The service name is therefore what gets
 * returned, and the id is only used to prove the container exists.
 */
function runningService(service) {
  return docker(["ps", "-q", service], { capture: true }).trim() === "" ? null : service;
}

/**
 * Depth must describe real pending work.
 *
 * On the database driver it was read from the `jobs` table, which is the same
 * table the workers consume. On Redis that table stays empty forever, so a
 * stopped worker would have been reported as an idle queue. Pausing a consumer
 * is the only way to hold work still long enough to read it, and it drives both
 * halves of the claim: the depth grows while the worker is stopped, and the
 * same pending job is delivered once it resumes.
 */
async function queueDepthDrill() {
  const service = runningService("queue-mail");
  if (!check("queue depth: the mail worker is running", service !== null)) return;

  const email = uniqueEmail("async-visibility");
  docker(["pause", service]);
  try {
    const registered = await register(email);
    check(
      "queue depth: registration is accepted with the mail worker stopped",
      registered.status === 200 || registered.status === 201,
      `HTTP ${registered.status}`,
    );

    const visible = await until(
      "queue depth: pending mail is visible while a worker is stopped",
      () => {
        const mail = inspect("queue").find((row) => row.queue === "mail");
        return mail && mail.pending > 0 ? mail : undefined;
      },
      { deadlineMs: 30_000 },
    ).catch((error) => {
      check("queue depth: pending mail is visible while a worker is stopped", false, error.message);
      return null;
    });
    if (visible) {
      check("queue depth: the broker reports the pending job", visible.pending >= 1, `pending=${visible.pending}`);
    }
  } finally {
    docker(["unpause", service]);
  }

  // Nothing was lost by stopping the consumer: the same job is delivered as
  // soon as it runs again.
  const delivered = await until(
    "queue depth: the resumed worker delivers the held message",
    async () => ((await messageMatching(email, (text) => /verificar|verify/i.test(text))) ? true : undefined),
    { deadlineMs: 60_000 },
  ).catch((error) => {
    check("queue depth: the resumed worker delivers the held message", false, error.message);
    return null;
  });
  if (delivered) check("queue depth: the held job survived the pause", true);
  const drained = inspect("queue").find((row) => row.queue === "mail");
  check("queue depth: the mail queue returns to zero", drained?.pending === 0, `pending=${drained?.pending}`);
}

/**
 * Losing the broker must not lose work.
 *
 * The outbox row is the source of truth and the queue only carries the
 * publication, so a broker that forgets its data has to be recoverable: the
 * scheduler's housekeeping re-publishes stale rows and the worker delivers
 * them. This is the property that makes Redis safe to run as a broker, and it
 * cannot be exercised on the database driver, where the queue and the source of
 * truth are the same table and a flush would destroy the work itself.
 */
async function brokerLossDrill() {
  const service = runningService("queue-mail");
  if (!check("broker loss: the mail worker is running", service !== null)) return;

  const email = uniqueEmail("async-broker-loss");
  docker(["pause", service]);
  let queued;
  try {
    const registered = await register(email);
    check(
      "broker loss: registration is accepted before the broker is lost",
      registered.status === 200 || registered.status === 201,
      `HTTP ${registered.status}`,
    );

    queued = await until(
      "broker loss: the outbox row is published and waiting",
      () => {
        const rows = inspect("mail", email);
        return rows[0]?.status === "queued" ? rows[0] : undefined;
      },
      { deadlineMs: 30_000 },
    ).catch((error) => {
      check("broker loss: the outbox row is published and waiting", false, error.message);
      return null;
    });

    // The broker is emptied while the consumer is still stopped. Emptying it
    // after resuming would race the worker — a mail delivery takes long enough
    // that the flush would simply find nothing, and the loss being tested would
    // never happen.
    if (queued) {
      const flushed = inspect("broker-flush");
      check("broker loss: the queued job is really gone from the broker", flushed.flushed > 0, JSON.stringify(flushed));
    }
  } finally {
    docker(["unpause", service]);
  }
  if (!queued) return;

  const afterLoss = inspect("queue").find((row) => row.queue === "mail");
  check("broker loss: the queue is empty after the loss", afterLoss?.pending === 0, `pending=${afterLoss?.pending}`);
  const stalled = inspect("mail", email)[0];
  check("broker loss: the outbox row survives with its publication lost", stalled?.status === "queued", `status=${stalled?.status}`);
  const premature = await messagesFor(email);
  check("broker loss: nothing is delivered while the publication is lost", premature.length === 0, `messages=${premature.length}`);

  // Open the reconciler's window, then let the real scheduler tick act. The
  // schedule itself is untouched: housekeeping runs every minute and is what
  // would re-publish the row in production.
  const aged = inspect("mail-outbox-stale", email);
  check("broker loss: the recovery window can be opened", aged.aged > 0, JSON.stringify(aged));

  // Addressed by id, never by recipient: a delivered row has its envelope
  // erased on purpose, so it stops being findable by email the moment the
  // delivery succeeds — which is exactly the outcome being waited for here.
  const recovered = await until(
    "broker loss: the reconciler re-publishes and the worker delivers",
    () => {
      const rows = inspect("mail-id", String(queued.id));
      const row = rows[0];
      if (row && row.status === "sent" && row.sent_at) return row;
      throw new Error(JSON.stringify(rows));
    },
    { deadlineMs: schedulerDeadlineMs + 120_000, intervalMs: 1_000 },
  ).catch((error) => {
    check("broker loss: the reconciler re-publishes and the worker delivers", false, error.message);
    return null;
  });
  if (!recovered) return;

  check("broker loss: the recovered message reached the provider", (await messagesFor(email)).length >= 1);
  const finalQueue = inspect("queue").find((row) => row.queue === "mail");
  check("broker loss: the mail queue drained again", finalQueue?.pending === 0, `pending=${finalQueue?.pending}`);
}

async function main() {
  console.log("== async stack: reset");
  docker(["down", "--volumes", "--remove-orphans"]);
  console.log("== async stack: backend dependencies");
  // `tools` instead of `app`: the app service carries the container probe, and
  // running it here — before the broker and the database exist — produced
  // overlapping probes that slowed this step down by minutes.
  docker(["run", "--rm", "--no-deps", "--build", "tools", "composer", "install", "--no-interaction", "--prefer-dist", "--no-progress"]);
  console.log("== async stack: up");
  // `--build` is not cosmetic: without it a locally cached image silently keeps
  // running while the Dockerfile has moved on, and the failure it produces (a
  // missing PHP extension, for instance) looks like an application bug.
  docker(["up", "-d", "--build", "--wait", "--wait-timeout", "300"]);

  // Email is a global admission budget. A fresh stack starts from zero, so a
  // leak here would be a real failure and must not be masked by a raised cap.
  const initialQueue = inspect("queue");
  check("stack: no job is left in the queue after startup", initialQueue.every((row) => row.pending === 0), JSON.stringify(initialQueue));

  const context = await mailChain();
  if (!context) throw new Error("the mail chain did not complete; later scenarios need a session");

  await analyticsChain(context);
  await domainChain(context);
  await exportChain(context);

  const hook = await webhookChain(context);
  const retry = await mailRetryChain();

  // One scheduler tick drives both pending retries, exactly as in production.
  if (hook) inspect("webhook-warp", String(hook.webhookId));
  if (retry) inspect("mail-warp", retry.email);

  if (hook) {
    const delivered = await until("webhook: scheduler retry delivers the event", () => {
      const rows = inspect("webhook", String(hook.webhookId));
      const row = rows[0];
      return row && row.status === "success" && row.delivered_at ? row : undefined;
    }, { deadlineMs: schedulerDeadlineMs }).catch((error) => {
      check("webhook: scheduler retry delivers the event", false, error.message);
      return null;
    });
    if (delivered) {
      check("webhook: delivery succeeded on the second attempt", delivered.attempts === 2, `attempts=${delivered.attempts}`);
    }

    const received = await fixture(control.webhook, "/__received");
    const attempts = Array.isArray(received.body) ? received.body : [];
    check("webhook: the receiver saw exactly two attempts", attempts.length === 2, `attempts=${attempts.length}`);
    const last = attempts[attempts.length - 1];
    check("webhook: the retried attempt was accepted", last?.responded === 200, `responded=${last?.responded}`);
    if (last) {
      const signatureHeader = last.headers["x-uvh-signature"] ?? "";
      const match = signatureHeader.match(/t=(\d+),v1=([0-9a-f]{64})/);
      const expected = match
        ? crypto.createHmac("sha256", hook.secret).update(`${match[1]}.${last.body}`).digest("hex")
        : "";
      check("webhook: the delivered body is signed with the subscription secret", Boolean(match) && expected === match[2]);
      check("webhook: the event id is stable across attempts", attempts[0].headers["x-uvh-event-id"] === last.headers["x-uvh-event-id"]);
    }
  }

  if (retry) {
    const sent = await until("mail retry: scheduler retry delivers the message", () => {
      const rows = inspect("mail-id", String(retry.id));
      const row = rows[0];
      return row && row.status === "sent" ? row : undefined;
    }, { deadlineMs: schedulerDeadlineMs }).catch((error) => {
      check("mail retry: scheduler retry delivers the message", false, error.message);
      return null;
    });
    if (sent) {
      check("mail retry: the second provider attempt succeeded", sent.attempts === 2, `attempts=${sent.attempts}`);
      const attempts = await attemptsFor(retry.email);
      check("mail retry: the provider rejected once and accepted once", attempts.filter((a) => a.accepted).length === 1 && attempts.filter((a) => !a.accepted).length >= 1, JSON.stringify(attempts.map((a) => a.accepted)));

      const messages = await messagesFor(retry.email);
      const token = messages.map((message) => tokenFromUrl(message.raw)).find(Boolean) ?? null;
      const verified = token ? await api("POST", "/api/v1/auth/verify-email", { json: { token } }) : { status: 0 };
      check("mail retry: the retried message is still usable", verified.status === 200, `HTTP ${verified.status}`);
    }
  }

  const scheduled = docker(["ps", "--format", "json", "scheduler"], { capture: true })
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => JSON.parse(line));
  check("stack: the scheduler container is running", scheduled.length === 1 && /running/i.test(scheduled[0].State ?? ""), JSON.stringify(scheduled.map((row) => row.State)));

  // Redis-specific properties. Both of them are about the broker being a
  // separate store from the source of truth, so neither can be proven on the
  // database driver the suite used to run.
  await queueDepthDrill();
  await brokerLossDrill();

  const drained = inspect("queue");
  check("stack: every queue drained to zero", drained.every((row) => row.pending === 0), JSON.stringify(drained));
}

let failure = null;
try {
  await main();
} catch (error) {
  failure = error;
  console.error(`\nFATAL: ${error instanceof Error ? error.message : String(error)}`);
} finally {
  try {
    docker(["down", "--volumes", "--remove-orphans"]);
  } catch (error) {
    console.error("teardown failed", error);
    failure ??= error;
  }
}

const failed = results.filter((row) => !row.ok);
console.log(`\n${results.length - failed.length}/${results.length} checks passed`);
if (failed.length > 0) {
  for (const row of failed) console.log(`  FAILED  ${row.name}${row.detail ? ` — ${row.detail}` : ""}`);
}
if (failure || failed.length > 0) {
  process.exitCode = 1;
}
