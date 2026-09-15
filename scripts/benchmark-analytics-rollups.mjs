#!/usr/bin/env node

/**
 * Analytics rollup capacity check.
 *
 * The redirect is served from the link transaction and the rollup is written
 * later by the `analytics` pool, so the question this answers is not "how fast
 * are redirects" but "does the pool keep up, and how long does a backlog take
 * to drain". Both come from the operations endpoint the deployment already
 * exposes (`/internal/metrics`: `uvh_queue_analytics_pending_jobs` and
 * `uvh_queue_analytics_oldest_job_age_seconds`), never from timings of the
 * redirect alone, which stays flat whether or not the worker is behind.
 *
 * One link exercises a single `(link_id, day)` row, which is the serialization
 * case. A list of links exercises the same total volume spread over many rows,
 * which is the no-contention baseline. Neither number is a capacity claim on
 * its own: compare the two on the same host, and treat lock waits, if you
 * sample them, as a hint rather than a measurement.
 *
 * `scripts/benchmark-redirects.mjs` already owns the HTTP-level p50/p95/p99 of
 * the redirect itself; this script deliberately reports pool health instead so
 * the two artifacts stay separate.
 *
 * Usage (only against an environment you are authorized to load):
 *
 *   node scripts/benchmark-analytics-rollups.mjs \
 *     --url=https://staging.example/r/alias-ficticio \
 *     --metrics-url=https://private.example/internal/metrics \
 *     --metrics-token=$UVH_METRICS_TOKEN \
 *     --requests=2000 --concurrency=50
 *
 *   # spread over many aliases, one per line, in a file
 *   node scripts/benchmark-analytics-rollups.mjs --aliases=./aliases.txt ...
 */

import { performance } from "node:perf_hooks";
import { readFileSync } from "node:fs";

const args = Object.fromEntries(process.argv.slice(2).map((entry) => {
  const [key, value = ""] = entry.replace(/^--/, "").split("=", 2);
  return [key, value];
}));

const take = (value, fallback) => (value === "" || value === undefined ? fallback : Number.parseInt(value, 10));
const requests = take(args.requests, 1000);
const concurrency = take(args.concurrency, 20);
const timeoutMs = take(args.timeout, 5000);
const drainTimeoutMs = take(args["drain-timeout"], 300_000);
const pollMs = take(args["poll-interval"], 1000);

/** Every target must be an absolute http(s) URL; the alias itself is dropped. */
function targets() {
  if (typeof args.aliases === "string" && args.aliases !== "") {
    return readFileSync(args.aliases, "utf8").split("\n").map((line) => line.trim()).filter(Boolean);
  }

  return args.url ? [args.url] : [];
}

const urls = targets().map((entry) => new URL(entry));
const metricsUrl = args["metrics-url"] ? new URL(args["metrics-url"]) : null;
const metricsToken = args["metrics-token"] ?? process.env.UVH_METRICS_TOKEN ?? "";

if (urls.length === 0
  || !Number.isSafeInteger(requests) || requests < 1 || requests > 100_000
  || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 500
  || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000
  || !Number.isSafeInteger(drainTimeoutMs) || drainTimeoutMs < 1000 || drainTimeoutMs > 900_000
  || !Number.isSafeInteger(pollMs) || pollMs < 100 || pollMs > 30_000) {
  throw new Error(
    "Use --url=https://host/r/alias or --aliases=file [--requests=1000] [--concurrency=20] "
    + "[--timeout=5000] [--metrics-url=https://host/internal/metrics --metrics-token=...]",
  );
}

for (const url of [...urls, ...(metricsUrl ? [metricsUrl] : [])]) {
  if (url.username || url.password || url.hash) {
    throw new Error("Credentials and fragments are not accepted in a target URL");
  }
  const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname) || url.hostname.endsWith(".localhost");
  if (url.protocol !== "https:" && !(local && url.protocol === "http:")) {
    throw new Error(`Refusing a plaintext target: ${url.origin}`);
  }
}

/** One gauge from the Prometheus text endpoint, labels tolerated. */
async function gauge(name) {
  if (!metricsUrl) return null;
  const response = await fetch(metricsUrl, {
    headers: metricsToken ? { Authorization: `Bearer ${metricsToken}` } : {},
    signal: AbortSignal.timeout(timeoutMs),
  });
  if (response.status !== 200) return null;
  const text = await response.text();
  const match = text.match(new RegExp(`^${name}(?:\\{[^}]*\\})?\\s+([0-9.eE+-]+)\\s*$`, "m"));
  return match ? Number.parseFloat(match[1]) : null;
}

async function pool() {
  const [pending, oldestAge] = await Promise.all([
    gauge("uvh_queue_analytics_pending_jobs"),
    gauge("uvh_queue_analytics_oldest_job_age_seconds"),
  ]);
  return { pending, oldestAge };
}

const durations = [];
const statuses = new Map();
const targetCounts = new Map();
let cursor = 0;

async function worker() {
  while (cursor < requests) {
    const index = cursor;
    cursor += 1;
    // Round robin, so `--aliases` spreads the same volume over many rows while
    // a single `--url` concentrates it on one.
    const url = urls[index % urls.length];
    targetCounts.set(url.origin, (targetCounts.get(url.origin) ?? 0) + 1);
    const started = performance.now();
    try {
      const response = await fetch(url, {
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
        headers: { "User-Agent": "uvh-authorized-capacity-check/1.0" },
      });
      durations.push(performance.now() - started);
      statuses.set(response.status, (statuses.get(response.status) ?? 0) + 1);
      await response.body?.cancel();
    } catch {
      durations.push(performance.now() - started);
      statuses.set("network_error", (statuses.get("network_error") ?? 0) + 1);
    }
  }
}

const before = await pool();
const wallStarted = performance.now();
await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, () => worker()));
const wallMs = performance.now() - wallStarted;

// The backlog is read as soon as the traffic stops, then followed until the
// gauges agree that nothing is pending. Without a metrics endpoint the drain
// is simply not reported: an assumed zero would be a claim this script cannot
// make.
const afterTraffic = await pool();
let lastSample = afterTraffic;
let peakOldestAge = afterTraffic.oldestAge ?? null;
let drainMs = null;
if (metricsUrl) {
  const drainStarted = performance.now();
  while (performance.now() - drainStarted < drainTimeoutMs) {
    const current = await pool();
    lastSample = current;
    if (current.pending === 0 && current.oldestAge === 0) {
      drainMs = Math.round(performance.now() - drainStarted);
      break;
    }
    if (current.oldestAge !== null && (peakOldestAge === null || current.oldestAge > peakOldestAge)) {
      peakOldestAge = current.oldestAge;
    }
    await new Promise((resolve) => setTimeout(resolve, pollMs));
  }
}

durations.sort((a, b) => a - b);

function percentile(value) {
  return durations[Math.min(durations.length - 1, Math.ceil(durations.length * value) - 1)];
}

// Deliberately omit the alias, the query and the path: capacity evidence must
// not turn a private or single-use test URL into a log disclosure.
process.stdout.write(`${JSON.stringify({
  targetOrigin: urls[0].origin,
  distinctTargets: urls.length,
  requestsPerTarget: Object.fromEntries([...targetCounts.entries()]),
  requests,
  concurrency,
  timeoutMs,
  wallMs: Math.round(wallMs),
  requestsPerSecond: Number((requests / (wallMs / 1000)).toFixed(2)),
  latencyMs: {
    p50: Number(percentile(0.5).toFixed(2)),
    p95: Number(percentile(0.95).toFixed(2)),
    p99: Number(percentile(0.99).toFixed(2)),
    max: Number(percentile(1).toFixed(2)),
  },
  statuses: Object.fromEntries([...statuses.entries()].sort(([a], [b]) => String(a).localeCompare(String(b)))),
  analyticsPool: {
    sampled: Boolean(metricsUrl),
    metricsUrl: metricsUrl ? metricsUrl.origin : null,
    pendingAtStart: before.pending,
    pendingAfterTraffic: afterTraffic.pending,
    pendingAtLastSample: lastSample.pending,
    peakOldestJobAgeSeconds: peakOldestAge,
    drainMs,
    drained: metricsUrl ? drainMs !== null : null,
  },
}, null, 2)}\n`);
