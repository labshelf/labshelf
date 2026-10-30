// Opens a paper in the reader page, one tab per paper, focusing an existing tab instead of opening a copy, and stores the reader preferences
// (VS Code's labshelf.reader.* settings) in bx.storage.local; shared by the reader, options and library pages.
// PLATFORM: open tabs are found through extension.getViews, so no "tabs" permission is needed.
import { normalizeReaderPrefs, type ReaderPrefs } from "@labshelf/core";
import { bx } from "../../platform";

const READER_PAGE = "reader/index.html";

/** What each reader tab publishes on its window for readerTabs to find it. */
interface ReaderWindowHandle {
  paperId: string;
  reveal(page?: number): Promise<void>;
}

declare global {
  interface Window { labshelfReader?: ReaderWindowHandle; labshelfLibraryDetails?: { reveal(paperId: string): Promise<void>; toggle(paperId: string): Promise<void> } }
}

/**
 * @returns the extension URL of the reader page for a paper.
 */
export function createReaderUrl(paperId: string, page?: number): string {
  const q = new URLSearchParams({ paper: paperId });
  if (page && Number.isInteger(page) && page > 0) q.set("page", String(page));
  return `${bx.runtime.getURL(READER_PAGE)}?${q.toString()}`;
}

/**
 * Parses the reader page's query string.
 * @returns the paper id (null when absent) and an optional page.
 */
export function parseReaderQuery(search: string): { paperId: string | null; page?: number } {
  const q = new URLSearchParams(search);
  const paperId = q.get("paper")?.trim() || null;
  const page = Number(q.get("page"));
  return Number.isInteger(page) && page > 0 ? { paperId, page } : { paperId };
}

/** Resolves once the paper's reader tab is in front. */
export async function openReader(paperId: string, page?: number): Promise<void> {
  const views = (bx.extension.getViews?.({ type: "tab" }) ?? []) as Window[];
  for (const view of views) {
    let handle: ReaderWindowHandle | undefined;
    try { handle = view.labshelfReader; } catch { handle = undefined; }
    if (handle?.paperId === paperId) {
      await handle.reveal(page);
      return;
    }
  }
  await bx.tabs.create({ url: createReaderUrl(paperId, page) });
}

/** Toggles the Details of the library framing this reader, else of an open library, else opens the library with this paper selected. */
export async function toggleLibraryDetails(paperId: string): Promise<void> {
  const self = globalThis.window as Window | undefined;
  const framing = self && self.parent !== self ? self.parent.labshelfLibraryDetails : undefined;
  if (framing) { await framing.toggle(paperId); return; }
  const views = (bx.extension.getViews?.({ type: "tab" }) ?? []) as Window[];
  for (const view of views) {
    if (view.labshelfLibraryDetails) { await view.labshelfLibraryDetails.toggle(paperId); return; }
  }
  const query = new URLSearchParams({ paper: paperId, details: "1" });
  await bx.tabs.create({ url: `${bx.runtime.getURL("libraryPage/index.html")}?${query}` });
}

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
export async function writeReaderPrefs(patch: Partial<ReaderPrefs>): Promise<ReaderPrefs> {
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
