/** Pools promises, so scanning a large library never has thousands of file operations in flight at once. */
export type Limiter = <T>(task: () => Promise<T>) => Promise<T>;

/** @returns a function that runs at most `max` of the tasks passed to it at a time */
export function concurrencyLimit(max: number): Limiter {
  let running = 0;
  const waiting: Array<() => void> = [];
  return async <T>(task: () => Promise<T>): Promise<T> => {
    if (running >= max) {
      // The finishing task hands its slot to this one, so the count never exceeds `max`.
      await new Promise<void>((resolve) => waiting.push(resolve));
    } else {
      running++;
    }
    try {
      return await task();
    } finally {
      const next = waiting.shift();
      if (next) { next(); } else { running--; }
    }
  };
}
