import { DestroyRef, signal } from "@angular/core";

/** Formats a wait as the countdown labels do: "45 s", "1 min 0 s", "2 h 0 min". */
export function formatWaitLabel(seconds: number): string {
  if (seconds < 60) return `${seconds} s`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
  const minutes = Math.ceil(seconds / 60);
  return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

/**
 * Keyed Retry-After countdowns shared by every surface that turns a server
 * wait into a visible pause: invitations per recipient, API reads per account.
 *
 * This is component-local UX advice, never an authorization or rate-limit
 * boundary — the backend enforces its own limits across sessions and tabs.
 * Expiry merely permits the person to choose another attempt; no request is
 * scheduled here. The key decides who shares a wait, so callers must pick one
 * that matches the scope the server advice came from (do not infer whether the
 * server exhausted recipient, actor, IP or global quota from a generic 429).
 */
export class RetryCountdown {
  private readonly deadlines = signal<ReadonlyMap<string, number>>(new Map());
  private readonly now = signal(Date.now());
  private timer?: ReturnType<typeof setInterval>;

  constructor(private readonly destroyRef: DestroyRef) {
    this.destroyRef.onDestroy(() => {
      clearInterval(this.timer);
      this.deadlines.set(new Map());
    });
  }

  /**
   * Seconds left for `key`. Reads the clock again when called after a
   * throttled/background timer, so a stale tick can never shorten a wait.
   */
  remaining(key: string): number {
    const deadline = this.deadlines().get(key) ?? 0;
    return Math.max(0, Math.ceil((deadline - Math.max(this.now(), Date.now())) / 1000));
  }

  /** Records server advice: never shortens a known wait nor invents one. */
  defer(key: string, seconds: number | undefined): void {
    if (this.destroyRef.destroyed || seconds === undefined || !Number.isSafeInteger(seconds) || seconds <= 0) return;
    const now = Date.now();
    const deadline = now + seconds * 1000;
    // Deadlines must remain exactly representable; overflow is not advice.
    if (!Number.isSafeInteger(deadline)) return;
    const next = new Map(this.deadlines());
    next.set(key, Math.max(next.get(key) ?? 0, deadline));
    this.deadlines.set(next);
    this.now.set(now);
    // One short interval, irrespective of a day-long server wait. No request is
    // scheduled: expiry merely permits the person to choose another attempt.
    this.timer ??= setInterval(() => {
      const current = Date.now();
      this.now.set(current);
      const active = new Map([...this.deadlines()].filter(([, until]) => until > current));
      this.deadlines.set(active);
      if (active.size === 0) {
        clearInterval(this.timer);
        this.timer = undefined;
      }
    }, 1000);
  }
}
