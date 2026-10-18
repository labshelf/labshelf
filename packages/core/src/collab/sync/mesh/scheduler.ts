// Declares the clock a share session times acks, resends and background sync with, and the system one.

export interface SessionScheduler {
  now(): number;
  /** Runs `fn` once after `ms`; the returned function cancels it. */
  after(ms: number, fn: () => void): () => void;
}

export const systemScheduler: SessionScheduler = {
  now: () => Date.now(),
  after: (ms, fn) => {
    const handle = setTimeout(fn, ms);
    return () => clearTimeout(handle);
  },
};

/** Runs `fn` every `ms` until the returned function is called. */
export function every(scheduler: SessionScheduler, ms: number, fn: () => void): () => void {
  let cancel = scheduler.after(ms, tick);
  function tick(): void {
    cancel = scheduler.after(ms, tick);
    fn();
  }
  return () => cancel();
}
