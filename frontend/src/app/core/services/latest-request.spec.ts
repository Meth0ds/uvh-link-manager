import type { DestroyRef } from "@angular/core";
import { LatestRequest } from "./latest-request";

class FakeDestroyRef {
  private callbacks: Array<() => void> = [];

  onDestroy(callback: () => void): () => void {
    this.callbacks.push(callback);
    return () => { this.callbacks = this.callbacks.filter((item) => item !== callback); };
  }

  destroy(): void {
    for (const callback of this.callbacks) callback();
  }
}

describe("LatestRequest", () => {
  it("rejects superseded work and responses for another context", () => {
    const guard = new LatestRequest(new FakeDestroyRef() as unknown as DestroyRef);
    const first = guard.begin(1);
    const second = guard.begin(1);

    // Superseding work must stop the transport as well as reject its result.
    expect(first.signal.aborted).toBeTrue();
    expect(second.signal.aborted).toBeFalse();
    expect(guard.isCurrent(first, 1)).toBeFalse();
    expect(guard.isCurrent(second, 2)).toBeFalse();
    expect(guard.isCurrent(second, 1)).toBeTrue();
  });

  it("rejects all pending work after explicit invalidation", () => {
    const guard = new LatestRequest(new FakeDestroyRef() as unknown as DestroyRef);
    const request = guard.begin("workspace:1");
    guard.invalidate();
    expect(request.signal.aborted).toBeTrue();
    expect(guard.isCurrent(request, "workspace:1")).toBeFalse();
  });

  it("rejects a queued response after its injection context is destroyed", () => {
    const destroyRef = new FakeDestroyRef();
    const guard = new LatestRequest(destroyRef as unknown as DestroyRef);
    const request = guard.begin(1);
    destroyRef.destroy();
    expect(request.signal.aborted).toBeTrue();
    expect(guard.isCurrent(request, 1)).toBeFalse();
  });
});
