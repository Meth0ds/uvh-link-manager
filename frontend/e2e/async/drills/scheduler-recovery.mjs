/**
 * A stopped scheduler: noticed by its heartbeat, recovered without loss.
 *
 * The retry held here can only move when a scheduler tick publishes it, so the
 * outage and the recovery are both observable.
 */

import { check, sleep, until } from "../expect.mjs";
import { messagesFor, setState } from "../fixtures.mjs";
import { register, uniqueEmail } from "../session.mjs";
import { control, docker, inspect } from "../topology.mjs";

/**
 * A stopped scheduler: noticed by its heartbeat, and recoverable without loss.
 *
 * The retry that is held here can only move when a scheduler tick publishes it,
 * so the outage and the recovery are both observable: nothing is delivered
 * while the process is gone, and the held work lands exactly once when it
 * comes back.
 */
export async function schedulerRecoveryDrill() {
  // The signal has to exist before it can be observed stopping; on a freshly
  // booted stack the first successful housekeeping pass is what publishes it.
  const before = await until("scheduler recovery: the scheduler publishes its heartbeat", () => {
    const beat = inspect("heartbeat", "scheduler");
    return beat.present && beat.age_seconds <= 210 ? beat : undefined;
  }, { deadlineMs: 240_000, intervalMs: 5_000 }).catch(() => null);
  check(
    "scheduler recovery: the scheduler is alive and its heartbeat is fresh",
    before !== null,
    JSON.stringify(before),
  );

  const email = uniqueEmail("async-scheduler");
  await setState(control.mail, { mode: "accept", rejectNext: 1 });
  const registered = await register(email, "Persona Scheduler");
  check(
    "scheduler recovery: the account whose retry will be held is registered",
    registered.status === 200 || registered.status === 201,
    `HTTP ${registered.status}`,
  );
  const pending = await until("scheduler recovery: a retry is waiting for the scheduler tick", () => {
    const row = inspect("mail", email)[0];
    return row && row.attempts >= 1 && row.status === "pending" ? row : undefined;
  }, { deadlineMs: 45_000 }).catch((error) => {
    check("scheduler recovery: a retry is waiting for the scheduler tick", false, error.message);
    return null;
  });
  if (!pending) return;
  inspect("mail-warp", email);

  docker(["kill", "scheduler"]);
  const deadRow = docker(["ps", "--all", "--format", "json", "scheduler"], { capture: true }).trim().split("\n")[0];
  const deadState = deadRow ? JSON.parse(deadRow).State : "absent";
  check("scheduler recovery: the scheduler process is not running", !/running/i.test(String(deadState)), `state=${deadState}`);

  const sample = inspect("heartbeat", "scheduler").age_seconds;
  await sleep(8_000);
  const later = inspect("heartbeat", "scheduler").age_seconds;
  check(
    "scheduler recovery: a stopped scheduler stops its heartbeat",
    later - sample >= 6,
    JSON.stringify({ first: sample, second: later }),
  );
  check(
    "scheduler recovery: the held retry does not move while the scheduler is down",
    inspect("mail-id", String(pending.id))[0]?.status === "pending" && (await messagesFor(email)).length === 0,
  );

  docker(["start", "scheduler"]);
  const revived = await until("scheduler recovery: the restarted scheduler ticks again", () => {
    const beat = inspect("heartbeat", "scheduler");
    return beat.present && beat.age_seconds <= 60 ? beat : undefined;
  }, { deadlineMs: 180_000, intervalMs: 5_000 }).catch((error) => {
    check("scheduler recovery: the restarted scheduler ticks again", false, error.message);
    return null;
  });
  if (revived) check("scheduler recovery: the restarted scheduler ticks again", true, JSON.stringify(revived));

  const delivered = await until("scheduler recovery: the held retry is delivered after recovery", () => {
    const row = inspect("mail-id", String(pending.id))[0];
    return row && row.status === "sent" ? row : undefined;
  }, { deadlineMs: 180_000, intervalMs: 2_000 }).catch((error) => {
    check("scheduler recovery: the held retry is delivered after recovery", false, error.message);
    return null;
  });
  if (delivered) {
    const messages = await messagesFor(email);
    check("scheduler recovery: the recovered delivery happened exactly once", messages.length === 1, `messages=${messages.length}`);
  }
}
