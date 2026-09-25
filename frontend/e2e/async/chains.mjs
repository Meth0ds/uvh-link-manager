/**
 * The happy paths: request -> commit -> queue -> the right worker -> end state.
 *
 * One function per chain, each self-contained and each returning what the later
 * scenarios need. Nothing here crashes a process; the drills do.
 */

import crypto from "node:crypto";
import { check, until } from "./expect.mjs";
import { fixture, fixtureSecret, hookUrl, messageMatching, setState, tokenFromUrl } from "./fixtures.mjs";
import { api, login, password, register, uniqueEmail, workspaces } from "./session.mjs";
import { control, docker, inspect, runningService } from "./topology.mjs";

// ---------------------------------------------------------------------------
// Scenarios
// ---------------------------------------------------------------------------

/** Registration -> outbox -> mail worker -> SMTP -> the link actually works. */
export async function mailChain() {
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

  const verified = await api("POST", "/api/v1/auth/verify-email", {
    json: { token, password, name: "Persona E2E", acceptTerms: true, termsVersion: "2026-08-30", privacyVersion: "2026-08-30" },
  });
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
export async function analyticsChain({ session, workspaceId }) {
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
export async function domainChain({ session, workspaceId }) {
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

/**
 * Request -> exports worker -> artifact -> announcement -> download (reusable
 * until acknowledged) -> acknowledge -> retired.
 */
export async function exportChain({ email, session, workspaceId }) {
  const requested = await api("POST", "/api/v1/auth/data-export", { session, workspaceId, json: { password } });
  check("export: request admitted with step-up", requested.status === 200 || requested.status === 202, `HTTP ${requested.status}`);
  if (requested.status !== 200 && requested.status !== 202) return;

  // The request is what enqueues the job: no confirmation step exists, so the
  // state advances alone from here and the page only polls it.
  const ready = await until("export: exports worker produces the artifact", () => {
    const state = inspect("export-latest");
    return state.status === "ready" && state.artifact ? state : undefined;
  }, { deadlineMs: 60_000 }).catch((error) => {
    check("export: exports worker produces the artifact", false, `${error.message} | ${JSON.stringify(inspect("export-latest"))}`);
    return null;
  });
  if (!ready) return;

  // The ready notice is an announcement and nothing more: it reaches the
  // provider and points at the exports section, carrying no bearer that could
  // authorize a download on its own. The anchors are ASCII on purpose — the
  // transport may encode accents, but the link text and its target survive
  // every encoding the provider can choose.
  const announced = await until("export: ready announcement reaches the provider", async () =>
    messageMatching(email, (text) => /Ir a mis exportaciones|settings#privacy/i.test(text)),
  { deadlineMs: 45_000 }).catch((error) => {
    check("export: ready announcement reaches the provider", false, `${error.message} | ${JSON.stringify(ready)}`);
    return null;
  });
  if (!announced) return;
  check("export: the announcement advertises no bearer", !tokenFromUrl(announced.raw));

  const downloaded = await api("POST", "/api/v1/auth/data-export/download", { session, workspaceId, json: { password } });
  check("export: a fresh step-up serves the whole artifact", downloaded.status === 200 && downloaded.raw.length > 0, `HTTP ${downloaded.status} bytes=${downloaded.raw.length}`);

  // The acknowledgement is what consumes the export: until it arrives the
  // same session may re-download and receives the same bytes.
  const retried = await api("POST", "/api/v1/auth/data-export/download", { session, workspaceId, json: { password } });
  check("export: an unacknowledged download serves the same artifact again", retried.status === 200 && retried.raw === downloaded.raw, `HTTP ${retried.status}`);

  const consumed = await api("POST", "/api/v1/auth/data-export/download/acknowledge", { session, workspaceId });
  check("export: download acknowledged", consumed.status === 200, `HTTP ${consumed.status}`);
  const after = inspect("export-latest");
  check("export: artifact is retired after consumption", after.status === "downloaded" && after.artifact === null, JSON.stringify(after));
}

/** Webhook event -> webhooks worker -> 500 -> scheduled retry -> 200 -> delivered. */
export async function webhookChain({ session, workspaceId }) {
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
export async function mailRetryChain() {
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
