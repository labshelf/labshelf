// Runs tasks one at a time per key, so load-modify-save cycles on one key never interleave.

/** Serialises tasks per key; a failed task does not poison the tasks queued behind it. */
export class KeyedQueue {
  private readonly queues = new Map<string, Promise<unknown>>();

  run<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve();
    const next = previous.then(task, task);
    const settled = next.catch(() => undefined);
    this.queues.set(key, settled);
    void settled.then(() => {
      if (this.queues.get(key) === settled) { this.queues.delete(key); }
    });
    return next;
  }
}
