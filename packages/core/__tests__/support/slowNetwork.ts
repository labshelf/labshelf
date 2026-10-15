/** A fake network whose answers take time and honour cancellation, with the limits that keep engine tests fast. */
import type { EngineLimits } from "../../src/import/pdfFinding/engine/index";
import type { ResolverEnv } from "../../src/import/pdfFinding/types";
import { makeFindingHarness, type LogCall } from "./pdfFindingHarness";

/** Tens of milliseconds instead of seconds; each test overrides the limit it exercises. */
export const FAST_LIMITS: EngineLimits = {
  lookupCapMs: 2_000, concurrency: 3, firstByteMs: 2_000, perUrlMs: 2_000, totalMs: 5_000, holdMs: 200, hostGapMs: 0, hostMaxFailures: 5,
};

export interface SlowRoute { ms?: number; res: () => Response }

export interface SlowNetwork {
  routes: Record<string, SlowRoute>;
  /** Every request, in order, with its start time and Referer. */
  calls: Array<{ url: string; at: number; referer?: string }>;
  /** URLs whose request was cancelled before it answered. */
  cancelled: string[];
  maxInFlight(): number;
  env: ResolverEnv;
  logs: LogCall[];
}

export function makeSlowNetwork(): SlowNetwork {
  const routes: Record<string, SlowRoute> = {};
  const calls: SlowNetwork["calls"] = [];
  const cancelled: string[] = [];
  const base = makeFindingHarness();
  let inFlight = 0;
  let peak = 0;
  const fetchSlow = async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const url = String(input);
    const referer = (init?.headers as Record<string, string> | undefined)?.["Referer"];
    calls.push({ url, at: Date.now(), ...(referer ? { referer } : {}) });
    inFlight++;
    peak = Math.max(peak, inFlight);
    try {
      const route = routes[url];
      await new Promise<void>((resolve, reject) => {
        const signal = init?.signal ?? undefined;
        const timer = setTimeout(resolve, route?.ms ?? 0);
        signal?.addEventListener("abort", () => { clearTimeout(timer); cancelled.push(url); reject(signal.reason); }, { once: true });
      });
      return route?.res() ?? new Response("not found", { status: 404 });
    } finally {
      inFlight--;
    }
  };
  return { routes, calls, cancelled, maxInFlight: () => peak, env: { fetch: fetchSlow as typeof fetch, logger: base.logger }, logs: base.logs };
}

/** A response that reports `url` as its final address, as a followed redirect does. */
export function redirectedTo(url: string, body: string): Response {
  const res = new Response(body, { headers: { "content-type": "text/html" } });
  Object.defineProperty(res, "url", { value: url });
  return res;
}

export async function* candidatesOf(...urls: string[]): AsyncGenerator<{ url: string; source: string }, void, undefined> {
  for (const url of urls) yield { url, source: `s:${new URL(url).host}` };
}
