import type { DestroyRef } from "@angular/core";

/** Opaque identity for one asynchronous view request. */
export interface ViewRequest {
  readonly revision: number;
  readonly context: string | number | null;
}

/**
 * Prevents a late response from updating a destroyed view or a new security
 * context. HTTP cancellation is useful for efficiency; this guard is still
 * required because a response may already be queued when cancellation runs.
 */
export class LatestRequest {
  private revision = 0;
  private destroyed = false;

  constructor(destroyRef: DestroyRef) {
    destroyRef.onDestroy(() => {
      this.destroyed = true;
      this.invalidate();
    });
  }

  begin(context: ViewRequest["context"]): ViewRequest {
    return { revision: ++this.revision, context };
  }

  invalidate(): void {
    ++this.revision;
  }

  isCurrent(request: ViewRequest, context: ViewRequest["context"]): boolean {
    return !this.destroyed && request.revision === this.revision && request.context === context;
  }
}
