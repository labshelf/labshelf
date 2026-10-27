/** Paces a run's requests to each host and bounds each resolver lookup's request. */
import { reportWarning, type FetchFn, type ResolverEnv } from "./finder.js";
import type { EngineLimits } from "./deadline.js";
import { sleep } from "../../async/index.js";
import { formatError } from "../../errors/index.js";

// Spaces the requests of one run to each host and stops asking a host that keeps refusing.
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

// Runs one bounded lookup against a service: a deadline, a read of the body, and a single WARN when it fails.
const LOOKUP_TIMEOUT_MS = 8000;
const JSON_HEADERS = { Accept: "application/json" };

type LookupResponse = Awaited<ReturnType<FetchFn>>;

/**
 * Fetches `url`, reads the response with `read` inside the deadline and returns the result.
 * @returns undefined, after one WARN with the URL and the status or error, on any failure
 */
async function timedFetch<T>(
  env: ResolverEnv,
  url: string,
  read: (res: LookupResponse) => Promise<T>,
  headers?: Record<string, string>,
): Promise<T | undefined> {
  try {
    const res = await env.fetch(url, { signal: AbortSignal.timeout(LOOKUP_TIMEOUT_MS), redirect: "follow", ...(headers ? { headers } : {}) });
    if (!res.ok) {
      reportWarning(env, "lookup failed", { url, status: res.status });
      return undefined;
    }
    return await read(res);
  } catch (error) {
    reportWarning(env, "lookup failed", { url, error: formatError(error) });
    return undefined;
  }
}

export function fetchResolverJson<T>(env: ResolverEnv, url: string, headers: Record<string, string> = {}): Promise<T | undefined> {
  return timedFetch(env, url, async (res) => (await res.json()) as T, { ...JSON_HEADERS, ...headers });
}

export function fetchResolverText(env: ResolverEnv, url: string): Promise<string | undefined> {
  return timedFetch(env, url, (res) => res.text());
}
