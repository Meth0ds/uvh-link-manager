/** Parse server advice without inventing a wait for absent/malformed headers. */
export function retryAfterSeconds(value: string | null, now = Date.now()): number | undefined {
  if (!value?.trim()) return undefined;
  const raw = value.trim();
  let seconds: number;
  if (/^\d+$/.test(raw)) {
    seconds = Number(raw);
  } else {
    // Accept the HTTP-date wire format, not Date.parse's permissive numeric
    // shorthand (for example "1.5", which could otherwise become a date).
    if (!/^(Mon|Tue|Wed|Thu|Fri|Sat|Sun), \d{2} (Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec) \d{4} \d{2}:\d{2}:\d{2} GMT$/.test(raw)) return undefined;
    const timestamp = Date.parse(raw);
    // Reject rolled-over calendar dates and inconsistent weekdays as malformed.
    if (!Number.isFinite(timestamp) || new Date(timestamp).toUTCString() !== raw) return undefined;
    seconds = Math.max(0, Math.ceil((timestamp - now) / 1000));
  }
  // Deadlines must remain exactly representable; never turn overflow into an
  // immediate retry or pass an unbounded delay to a browser timeout.
  return Number.isSafeInteger(seconds) && seconds >= 0
    && Number.isSafeInteger(now + seconds * 1000) ? seconds : undefined;
}
