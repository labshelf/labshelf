// The machine-local spelling dictionaries of the library page: en-US and pt-BR ship beside the page, downloaded ones and the user's words live in the "labshelf-dictionaries" IndexedDB, outside the library files.
import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import { DICTIONARY_CATALOG, fetchDictionary, formatError, type DictionaryFetch, type DictionaryFiles, type DictionaryStore, type ILogger } from "@labshelf/core";

const MODULE = "storage.dictionaries";
const BUNDLED_TAGS: readonly string[] = DICTIONARY_CATALOG.filter((entry) => entry.bundled).map((entry) => entry.tag);

interface DictionarySchema extends DBSchema {
  /** A downloaded dictionary, by BCP-47 tag. */
  files: { key: string; value: DictionaryFiles };
  /** The user's words, by word; the value is a sequence number (the largest stored + 1), which keeps them in the order they were added. */
  words: { key: string; value: number };
}

export interface IdbDictionaryStoreOptions {
  /** The download function; the page's fetch. */
  fetchFn: DictionaryFetch;
  /** The URL the bundled `dictionaries/<tag>/` folders are relative to; the library page's own URL. */
  baseUrl: string;
  logger: ILogger;
}

export class IdbDictionaryStore implements DictionaryStore {
  private db: Promise<IDBPDatabase<DictionarySchema>> | undefined;

  constructor(private readonly options: IdbDictionaryStoreOptions) {}

  private open(): Promise<IDBPDatabase<DictionarySchema>> {
    this.db ??= openDB<DictionarySchema>("labshelf-dictionaries", 1, {
      upgrade: (database) => {
        database.createObjectStore("files");
        database.createObjectStore("words");
      },
      terminated: () => { this.db = undefined; },
    });
    return this.db;
  }

  /** The bundled dictionary of a tag, read by a URL relative to the page; null when the build does not carry it. */
  private async readBundled(tag: string): Promise<DictionaryFiles | null> {
    const { fetchFn, baseUrl } = this.options;
    const load = async (file: string): Promise<Uint8Array | null> => {
      const response = await fetchFn(new URL(`dictionaries/${tag}/${file}`, baseUrl).href);
      return response.ok ? new Uint8Array(await response.arrayBuffer()) : null;
    };
    // The frequency list is optional: completions rank by the document alone without it.
    const [aff, dic, freq] = await Promise.all([load("index.aff"), load("index.dic"), load("frequency.txt").catch(() => null)]);
    if (!aff || !dic) { return null; }
    return freq ? { aff, dic, freq } : { aff, dic };
  }

  async list(): Promise<string[]> {
    const installed = await (await this.open()).getAllKeys("files");
    return [...new Set([...BUNDLED_TAGS, ...installed])].sort();
  }

  async read(tag: string): Promise<DictionaryFiles | null> {
    if (BUNDLED_TAGS.includes(tag)) { return this.readBundled(tag); }
    return (await (await this.open()).get("files", tag)) ?? null;
  }

  async install(tag: string): Promise<void> {
    if (await this.read(tag)) { return; }
    const { fetchFn, logger } = this.options;
    try {
      // The files are fetched whole before the one transaction, so a failure leaves nothing stored.
      const files = await fetchDictionary(tag, fetchFn);
      const tx = (await this.open()).transaction("files", "readwrite");
      await Promise.all([tx.store.put(files, tag), tx.done]);
    } catch (error) {
      void logger.error(MODULE, error, { action: "installDictionary", tag });
      throw new Error(formatError(error), { cause: error });
    }
  }

  async userWords(): Promise<string[]> {
    try {
      const tx = (await this.open()).transaction("words");
      const [keys, added] = await Promise.all([tx.store.getAllKeys(), tx.store.getAll()]);
      return keys.map((word, index) => ({ word, at: added[index] ?? 0 })).sort((a, b) => a.at - b.at).map((entry) => entry.word);
    } catch (error) {
      void this.options.logger.error(MODULE, error, { action: "readUserWords" });
      throw new Error(`Could not read your dictionary words: ${formatError(error)}`, { cause: error });
    }
  }

  async addUserWord(word: string): Promise<void> {
    const clean = word.trim();
    if (clean === "" || /[\r\n]/.test(clean)) { throw new Error("A dictionary word is one word on one line."); }
    try {
      const tx = (await this.open()).transaction("words", "readwrite");
      // Adding a known word keeps its first place; a new one takes the next sequence number, read in this same transaction.
      if ((await tx.store.getKey(clean)) === undefined) {
        const order = await tx.store.getAll();
        await tx.store.put(order.reduce((max, at) => Math.max(max, at), 0) + 1, clean);
      }
      await tx.done;
    } catch (error) {
      void this.options.logger.error(MODULE, error, { action: "addUserWord" });
      throw new Error(`Could not save "${clean}" to your dictionary: ${formatError(error)}`, { cause: error });
    }
  }
}

let shared: IdbDictionaryStore | undefined;

/** The library page's one store, so every editor shares its checkers. */
export function browserDictionaryStore(logger: ILogger): DictionaryStore {
  // PLATFORM: the page's fetch, called unbound it throws "Illegal invocation".
  shared ??= new IdbDictionaryStore({ fetchFn: (url) => fetch(url), baseUrl: document.baseURI, logger });
  return shared;
}
