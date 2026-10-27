/** Spaces the requests of one run to each host and stops asking a host that keeps refusing. */
import type { FetchFn } from "../pdfResolver.js";
import type { EngineLimits } from "./limits.js";

type PacerLimits = Pick<EngineLimits, "hostGapMs" | "hostMaxFailures">;

/** Wraps `fetchFn` so requests to one host start at least `hostGapMs` apart, and throws for a host that failed too often. */
export function createPacedFetch(fetchFn: FetchFn, limits: PacerLimits): FetchFn {
  const nextSlot = new Map<string, number>();
  const failures = new Map<string, number>();
  const fail = (host: string): void => { failures.set(host, (failures.get(host) ?? 0) + 1); };
  return async (input, init) => {
    const host = hostKeyOf(input);
    if ((failures.get(host) ?? 0) >= limits.hostMaxFailures) {
      throw new Error(`${host} skipped after ${limits.hostMaxFailures} failed requests`);
    }
    const now = Date.now();
    const slot = Math.max(now, nextSlot.get(host) ?? 0);
    nextSlot.set(host, slot + limits.hostGapMs);
    await sleep(slot - now, init?.signal ?? undefined);
    try {
      const res = await fetchFn(input, init);
      if (res.status >= 400) fail(host);
      else failures.delete(host);
      return res;
    } catch (error) {
      // A request the run itself cancelled says nothing about the host; a timeout does.
      if ((error as { name?: unknown } | null)?.name !== "AbortError") fail(host);
      throw error;
    }
  };
}

function hostKeyOf(input: Parameters<FetchFn>[0]): string {
  const url = input instanceof Request ? input.url : String(input);
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

function sleep(ms: number, signal: AbortSignal | undefined): Promise<void> {
  if (signal?.aborted) return Promise.reject(signal.reason);
  if (ms <= 0) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const timer = setTimeout(resolve, ms);
    signal?.addEventListener("abort", () => { clearTimeout(timer); reject(signal.reason); }, { once: true });
  });
}
