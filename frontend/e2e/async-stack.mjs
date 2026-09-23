/**
 * Asynchronous end-to-end harness — entry point.
 *
 * The scenarios live in `async/`: this file decides which of them a run
 * includes, drives them in order and reports the verdict.
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

import crypto from "node:crypto";
import { analyticsContentionDrill } from "./async/analytics-contention.mjs";
import { analyticsChain, domainChain, exportChain, mailChain, mailRetryChain, webhookChain } from "./async/chains.mjs";
import { exportCrashDrill } from "./async/drills/export-crash.mjs";
import { mailOutboxOutageDrill } from "./async/drills/outbox-outage.mjs";
import { schedulerRecoveryDrill } from "./async/drills/scheduler-recovery.mjs";
import { check, results, until } from "./async/expect.mjs";
import { attemptsFor, fixture, messagesFor, setState, tokenFromUrl } from "./async/fixtures.mjs";
import { brokerLossDrill, queueDepthDrill } from "./async/redis.mjs";
import { api, password } from "./async/session.mjs";
import { control, docker, inspect, schedulerDeadlineMs } from "./async/topology.mjs";

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

  // Only the crash and recovery drills — all of them, or a named subset — for
  // iterating on them without paying for the whole suite. CI never sets this.
  const only = (process.env.UVH_ASYNC_ONLY ?? "").split(",").map((name) => name.trim()).filter(Boolean);
  if (only.length > 0) {
    console.log(`== async stack: crash and recovery drills only (${only.join(",")})`);
    if (only.includes("1") || only.includes("all") || only.includes("scheduler")) await schedulerRecoveryDrill();
    if (only.includes("1") || only.includes("all") || only.includes("export")) await exportCrashDrill(context);
    if (only.includes("1") || only.includes("all") || only.includes("outbox")) await mailOutboxOutageDrill(context);
    await setState(control.mail, { mode: "accept", rejectNext: 0 });
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
      const verified = token ? await api("POST", "/api/v1/auth/verify-email", { json: { token, password } }) : { status: 0 };
      check("mail retry: the retried message is still usable", verified.status === 200, `HTTP ${verified.status}`);
    }
  }

  // The crash and recovery drills come after the scheduler's own retry work has
  // been observed, so neither their outages nor their housekeeping passes can
  // change what those chains assert.
  await schedulerRecoveryDrill();
  await exportCrashDrill(context);
  await mailOutboxOutageDrill(context);
  // Whatever the outage drill ended on, the provider behind the remaining
  // Redis drills must be accepting again: they assert real deliveries.
  await setState(control.mail, { mode: "accept", rejectNext: 0 });

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
