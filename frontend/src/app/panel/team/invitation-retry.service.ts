import { DestroyRef, Injectable, inject, signal } from "@angular/core";

/** Component-local UX advice, never an authorization or rate-limit boundary. */
@Injectable()
export class InvitationRetryService {
  private readonly destroyRef = inject(DestroyRef);
  private readonly deadlines = signal<ReadonlyMap<string, number>>(new Map());
  private readonly now = signal(Date.now());
  private timer?: ReturnType<typeof setInterval>;

  constructor() {
    this.destroyRef.onDestroy(() => {
      clearInterval(this.timer);
      this.deadlines.set(new Map());
    });
  }

  remaining(workspaceId: number, email: string): number {
    const deadline = this.deadlines().get(this.key(workspaceId, email)) ?? 0;
    // Read the signal for rendering, but also use the current clock when called
    // by Enter/click after a background tab has throttled its interval.
    return Math.max(0, Math.ceil((deadline - Math.max(this.now(), Date.now())) / 1000));
  }

  defer(workspaceId: number, email: string, seconds: number | undefined): void {
    if (this.destroyRef.destroyed || seconds === undefined || !Number.isSafeInteger(seconds) || seconds <= 0) return;
    const now = Date.now();
    const deadline = now + seconds * 1000;
    if (!Number.isSafeInteger(deadline)) return;
    const key = this.key(workspaceId, email);
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

  label(seconds: number): string {
    if (seconds < 60) return `${seconds} s`;
    if (seconds < 3600) return `${Math.floor(seconds / 60)} min ${seconds % 60} s`;
    const minutes = Math.ceil(seconds / 60);
    return `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
  }

  private key(workspaceId: number, email: string): string {
    // Create and resend share the same recipient. Do not infer whether the
    // server exhausted recipient, actor, IP or global quota from a generic 429.
    return `${workspaceId}:${email.trim().toLowerCase()}`;
  }
}
