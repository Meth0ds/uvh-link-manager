import { DestroyRef, NgZone } from "@angular/core";

/** One read at a known expiry, with no polling while the projection is current. */
export class ReadDeadline {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private deadline: number | null = null;

  constructor(private readonly destroyRef: DestroyRef, private readonly zone: NgZone,
    private readonly expired: () => void) {
    // A distant expiry must not hold Angular stability or every rendering turn.
    zone.runOutsideAngular(() => {
      if (typeof document !== "undefined") {
        document.addEventListener("visibilitychange", this.sync);
        window.addEventListener("focus", this.sync);
      }
    });
    destroyRef.onDestroy(() => {
      this.stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", this.sync);
        window.removeEventListener("focus", this.sync);
      }
    });
  }

  schedule(deadline: number | null): void {
    this.stop();
    if (this.destroyRef.destroyed || deadline === null || !Number.isFinite(deadline)) return;
    this.deadline = deadline;
    this.sync();
  }

  stop(): void {
    this.stopTimer();
    this.deadline = null;
  }

  private stopTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
  }

  private readonly sync = (): void => {
    this.stopTimer();
    if (this.destroyRef.destroyed || this.deadline === null || typeof document === "undefined" || document.hidden) return;
    const delay = this.deadline - Date.now();
    if (delay <= 0) {
      // Consume first: simultaneous focus/visibility events cannot repeat it.
      this.deadline = null;
      this.zone.run(this.expired);
      return;
    }
    // Native timeouts overflow past 2^31-1ms; chunks recheck the actual clock,
    // including a clock adjustment, without claiming an early expiration.
    this.zone.runOutsideAngular(() => {
      this.timer = setTimeout(this.sync, Math.min(2_147_483_647, Math.max(1, Math.ceil(delay))));
    });
  };
}
