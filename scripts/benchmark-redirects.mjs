#!/usr/bin/env node

import { performance } from "node:perf_hooks";

const args = Object.fromEntries(process.argv.slice(2).map((entry) => {
  const [key, value = ""] = entry.replace(/^--/, "").split("=", 2);
  return [key, value];
}));

const url = new URL(args.url ?? "");
const requests = Number.parseInt(args.requests ?? "1000", 10);
const concurrency = Number.parseInt(args.concurrency ?? "20", 10);
const timeoutMs = Number.parseInt(args.timeout ?? "5000", 10);
const local = ["localhost", "127.0.0.1", "::1"].includes(url.hostname) || url.hostname.endsWith(".localhost");

if ((url.protocol !== "https:" && !(local && url.protocol === "http:"))
  || url.username || url.password || url.hash
  || !Number.isSafeInteger(requests) || requests < 1 || requests > 100_000
  || !Number.isSafeInteger(concurrency) || concurrency < 1 || concurrency > 500
  || !Number.isSafeInteger(timeoutMs) || timeoutMs < 100 || timeoutMs > 60_000) {
  throw new Error("Use --url=https://host/alias [--requests=1000] [--concurrency=20] [--timeout=5000]");
}

const durations = [];
const statuses = new Map();
let cursor = 0;

async function worker() {
  while (cursor < requests) {
    cursor += 1;
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

const wallStarted = performance.now();
await Promise.all(Array.from({ length: Math.min(concurrency, requests) }, () => worker()));
const wallMs = performance.now() - wallStarted;
durations.sort((a, b) => a - b);

function percentile(value) {
  return durations[Math.min(durations.length - 1, Math.ceil(durations.length * value) - 1)];
}

// Deliberately omit the alias/query from the artifact: capacity evidence must
// not turn a private or single-use test URL into a log disclosure.
process.stdout.write(`${JSON.stringify({
  targetOrigin: url.origin,
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
}, null, 2)}\n`);
