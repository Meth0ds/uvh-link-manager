/**
 * Lightweight in-process queue. The redirect response never waits on it.
 * Replaces Laravel queues in this Node runtime; documented in docs/deployment.md.
 */
type Job = () => void | Promise<void>;

const queue: Job[] = [];
let draining = false;

export function enqueue(job: Job): void {
  queue.push(job);
  drain();
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  while (queue.length > 0) {
    const job = queue.shift();
    if (!job) break;
    try {
      await job();
    } catch (err) {
      console.error("[queue] job failed", err);
    }
  }
  draining = false;
}
