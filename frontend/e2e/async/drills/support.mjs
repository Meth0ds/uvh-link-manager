/**
 * The levers and diagnostics the crash drills share.
 *
 * `startExport` drives the real request/confirm handshake, `housekeepingNow`
 * runs the scheduler's own command with its heavy cadence opened, `exhaustOutbox`
 * walks a durable cycle to its terminal state, and the other two only read.
 * None of them decides anything for the application.
 */

import { until } from "../expect.mjs";
import { bearerMatching } from "../fixtures.mjs";
import { api, password } from "../session.mjs";
import { docker, inspect } from "../topology.mjs";

/** Bearer whose stored hash matches, read from the provider's own record. */
export const auditCount = (action, resourceId) => Number(inspect("audit-count", `${action} ${resourceId}`).count);
/**
 * The state that explains a job which did not finish: whether its worker is
 * still alive, where the publication ended up, and what the worker said while
 * trying to run it. Without this a stalled chain only reports "undefined".
 */
export function whyStalled(service) {
  const raw = docker(["ps", "--all", "--format", "json", service], { capture: true }).trim().split("\n")[0];
  const queue = inspect("queue").map((row) => `${row.queue}:${row.pending}`).join(" ");
  const logs = docker(["logs", "--tail", "300", service], { capture: true })
    .split("\n")
    .filter((line) => /GenerateDataExportJob|RuntimeException|Insufficient|memory|SQLSTATE|allowed|Fatal/i.test(line))
    .slice(-4)
    .map((line) => line.replace(/^\S+\s+\|\s*/, ""))
    .join(" | ");

  return JSON.stringify({ worker: raw ? JSON.parse(raw).State : "absent", queue, logs }).slice(0, 900);
}

/**
 * Request an export and confirm it with the bearer the provider delivered.
 *
 * Failures come back with the reason attached: the three ways this can stop
 * (a refused request, a confirmation that never arrived, a refused
 * confirmation) look identical in the durable state and only the HTTP status
 * and the row tell them apart.
 */
export async function startExport(email, session, workspaceId) {
  const requested = await api("POST", "/api/v1/auth/data-export", { session, workspaceId, json: { password } });
  if (requested.status !== 200 && requested.status !== 202) {
    return { reason: `request HTTP ${requested.status} ${requested.raw.slice(0, 160)}` };
  }
  const row = inspect("export-latest");
  if (!row?.confirmation_hash) {
    return { reason: `no confirmation bearer on request ${row?.id}: ${JSON.stringify(row)}` };
  }
  const token = await bearerMatching(email, row.confirmation_hash);
  if (!token) {
    return { reason: `the confirmation message never reached the provider for request ${row.id}` };
  }
  const confirmed = await api("POST", "/api/v1/auth/data-export/confirm", { json: { token } });
  if (confirmed.status !== 200) {
    return { reason: `confirm HTTP ${confirmed.status} ${confirmed.raw.slice(0, 160)}` };
  }

  return { id: row.id, confirmToken: token };
}

/**
 * The scheduled command the scheduler runs every minute, with its heavy
 * cadence opened so its recovery and retention stages are reachable now.
 * Nothing about the stages themselves is bypassed: this is the same command
 * a production deployment runs, just not waiting for its window.
 */
export function housekeepingNow() {
  inspect("heavy-due");

  return inspect("housekeeping");
}

/**
 * Drive the durable outbox cycle to its terminal state.
 *
 * What the scheduler owns here are the two levers the runbook describes — the
 * backoff window and the publication — and both are advanced through the same
 * `MailOutboxDispatcher` housekeeping calls, so five durable attempts can be
 * covered without waiting out 60/300/900/1800 seconds. The worker, its failure
 * path and the durable counter are untouched.
 */
export async function exhaustOutbox(email, outboxId) {
  for (let round = 0; round < 8; round += 1) {
    // Addressed by id once known: a delivered or compensated row erases its
    // envelope and stops being findable by recipient.
    const row = (outboxId ? inspect("mail-id", String(outboxId))[0] : null) ?? inspect("mail", email)[0];
    if (!row || row.status !== "pending") return row ?? null;
    inspect("outbox-publish", email);
    // The publication is not the attempt: the row has to reach the transport
    // and come back with one more failure on its durable counter, which is what
    // the next round reads.
    await until("outbox: the attempt is recorded", () => {
      const next = inspect("mail", email)[0];
      if (!next) return true; // Delivered: a sent row erases its envelope.
      return next.attempts > row.attempts ? next : undefined;
    }, { deadlineMs: 30_000, intervalMs: 800 }).catch(() => null);
  }

  return inspect("mail", email)[0] ?? null;
}
