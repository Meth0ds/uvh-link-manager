import { parseHttpDate } from "../strict-wire";

/** Parse server advice without inventing a wait for absent/malformed headers. */
export function retryAfterSeconds(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const raw = value.trim();
  let seconds: number;
  if (/^\d+$/.test(raw)) {
    seconds = Number(raw);
  } else {
    // The HTTP-date grammar and its wire tolerance live in `strict-wire`;
    // what remains here is Retry-After policy: how a deadline becomes a wait.
    const timestamp = parseHttpDate(raw);
    if (timestamp === null) return undefined;
    seconds = Math.max(0, Math.ceil((timestamp - now) / 1000));
  }
  // Deadlines must remain exactly representable; never turn overflow into an
  // immediate retry or pass an unbounded delay to a browser timeout.
  return Number.isSafeInteger(seconds) && seconds >= 0
    && Number.isSafeInteger(now + seconds * 1000) ? seconds : undefined;
}
