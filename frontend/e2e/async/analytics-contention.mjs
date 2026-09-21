/**
 * Rollup capacity: the part of the suite that measures instead of asserting.
 *
 * Each pass fixes a volume and varies one thing, compares the median drain
 * between interleaved passes and asserts in every one of them that each click
 * is counted exactly once.
 */

import crypto from "node:crypto";
import { check, sleep, until } from "./expect.mjs";
import { api } from "./session.mjs";
import { docker, inspect, inspectAsync, redirectOrigin } from "./topology.mjs";

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

export async function analyticsContentionDrill(context) {
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
