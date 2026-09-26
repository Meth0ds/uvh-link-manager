import { DestroyRef } from "@angular/core";

export interface AsyncPollerOptions {
  destroyRef: DestroyRef;
  /** Delay before each attempt; the last entry repeats (saturating ladder). */
  delays: readonly number[];
  /** Whether the operation still wants attempts; also gates resume-on-visible. */
  wantsMore: () => boolean;
  /**
   * Runs one attempt. Attempts never chain themselves: call `schedule()` from
   * here when another attempt is wanted, so a settled operation cannot leave a
   * timer behind.
   */
  attempt: () => void | Promise<void>;
  /** Pause while the tab is hidden and resume when it returns (default true). */
  pauseWhenHidden?: boolean;
}

/**
 * The shared polling/pause pattern behind every long-running read: one armed
 * attempt at a time, a delay ladder that saturates instead of growing without
 * bound, no probes while the tab is hidden, and total cleanup on destroy.
 *
 * A paused wait is never lost: returning to the tab runs the next attempt
 * immediately (with the ladder restarted) instead of making the person wait
 * again for work they can now see.
 */
export class AsyncPoller {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private step = 0;
  private readonly pauseWhenHidden: boolean;

  constructor(private readonly options: AsyncPollerOptions) {
    this.pauseWhenHidden = options.pauseWhenHidden ?? true;
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", this.syncVisibility);
      window.addEventListener("focus", this.syncVisibility);
    }
    options.destroyRef.onDestroy(() => {
      this.stop();
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", this.syncVisibility);
        window.removeEventListener("focus", this.syncVisibility);
      }
    });
  }

  /** Arms the next attempt after the current ladder delay. */
  schedule(): void {
    this.stopTimer();
    if (this.options.destroyRef.destroyed || typeof document === "undefined") return;
    if (!this.options.wantsMore()) return;
    if (this.pauseWhenHidden && document.hidden) return;
    const delays = this.options.delays;
    const delay = delays[Math.min(this.step, delays.length - 1)];
    this.step += 1;
    this.timer = setTimeout(() => {
      this.timer = null;
      // If the tab hid without an event, do not spend the request unseen; the
      // next visibility return resumes with an immediate attempt.
      if (this.pauseWhenHidden && typeof document !== "undefined" && document.hidden) return;
      void this.options.attempt();
    }, delay);
  }

  /** Forgets the ladder: the next wait is the first delay again. */
  reset(): void {
    this.step = 0;
  }

  /** Cancels any armed attempt; nothing reschedules afterwards. */
  stop(): void {
    this.stopTimer();
  }

  private stopTimer(): void {
    if (this.timer !== null) {
      clearTimeout(this.timer);
      this.timer = null;
    }
  }

  private readonly syncVisibility = (): void => {
    if (this.options.destroyRef.destroyed || typeof document === "undefined") return;
    if (document.hidden) {
      // Hiding cancels the pending attempt instead of firing it unseen.
      if (this.pauseWhenHidden) this.stopTimer();
      return;
    }
    // The tab came back: only a wait suppressed while hidden resumes, and only
    // when none is already armed and the operation still wants attempts.
    if (!this.pauseWhenHidden || this.timer !== null || !this.options.wantsMore()) return;
    this.reset();
    void this.options.attempt();
  };
}
