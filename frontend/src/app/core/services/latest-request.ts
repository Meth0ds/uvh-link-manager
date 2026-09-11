import type { DestroyRef } from "@angular/core";

/** Opaque identity for one asynchronous view request. */
export interface ViewRequest {
  readonly revision: number;
  readonly context: string | number | null;
  /** Cancels the associated read when its view/context is superseded. */
  readonly signal: AbortSignal;
}

/**
 * Prevents a late response from updating a destroyed view or a new security
 * context. HTTP cancellation is useful for efficiency; this guard is still
 * required because a response may already be queued when cancellation runs.
 */
export class LatestRequest {
  private revision = 0;
  private destroyed = false;
  private activeController: AbortController | null = null;

  constructor(destroyRef: DestroyRef) {
    destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.invalidate();
    });
  }

  begin(context: ViewRequest["context"]): ViewRequest {
    this.activeController?.abort();
    this.activeController = new AbortController();
    return { revision: ++this.revision, context, signal: this.activeController.signal };
  }

  invalidate(): void {
    this.activeController?.abort();
    this.activeController = null;
    ++this.revision;
  }

  isCurrent(request: ViewRequest, context: ViewRequest["context"]): boolean {
    return !this.destroyed && request.revision === this.revision && request.context === context;
  }
}
