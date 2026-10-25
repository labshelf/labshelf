// Stores the reader preferences (VS Code's labshelf.reader.* settings) in bx.storage.local.
// Values pass through the shared normalizer; open reader tabs follow changes live.
import { normalizeReaderPrefs, type ReaderPrefs } from "@labshelf/core";
import { bx } from "../../platform";

const READER_PREFS_KEY = "labshelf.readerPrefs";

/**
 * @returns the stored preferences, every missing or invalid value replaced by its default.
 */
export async function loadReaderPrefs(): Promise<ReaderPrefs> {
  const raw = (await bx.storage.local.get(READER_PREFS_KEY)) as Record<string, unknown>;
  const stored = raw[READER_PREFS_KEY];
  return normalizeReaderPrefs(stored && typeof stored === "object" ? (stored as Record<string, unknown>) : null);
}

/**
 * Merges a patch into the stored preferences; the result is normalized before it is written.
 * @returns the preferences now stored.
 */
export async function saveReaderPrefs(patch: Partial<ReaderPrefs>): Promise<ReaderPrefs> {
  const next = normalizeReaderPrefs({ ...(await loadReaderPrefs()), ...patch });
  await bx.storage.local.set({ [READER_PREFS_KEY]: next });
  return next;
}

/**
 * Fires whenever another page (the options page) changes the stored preferences.
 * @returns a function that removes the listener.
 */
export function onReaderPrefsChange(cb: (prefs: ReaderPrefs) => void): () => void {
  const listener = (changes: Record<string, { newValue?: unknown }>, area: string): void => {
    if (area !== "local" || !(READER_PREFS_KEY in changes)) return;
    const value = changes[READER_PREFS_KEY]?.newValue;
    cb(normalizeReaderPrefs(value && typeof value === "object" ? (value as Record<string, unknown>) : null));
  };
  bx.storage.onChanged.addListener(listener);
  return () => bx.storage.onChanged.removeListener(listener);
}
