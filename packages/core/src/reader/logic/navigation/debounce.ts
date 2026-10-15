/**
 * Debounces calls on the trailing edge with an explicit flush, used for reading-state saves that must not be lost when the panel hides.
 */
export interface Debouncer<A extends unknown[]> {
  call(...args: A): void;
  /** Runs the pending call now, if any. */
  flush(): void;
  cancel(): void;
  readonly pending: boolean;
}

/**
 * @returns a debouncer that invokes `fn` with the latest arguments after `ms` of quiet.
 */
export function createDebouncer<A extends unknown[]>(
  fn: (...args: A) => void,
  ms: number,
): Debouncer<A> {
  let handle: ReturnType<typeof setTimeout> | null = null;
  let lastArgs: A | null = null;

  const run = (): void => {
    const args = lastArgs;
    handle = null;
    lastArgs = null;
    if (args) { fn(...args); }
  };

  return {
    call(...args: A): void {
      lastArgs = args;
      if (handle !== null) { clearTimeout(handle); }
      handle = setTimeout(run, ms);
    },
    flush(): void {
      if (handle === null) { return; }
      clearTimeout(handle);
      run();
    },
    cancel(): void {
      if (handle !== null) { clearTimeout(handle); }
      handle = null;
      lastArgs = null;
    },
    get pending(): boolean { return handle !== null; },
  };
}
