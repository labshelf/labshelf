// Supplies the clock and timers a folder lease runs on, injectable so tests drive time.
import { sleep } from "../../async/index.js";

export interface LeaseScheduler {
  now(): number;
  delay(ms: number): Promise<void>;
  /** Runs the task every `ms` until the returned stop function is called. */
  every(ms: number, task: () => void): () => void;
}

export const systemLeaseScheduler: LeaseScheduler = {
  now: () => Date.now(),
  delay: (ms) => sleep(ms),
  every: (ms, task) => {
    const handle = setInterval(task, ms);
    return () => clearInterval(handle);
  },
};
