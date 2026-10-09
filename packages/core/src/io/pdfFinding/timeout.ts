/** A deadline for one network operation: an abort signal that fires after `ms`, and a way to stop the clock. */

export interface Deadline {
  signal: AbortSignal;
  stop(): void;
}

export function startTimeout(ms: number): Deadline {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), ms);
  return { signal: controller.signal, stop: () => clearTimeout(timer) };
}
