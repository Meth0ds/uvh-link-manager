import { execFile, execFileSync } from "node:child_process";
import crypto from "node:crypto";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

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
// Optional overlays. The capacity drill adds php-fpm behind nginx
// (`docker-compose.analytics-drill.yml`) so its arrival passes measure a real web
// tier instead of PHP's built-in server, which is a ceiling on the harness.
// CI never sets this and keeps the default topology.
const extraComposeFiles = (process.env.UVH_ASYNC_EXTRA_COMPOSE ?? "")
  .split(",")
  .map((file) => file.trim())
  .filter((file) => file !== "");
const compose = [
  "compose",
  "-p",
  project,
  ...[composeFile, ...extraComposeFiles].flatMap((file) => ["-f", file]),
];

const backendPort = process.env.UVH_ASYNC_BACKEND_PORT ?? "8011";
const backend = `http://127.0.0.1:${backendPort}`;
// Where admitted redirect traffic is sent. With `UVH_ASYNC_EDGE=1` it goes through
// the nginx + php-fpm overlay, which is the only way an arrival pass can reach a
// regime where the rollup row has a backlog behind it on a laptop-shaped stack.
const edgePort = process.env.UVH_ASYNC_EDGE_PORT ?? "8012";
const redirectOrigin = process.env.UVH_ASYNC_EDGE === "1" ? `http://127.0.0.1:${edgePort}` : backend;
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

const execFileAsync = promisify(execFile);

/**
 * Non-blocking twin of `inspect`, for sampling while traffic is in flight.
 * `docker exec` is a synchronous child process: it would stall the event loop,
 * and with it the load generator, for the whole lifetime of every sample — the
 * harness would end up measuring itself.
 */
async function inspectAsync(...args) {
  const { stdout } = await execFileAsync(
    "docker",
    [...compose, "exec", "-T", "app", "php", "tests/E2E/async-inspect.php", ...args],
    { cwd: repositoryRoot, encoding: "utf8", timeout: 180_000 },
  );
  return JSON.parse(stdout.trim());
}

async function api(method, requestPath, { json, session, workspaceId, redirect = "follow", headers: extra = {} } = {}) {
  const headers = {
    Accept: "application/json",
    "X-CSRF-Token": csrfToken,
    Cookie: `uvh_csrf=${csrfToken}${session ? `; uvh_async_session=${session}` : ""}`,
    ...extra,
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

// ---------------------------------------------------------------------------
// Analytics rollup contention
// ---------------------------------------------------------------------------

/**
 * The daily rollup is one row per link and day, and `AnalyticsService` updates
 * it under `SELECT ... FOR UPDATE`: the six JSON dimension maps cannot be
 * incremented without holding a read-modify-write, and that same lock is what
 * enforces the 200-key cap. The serialization is deliberate, so the question is
 * not whether it exists but whether it — rather than the worker process — is
 * what limits the pool.
 *
 * Two load sources, because they answer different halves of the question:
 *
 *   arrival  clicks admitted by the public redirect path, which is what
 *            production sees. Its ceiling is the intake rate of whatever is
 *            serving HTTP: against the stack's built-in server (`php -S`) the
 *            redirect request alone is several times slower than the worker's
 *            cost per click, so no backlog forms and those passes are a
 *            fidelity check rather than a saturation one. `UVH_ASYNC_EDGE=1`
 *            with `UVH_ASYNC_EXTRA_COMPOSE=docker-compose.analytics-drill.yml`
 *            admits them through php-fpm behind nginx instead, which is the
 *            only configuration in which a `hot` arrival pass can build a
 *            backlog on the single row it is about.
 *   flood    jobs queued directly for a chosen link, which is the only way a
 *            laptop-shaped stack reaches the regime where one row has a real
 *            backlog behind it.
 *
 * Every pass varies one thing:
 *
 *   arrival hot, one worker        one row, one worker   -> the process is the floor
 *   arrival hot, N workers         one row, N workers    -> the row is the floor
 *   arrival spread, N workers      N rows, N workers     -> same volume, no shared row
 *   arrival hot, N workers, fill   the hot pass once the page is rewritten with room
 *   flood hot, one worker          a real backlog on one row, one worker
 *   flood hot, N workers           the same backlog, N workers -> does it scale?
 *   flood spread, N workers        the same backlog over N rows -> the baseline
 *
 * `spread` is the no-contention baseline for the same total work, so the
 * difference between it and `hot` is the serialization cost, and no pass has to
 * disable anything in the application to obtain it. A single run is not a
 * capacity claim: rounds are interleaved and the medians are what get compared.
 *
 * Fidelity is asserted on every pass, because the worse outcome would be an
 * operator reading "the pool is slower" while clicks silently vanish: every
 * click has to appear in exactly one click event, in the daily rollup and in
 * the visible counter.
 */
const analyticsDrill = {
  links: Number(process.env.UVH_ASYNC_ANALYTICS_LINKS ?? 8),
  // The defaults are sized so the drill fits inside the CI job that runs this
  // suite. A capacity exercise raises `flood`, `requests` and `rounds` through
  // the environment; the reference run and its numbers are recorded in
  // `docs/analytics-rollup-capacity.md`.
  requests: Number(process.env.UVH_ASYNC_ANALYTICS_REQUESTS ?? 120),
  concurrency: Number(process.env.UVH_ASYNC_ANALYTICS_CONCURRENCY ?? 24),
  rounds: Number(process.env.UVH_ASYNC_ANALYTICS_ROUNDS ?? 2),
  lowWorkers: Number(process.env.UVH_ASYNC_ANALYTICS_LOW_WORKERS ?? 1),
  highWorkers: Number(process.env.UVH_ASYNC_ANALYTICS_HIGH_WORKERS ?? 4),
  fillfactor: Number(process.env.UVH_ASYNC_ANALYTICS_FILLFACTOR ?? 70),
  sampleMs: Number(process.env.UVH_ASYNC_ANALYTICS_SAMPLE_MS ?? 500),
  flood: Number(process.env.UVH_ASYNC_ANALYTICS_FLOOD ?? 600),
};

/**
 * A visitor is `(day, ip, user agent)`, so a constant agent would make every
 * click the same visitor and hide the row-per-visitor insert entirely. The set
 * is small and fixed on purpose: a bounded, comparable number of distinct
 * dimension values per pass instead of a random workload whose cost drifts.
 */
const drillUserAgents = [
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0.0.0 Safari/537.36",
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Safari/605.1.15",
  "Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36",
  "Mozilla/5.0 (iPhone; CPU iPhone OS 18_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.5 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Android 15; Mobile; rv:132.0) Gecko/132.0 Firefox/132.0",
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64; rv:133.0) Gecko/20100101 Firefox/133.0",
  "Mozilla/5.0 (iPad; CPU OS 18_4 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/18.4 Mobile/15E148 Safari/604.1",
  "Mozilla/5.0 (Linux; Android 14; SM-S918B) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/139.0.0.0 Mobile Safari/537.36",
];

const sum = (values) => [...values].reduce((total, value) => total + value, 0);

function median(values) {
  const sorted = [...values].filter((value) => Number.isFinite(value)).sort((a, b) => a - b);
  if (sorted.length === 0) return null;
  const middle = Math.floor(sorted.length / 2);

  return sorted.length % 2 === 0 ? Math.round((sorted[middle - 1] + sorted[middle]) / 2) : sorted[middle];
}

function drillParametersAreSane() {
  const { links, requests, concurrency, rounds, lowWorkers, highWorkers, fillfactor, sampleMs, flood } = analyticsDrill;

  return Number.isSafeInteger(links) && links >= 2 && links <= 50
    && Number.isSafeInteger(requests) && requests >= 20 && requests <= 5000
    && Number.isSafeInteger(concurrency) && concurrency >= 1 && concurrency <= 200
    && Number.isSafeInteger(rounds) && rounds >= 1 && rounds <= 10
    && Number.isSafeInteger(lowWorkers) && lowWorkers >= 1 && lowWorkers <= 8
    && Number.isSafeInteger(highWorkers) && highWorkers >= lowWorkers && highWorkers <= 8
    && Number.isSafeInteger(fillfactor) && fillfactor >= 10 && fillfactor <= 100
    && Number.isSafeInteger(sampleMs) && sampleMs >= 100 && sampleMs <= 5000
    && Number.isSafeInteger(flood) && flood >= 20 && flood <= 20_000;
}

function analyticsWorkerCount() {
  return docker(["ps", "-q", "queue-analytics"], { capture: true }).trim().split("\n").filter(Boolean).length;
}

/**
 * Contention needs more than one consumer; a single worker serializes the
 * queue before the row ever matters. Scaling is the documented knob for that
 * (`docker compose --scale queue-analytics=N`) and it stays in the ephemeral
 * stack: the production topology keeps one worker per pool.
 */
async function scaleAnalyticsWorkers(count) {
  if (analyticsWorkerCount() === count) return;

  docker(["up", "-d", "--no-deps", "--scale", `queue-analytics=${count}`, "queue-analytics"]);
  await until(
    `analytics drill: ${count} analytics worker(s) are running`,
    () => (analyticsWorkerCount() === count ? true : undefined),
    { deadlineMs: 30_000, intervalMs: 500 },
  );
  // A worker that has just started still has to boot the framework; a pass
  // measured inside that window would be reporting a cold start.
  await sleep(1_500);
}

async function createRollupLinks(context, count) {
  const links = [];
  for (let index = 0; index < count; index += 1) {
    const alias = `async-rollup-${crypto.randomBytes(4).toString("hex")}`;
    const created = await api("POST", "/api/v1/links", {
      session: context.session,
      workspaceId: context.workspaceId,
      json: { destination: "https://example.org/async-rollup", alias },
    });
    const linkId = created.body?.link?.id;
    if (created.status !== 201 || !linkId) {
      throw new Error(`analytics drill: link ${index} was not created (HTTP ${created.status})`);
    }
    links.push({ alias, id: linkId });
  }

  return links;
}

const tableDelta = (before, after, table, field) => (after[table]?.[field] ?? 0) - (before[table]?.[field] ?? 0);

/** One measured pass: fixed volume, one knob varied. */
async function runRollupPass(label, links, { source, mode, workers, fillfactor }) {
  await scaleAnalyticsWorkers(workers);
  if (fillfactor !== null) inspect("rollup-fillfactor", String(fillfactor));

  const { requests, concurrency, sampleMs, flood } = analyticsDrill;
  const volume = source === "flood" ? flood : requests;
  // `hot` concentrates the whole volume on one row, which is the serialization
  // case; `spread` distributes the same volume over many rows.
  const targets = mode === "hot" ? [links[0]] : links;
  const targetIds = targets.map((link) => link.id);
  const fanout = source === "flood" ? targets : Array.from({ length: requests }, (_unused, index) => targets[index % targets.length]);

  // The counters in `analytics-batch` are lifetime totals and earlier passes
  // have already put clicks on these links, so a pass is asserted on its own
  // increment. The baseline is taken once the pool is provably idle: a job
  // still in flight would land after the snapshot and inflate it. A pass that
  // starts polluted is reported instead of aborting the whole drill, because
  // one bad measurement should not throw away the other passes.
  const idle = await until(
    `analytics drill: the pool is idle before ${label}`,
    () => ((inspect("queue").find((row) => row.queue === "analytics")?.pending ?? -1) === 0 ? true : undefined),
    { deadlineMs: 30_000, intervalMs: 500 },
  ).catch(() => null);
  check(`rollup ${label}: the pool was idle before the pass started`, idle !== null);
  const baseline = inspect("analytics-batch", targetIds.join(","));

  const statsBefore = inspect("rollup-stats");
  const waits = { peak: 0, seconds: 0, onRollups: 0, unreadable: false };

  // Sampling runs beside the traffic through an asynchronous child process, so
  // the load generator keeps producing while the server is asked about locks.
  // The samples are indicative: the reader shares the app container with the
  // traffic it is observing.
  let sampling = true;
  const sampler = (async () => {
    while (sampling) {
      try {
        const sample = await inspectAsync("lock-wait");
        waits.peak = Math.max(waits.peak, sample.blocked);
        waits.seconds = Math.max(waits.seconds, sample.max_wait_seconds);
        waits.onRollups = Math.max(waits.onRollups, sample.on_metric_rollups);
      } catch {
        waits.unreadable = true;
      }
      await sleep(sampleMs);
    }
  })();

  const statuses = new Map();
  const admitted = new Map();
  let cursor = 0;
  const startedAt = Date.now();
  if (source === "flood") {
    // The queue push is the admission, so every dispatched job is expected to
    // land exactly once. The inspector reports the split it used, which keeps
    // the expectation and the dispatch from drifting apart.
    const dispatched = inspect("rollup-flood", `${flood} ${targetIds.join(",")}`);
    for (const [id, count] of Object.entries(dispatched.per_link ?? {})) admitted.set(Number(id), count);
    statuses.set("dispatched", dispatched.dispatched ?? 0);
  } else {
    await Promise.all(Array.from({ length: Math.min(concurrency, fanout.length) }, async () => {
      while (cursor < fanout.length) {
        const index = cursor;
        const link = fanout[index];
        cursor += 1;
        try {
          // Against the public path as a visitor reaches it: no session cookie
          // and no CSRF token, and through the web tier when the drill has one.
          const response = await fetch(`${redirectOrigin}/r/${link.alias}`, {
            redirect: "manual",
            headers: { "User-Agent": drillUserAgents[index % drillUserAgents.length] },
          });
          statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
          // Only an admitted redirect enqueues a click, so the expectation is
          // the admitted volume, not the fired one. The rate limiter stays
          // untouched and any `429` is reported with the pass instead of
          // failing it.
          if (response.status === 302) admitted.set(link.id, (admitted.get(link.id) ?? 0) + 1);
        } catch {
          statuses.set("network_error", (statuses.get("network_error") ?? 0) + 1);
        }
      }
    }));
  }
  const firedMs = Date.now() - startedAt;

  const backlogAtFire = inspect("queue").find((row) => row.queue === "analytics")?.pending ?? -1;
  const expectation = [...admitted.entries()];
  const ids = expectation.map(([id]) => id);
  const admittedTotal = sum(admitted.values());
  // This pass's increment, which is what a click produced during it must add.
  const countAt = (states, id, field) => (states[String(id)]?.[field] ?? 0) - (baseline[String(id)]?.[field] ?? 0);
  // `links.click_count` is the denormalized counter the public redirect bumps,
  // never the worker: an arrival pass has to see it grow with the admitted
  // clicks, and a flood pass has to see it stay put, because it deliberately
  // bypasses that path. Asserting both keeps the two responsibilities from
  // drifting apart — a job that started writing the visible counter would fail
  // the flood passes, and a redirect that stopped bumping it would fail the
  // arrival ones.
  const counterTarget = (count) => (source === "flood" ? 0 : count);
  const matchesExpectation = (states, id, count) => countAt(states, id, "click_events") === count
    && countAt(states, id, "rollup_clicks") === count
    && countAt(states, id, "click_count") === counterTarget(count);

  const drainStarted = Date.now();
  const settled = ids.length === 0 ? null : await until(
    `analytics drill: ${label} empties the rollup backlog`,
    () => {
      const states = inspect("analytics-batch", ids.join(","));
      return expectation.every(([id, count]) => matchesExpectation(states, id, count)) ? states : undefined;
    },
    { deadlineMs: 120_000, intervalMs: 500 },
  ).catch(() => null);
  const drainMs = settled === null ? null : Date.now() - drainStarted;

  sampling = false;
  await sampler;

  const statsAfter = inspect("rollup-stats");
  const final = ids.length === 0 ? {} : inspect("analytics-batch", ids.join(","));
  const pending = inspect("queue").find((row) => row.queue === "analytics")?.pending ?? -1;
  const mismatches = expectation
    .map(([id, count]) => ({
      id,
      expected: { click_events: count, rollup_clicks: count, click_count: counterTarget(count) },
      actual: {
        click_events: countAt(final, id, "click_events"),
        rollup_clicks: countAt(final, id, "rollup_clicks"),
        click_count: countAt(final, id, "click_count"),
      },
    }))
    .filter((row) => Object.keys(row.expected).some((field) => row.actual[field] !== row.expected[field]));

  check(
    `rollup ${label}: every click is counted exactly once and the pool drains`,
    settled !== null && mismatches.length === 0 && pending === 0,
    settled === null
      ? `the pool did not drain within 120s (clicks=${admittedTotal}, pending=${pending})`
      : JSON.stringify({
        clicks: admittedTotal,
        clickEvents: sum(expectation.map(([id]) => countAt(final, id, "click_events"))),
        rollupClicks: sum(expectation.map(([id]) => countAt(final, id, "rollup_clicks"))),
        visibleCounter: sum(expectation.map(([id]) => countAt(final, id, "click_count"))),
        pending,
        mismatches: mismatches.slice(0, 3),
      }),
  );

  const updates = tableDelta(statsBefore, statsAfter, "metric_rollups", "updates");
  const hotUpdates = tableDelta(statsBefore, statsAfter, "metric_rollups", "hot_updates");

  return {
    label,
    source,
    mode,
    origin: source === "flood" ? "queue" : redirectOrigin,
    workers,
    fillfactor: fillfactor ?? 100,
    rows: targets.length,
    volume,
    clicks: admittedTotal,
    firedMs,
    drainMs,
    clicksPerSecond: drainMs ? Number((admittedTotal / (drainMs / 1000)).toFixed(1)) : null,
    backlogAtFire,
    peakBlocked: waits.peak,
    peakWaitSeconds: waits.seconds,
    peakWaitingOnRollups: waits.onRollups,
    lockSamples: waits.unreadable ? "unreadable" : "ok",
    statuses: [...statuses.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)))
      .map(([code, count]) => `${code}=${count}`).join(" "),
    rollupUpdates: updates,
    rollupHotUpdates: hotUpdates,
    hotShare: updates > 0 ? Number((hotUpdates / updates).toFixed(3)) : null,
    rollupDeadTuples: statsAfter.metric_rollups?.dead_tuples ?? -1,
    reloptions: String(statsAfter.metric_rollups?.options ?? ""),
    // The second growth axis, measured rather than decided: rows the visitor
    // table actually inserted (a conflicting `insertOrIgnore` inserts none).
    uniqueVisitorRows: tableDelta(statsBefore, statsAfter, "metric_unique_visitors", "inserts"),
  };
}

async function analyticsContentionDrill(context) {
  if (!check("rollup contention: the drill parameters are sane", drillParametersAreSane(), JSON.stringify(analyticsDrill))) {
    return;
  }

  const { links: linkCount, rounds, lowWorkers, highWorkers, fillfactor } = analyticsDrill;
  console.log(`\n== rollup contention: knobs ${JSON.stringify(analyticsDrill)}`);

  const links = await createRollupLinks(context, linkCount);
  check("rollup contention: the drill links were created", links.length === linkCount, `links=${links.length}`);

  // Interleaved on purpose: a first pass in a cold process and a last one in a
  // warm one would otherwise be attributed to the knob being varied. The flood
  // passes sit in the middle of each round so the arrival passes bracket them.
  const plan = [
    { label: `arrival hot@${lowWorkers}`, source: "arrival", mode: "hot", workers: lowWorkers, fillfactor: null },
    { label: `flood hot@${lowWorkers}`, source: "flood", mode: "hot", workers: lowWorkers, fillfactor: null },
    { label: `flood hot@${highWorkers}`, source: "flood", mode: "hot", workers: highWorkers, fillfactor: null },
    { label: `flood spread@${highWorkers}`, source: "flood", mode: "spread", workers: highWorkers, fillfactor: null },
    { label: `arrival spread@${highWorkers}`, source: "arrival", mode: "spread", workers: highWorkers, fillfactor: null },
    { label: `arrival hot@${highWorkers}`, source: "arrival", mode: "hot", workers: highWorkers, fillfactor: null },
    { label: `arrival hot@${highWorkers}/fill${fillfactor}`, source: "arrival", mode: "hot", workers: highWorkers, fillfactor },
  ];

  const passes = [];
  try {
    for (let round = 1; round <= rounds; round += 1) {
      for (const pass of plan) {
        passes.push(await runRollupPass(`round ${round} ${pass.label}`, links, pass));
        // Rewriting the pages is measurement setup, so the next pass in the
        // round starts from the default storage parameters again.
        if (pass.fillfactor !== null) inspect("rollup-fillfactor", "100");
      }
    }
  } finally {
    // Leave behind the topology the compose file documents: one worker per pool.
    await scaleAnalyticsWorkers(1).catch((error) => {
      console.error(`analytics drill: could not restore the worker count (${error.message})`);
    });
  }

  console.log("\n== rollup contention: passes");
  console.table(passes.map((pass) => ({
    pass: pass.label,
    source: pass.source,
    origin: pass.origin,
    workers: pass.workers,
    rows: pass.rows,
    fill: pass.fillfactor,
    clicks: pass.clicks,
    firedMs: pass.firedMs,
    drainMs: pass.drainMs,
    clicksPerSecond: pass.clicksPerSecond,
    backlogAtFire: pass.backlogAtFire,
    peakBlocked: pass.peakBlocked,
    peakWaitSeconds: pass.peakWaitSeconds,
    rolledUpdates: pass.rollupUpdates,
    hotShare: pass.hotShare,
    visitorRows: pass.uniqueVisitorRows,
    statuses: pass.statuses,
  })));

  const byPlan = new Map();
  for (const pass of passes) {
    const key = pass.label.replace(/^round \d+ /, "");
    if (!byPlan.has(key)) byPlan.set(key, []);
    byPlan.get(key).push(pass.drainMs);
  }
  console.log("== rollup contention: median drain per pass");
  for (const [key, values] of byPlan) {
    console.log(`  ${key}: ${median(values) ?? "-"} ms over ${values.length} pass(es)`);
  }

  return passes;
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

  // A capacity pass needs the stack, a session and the rollup links — not the
  // mail, DNS, export and webhook chains, which the drill never reads. Keeping
  // them out is what lets an operator iterate on the drill's volume knobs
  // without paying for the whole suite each time. CI never sets this.
  if (process.env.UVH_ASYNC_DRILL_ONLY === "1") {
    console.log("== async stack: drill only (UVH_ASYNC_DRILL_ONLY=1)");
    await analyticsContentionDrill(context);
    const settled = inspect("queue");
    check("stack: every queue drained to zero", settled.every((row) => row.pending === 0), JSON.stringify(settled));
    return;
  }

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

  // The rollup drill runs last: it scales the analytics pool and rewrites one
  // table's storage parameters, and nothing after it would want to observe the
  // stack in that state.
  await analyticsContentionDrill(context);

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
