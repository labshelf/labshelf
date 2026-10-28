// Holds the shares a window or page has open: one entry per share, the shares busy with a share, join or leave, and the change listeners; the app supplies its entry type, how an entry closes and what it releases.
import { createListeners } from "../../events/index.js";
import type { ShareConnection } from "./shareConnection.js";

export interface OpenShareRegistryOptions<Entry> {
  /** The connection the entry runs, or undefined while it runs none (a browser entry waiting for its tab lease). */
  connectionOf(entry: Entry): ShareConnection | undefined;
  /** Closes a removed entry; rejects when the close leaves an update unstored. */
  close(entry: Entry): Promise<void>;
  /** Runs as an entry leaves the registry, before the listeners hear of it; VS Code disposes the editor binding here. */
  onRelease?(entry: Entry): void;
}

export interface ShareCloseFailure {
  shareId: string;
  reason: unknown;
}

export interface OpenShareRegistry<Entry> {
  entry(shareId: string): Entry | undefined;
  entries(): Entry[];
  /** Puts the share's entry in place of any other; listeners hear of it only through `notify`. */
  set(shareId: string, entry: Entry): void;
  active(shareId: string): ShareConnection | undefined;
  list(): ShareConnection[];
  /** True while `hold` runs for the share; the project list then lags behind and must not be acted on. */
  isBusy(shareId: string): boolean;
  hold<T>(shareId: string, run: () => Promise<T>): Promise<T>;
  /** Drops the entry when it is still the share's, without closing it, and notifies. */
  release(shareId: string, entry: Entry): void;
  /** Drops the share's entry, notifies, then closes it; resolves at once when the share has none. */
  remove(shareId: string): Promise<void>;
  /** Drops every entry, closes them all, notifies once they settled and returns the closes that failed. */
  closeAll(): Promise<ShareCloseFailure[]>;
  onChange(listener: () => void): () => void;
  notify(): void;
  clearListeners(): void;
}

/** Empties the map, releases and closes every entry, waits for all to settle and returns the closes that failed. */
async function closeEntries<Entry>(entries: Map<string, Entry>, options: OpenShareRegistryOptions<Entry>): Promise<ShareCloseFailure[]> {
  const closing = [...entries.entries()];
  entries.clear();
  closing.forEach(([, entry]) => options.onRelease?.(entry));
  const results = await Promise.allSettled(closing.map(([, entry]) => options.close(entry)));
  return results.flatMap((result, index) => (result.status === "rejected" ? [{ shareId: closing[index]![0], reason: result.reason as unknown }] : []));
}

export function createShareRegistry<Entry>(options: OpenShareRegistryOptions<Entry>): OpenShareRegistry<Entry> {
  const entries = new Map<string, Entry>();
  const busy = new Set<string>();
  const listeners = createListeners();
  const notify = (): void => listeners.emit();
  const drop = (shareId: string, entry: Entry): void => {
    entries.delete(shareId);
    options.onRelease?.(entry);
    notify();
  };
  return {
    entry: (shareId) => entries.get(shareId),
    entries: () => [...entries.values()],
    set: (shareId, entry) => { entries.set(shareId, entry); },
    active: (shareId) => {
      const entry = entries.get(shareId);
      return entry === undefined ? undefined : options.connectionOf(entry);
    },
    list: () => [...entries.values()].flatMap((entry) => {
      const connection = options.connectionOf(entry);
      return connection ? [connection] : [];
    }),
    isBusy: (shareId) => busy.has(shareId),
    hold: async (shareId, run) => {
      busy.add(shareId);
      try {
        return await run();
      } finally {
        busy.delete(shareId);
      }
    },
    release: (shareId, entry) => {
      if (entries.get(shareId) === entry) drop(shareId, entry);
    },
    remove: async (shareId) => {
      const entry = entries.get(shareId);
      if (entry === undefined) return;
      drop(shareId, entry);
      await options.close(entry);
    },
    closeAll: async () => {
      const failures = await closeEntries(entries, options);
      notify();
      return failures;
    },
    onChange: (listener) => listeners.add(listener),
    notify,
    clearListeners: () => listeners.clear(),
  };
}
