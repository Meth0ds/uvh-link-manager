/**
 * Lightweight in-process queue. The redirect response never waits on it.
 * Bounded (sheds load past a backlog cap) and yields to the event loop
 * periodically so a click flood cannot stall request handling.
 */
type Job = () => void | Promise<void>;

const MAX_QUEUE = 10_000;
const queue: Job[] = [];
let head = 0;
let draining = false;

export function enqueue(job: Job): void {
  if (queue.length - head >= MAX_QUEUE) return; // shed load instead of growing unbounded
  queue.push(job);
  void drain();
}

async function drain(): Promise<void> {
  if (draining) return;
  draining = true;
  try {
    while (head < queue.length) {
      const job = queue[head++]!;
      try {
        await job();
      } catch (err) {
        console.error("[queue] job failed", err);
      }
      if ((head & 31) === 0) {
        await new Promise((resolve) => setImmediate(resolve));
      }
    }
    queue.length = 0;
    head = 0;
  } finally {
    draining = false;
  }
}
