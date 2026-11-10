// The spell checkers of proofing: read and built once per dictionary store and language, with the frequency list and stems
// read beside each, and the English checker that accepts English terms in a document of another language.
import {
  createSpellChecker, parseFrequencyList, stemIndex, type CorrectionSources, type DictionaryStore, type FrequencyList, type SpellChecker,
} from "../../proofing/index.js";
import type { ILogger } from "../../../ports/index.js";

const LOG_MODULE = "proofing";

// ---------------------------------------------------------------- Checkers

export type LoadResult = { status: "ready"; checker: SpellChecker } | { status: "missing" } | { status: "failed"; error: string };

interface StoreCache {
  loads: Map<string, Promise<LoadResult>>;
  ready: Map<string, SpellChecker>;
}

const caches = new WeakMap<DictionaryStore, StoreCache>();
/** The word frequency list read with each checker's dictionary, when it had one. */
export const frequencies = new WeakMap<SpellChecker, FrequencyList>();
/** The bare stems of each checker's dictionary, which corrections may offer. */
const stemsOf = new WeakMap<SpellChecker, readonly string[]>();

/** The dictionary that also accepts English terms in a document of another language. */
const SECONDARY_TAG = "en-US";

/** The English checker of a store for documents in another language, with its verdicts per word; null once it could not load. */
interface Secondary { checker: SpellChecker | null; verdicts: Map<string, boolean> }

const secondaries = new WeakMap<DictionaryStore, Promise<Secondary>>();
const secondaryReady = new WeakMap<DictionaryStore, Secondary>();

export function cacheOf(store: DictionaryStore): StoreCache {
  let cache = caches.get(store);
  if (!cache) {
    cache = { loads: new Map(), ready: new Map() };
    caches.set(store, cache);
  }
  return cache;
}

function messageOf(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  return message.trim().replace(/\.$/, "") || "unknown error";
}

/** The checker of `tag` in `store`, read and built once; a missing or failed load is tried again next time, and a failure is logged. */
export function loadChecker(store: DictionaryStore, tag: string, logger: ILogger | undefined): Promise<LoadResult> {
  const cache = cacheOf(store);
  const existing = cache.loads.get(tag);
  if (existing) return existing;
  const load = (async (): Promise<LoadResult> => {
    try {
      const files = await store.read(tag);
      if (!files) return { status: "missing" };
      const checker = await createSpellChecker(files, await store.userWords());
      if (files.freq) frequencies.set(checker, parseFrequencyList(files.freq));
      stemsOf.set(checker, stemIndex(files.dic).stems);
      cache.ready.set(tag, checker);
      return { status: "ready", checker };
    } catch (error: unknown) {
      if (logger) void logger.error(LOG_MODULE, error, { action: "start spell checker", language: tag });
      return { status: "failed", error: messageOf(error) };
    }
  })();
  cache.loads.set(tag, load);
  void load.then((result) => { if (result.status !== "ready" && cache.loads.get(tag) === load) cache.loads.delete(tag); });
  return load;
}

/** Whether `word` is English in a non-English document; undefined while the English checker loads, which starts it. */
export function secondaryAccepts(store: DictionaryStore, logger: ILogger | undefined, word: string, onReady: () => void): boolean | undefined {
  const ready = secondaryReady.get(store);
  if (ready) {
    if (!ready.checker) return false;
    let verdict = ready.verdicts.get(word);
    if (verdict === undefined) ready.verdicts.set(word, (verdict = ready.checker.check(word)));
    return verdict;
  }
  let load = secondaries.get(store);
  if (!load) {
    load = loadChecker(store, SECONDARY_TAG, logger).then((result) => {
      const secondary: Secondary = { checker: result.status === "ready" ? result.checker : null, verdicts: new Map() };
      secondaryReady.set(store, secondary);
      return secondary;
    });
    secondaries.set(store, load);
  }
  void load.then(onReady);
  return undefined;
}

export function correctionSources(checker: SpellChecker): CorrectionSources {
  return { frequency: frequencies.get(checker), stems: stemsOf.get(checker) };
}
