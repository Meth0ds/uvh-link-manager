/**
 * The verdict of the run.
 *
 * One owner for the result list, so every module's `check()` lands in the same
 * tally, plus the two waiting primitives the scenarios share. Nothing here
 * knows about the application.
 */

export const results = [];

export function check(name, ok, detail = "") {
  results.push({ name, ok: Boolean(ok), detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name}${detail ? ` — ${detail}` : ""}`);
  return Boolean(ok);
}

export const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

export async function until(label, probe, { deadlineMs = 60_000, intervalMs = 400 } = {}) {
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
