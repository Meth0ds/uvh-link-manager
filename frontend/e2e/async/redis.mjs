/**
 * The two properties that only exist because the broker is Redis: depth that
 * describes real pending work, and work that survives losing the broker's
 * contents.
 */

import { check, until } from "./expect.mjs";
import { messageMatching, messagesFor } from "./fixtures.mjs";
import { register, uniqueEmail } from "./session.mjs";
import { docker, inspect, runningService, schedulerDeadlineMs } from "./topology.mjs";

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
export async function queueDepthDrill() {
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
export async function brokerLossDrill() {
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
