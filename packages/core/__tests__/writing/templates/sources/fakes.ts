/** Supplies an in-memory template cache, a scripted fetch and a logger that records every call with its context. */
import type { ILogger } from "../../../../src/ports/index";
import type { CachedIndex, CachedSourceId, FetchLike, TemplateCache } from "../../../../src/writing/templates/sources/index.js";

export interface MemoryCache extends TemplateCache {
  store: Map<CachedSourceId, CachedIndex>;
  writes: Array<{ source: CachedSourceId; index: CachedIndex }>;
}

export function memoryCache(initial: Partial<Record<CachedSourceId, CachedIndex>> = {}): MemoryCache {
  const store = new Map<CachedSourceId, CachedIndex>(Object.entries(initial) as Array<[CachedSourceId, CachedIndex]>);
  const writes: MemoryCache["writes"] = [];
  return {
    store, writes,
    readIndex: async (source) => store.get(source),
    writeIndex: async (source, index) => { writes.push({ source, index }); store.set(source, index); },
  };
}

export interface ContextLogger extends ILogger {
  calls: Array<{ level: string; message: string; context: Record<string, unknown> | undefined }>;
  /** Everything logged, flattened to text, for "the log names the url" assertions. */
  text(): string;
}

export function contextLogger(): ContextLogger {
  const calls: ContextLogger["calls"] = [];
  return {
    calls,
    log: async (level, _module, message, context) => { calls.push({ level, message, context }); },
    error: async (_module, error, context) => {
      calls.push({ level: "error", message: error instanceof Error ? error.message : String(error), context });
    },
    text: () => JSON.stringify(calls),
  };
}

export interface FetchCall { url: string; headers: Record<string, string> }
export type Reply = Response | Error | ((call: FetchCall) => Response | Error);

/** A fetch that answers per url (string match on the whole url) and records each request. */
export function scriptedFetch(replies: Record<string, Reply | Reply[]>): FetchLike & { calls: FetchCall[] } {
  const calls: FetchCall[] = [];
  const queues = new Map<string, Reply[]>(Object.entries(replies).map(([k, v]) => [k, Array.isArray(v) ? [...v] : [v]]));
  const fetchFn = (async (url: string, init?: { signal?: AbortSignal; headers?: Record<string, string> }) => {
    const call = { url, headers: init?.headers ?? {} };
    calls.push(call);
    if (init?.signal?.aborted) { throw new DOMException("aborted", "AbortError"); }
    const queue = queues.get(url);
    if (queue === undefined) { return new Response("not found", { status: 404 }); }
    const reply = queue.length > 1 ? queue.shift()! : queue[0]!;
    const result = typeof reply === "function" ? reply(call) : reply;
    if (result instanceof Error) { throw result; }
    return result.clone();
  }) as FetchLike & { calls: FetchCall[] };
  fetchFn.calls = calls;
  return fetchFn;
}
