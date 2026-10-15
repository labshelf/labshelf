/** Runs one bounded lookup against a service: a deadline, a read of the body, and a single WARN when it fails. */
import { warn } from "../env.js";
import { startTimeout } from "../timeout.js";
import type { FetchFn, ResolverEnv } from "../types.js";

const LOOKUP_TIMEOUT_MS = 8000;
const JSON_HEADERS = { Accept: "application/json" };

export type LookupResponse = Awaited<ReturnType<FetchFn>>;

/**
 * Fetches `url`, reads the response with `read` inside the deadline and returns the result.
 * @returns undefined, after one WARN with the URL and the status or error, on any failure
 */
export async function timedFetch<T>(
  env: ResolverEnv,
  url: string,
  read: (res: LookupResponse) => Promise<T>,
  headers?: Record<string, string>,
): Promise<T | undefined> {
  const timer = startTimeout(LOOKUP_TIMEOUT_MS);
  try {
    const res = await env.fetch(url, { signal: timer.signal, redirect: "follow", ...(headers ? { headers } : {}) });
    if (!res.ok) {
      warn(env, "lookup failed", { url, status: res.status });
      return undefined;
    }
    return await read(res);
  } catch (error) {
    warn(env, "lookup failed", { url, error: error instanceof Error ? error.message : String(error) });
    return undefined;
  } finally {
    timer.stop();
  }
}

export function lookupJson<T>(env: ResolverEnv, url: string, headers: Record<string, string> = {}): Promise<T | undefined> {
  return timedFetch(env, url, async (res) => (await res.json()) as T, { ...JSON_HEADERS, ...headers });
}

export function lookupText(env: ResolverEnv, url: string): Promise<string | undefined> {
  return timedFetch(env, url, (res) => res.text());
}
