// Opens a paper as a reader tab of the library page's workspace, never a browser tab of its own, and stores the reader preferences
// (VS Code's labshelf.reader.* settings) in bx.storage.local; shared by the reader, options and library pages.
// PLATFORM: open tabs are found through extension.getViews, so no "tabs" permission is needed.
import { normalizeReaderPrefs, type ReaderPrefs } from "@labshelf/core";
import { bx } from "../../platform";

const READER_PAGE = "reader/index.html";

/** What the library page publishes on its window so other extension pages open papers in its workspace. */
interface LibraryWorkspaceHandle {
  /** Opens or focuses the paper's tab in the workspace and brings the library's browser tab to the front. */
  openPaper(paperId: string, page?: number): Promise<void>;
}

declare global {
  interface Window { labshelfWorkspace?: LibraryWorkspaceHandle; labshelfLibraryDetails?: { reveal(paperId: string): Promise<void>; toggle(paperId: string): Promise<void> } }
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

const READ_PARAM = "read";

/** @returns the library page URL that opens the paper as a workspace tab once the page has loaded. */
function createLibraryReaderUrl(paperId: string, page?: number): string {
  const q = new URLSearchParams({ [READ_PARAM]: paperId });
  if (page && Number.isInteger(page) && page > 0) q.set("page", String(page));
  return `${bx.runtime.getURL("libraryPage/index.html")}?${q.toString()}`;
}

/**
 * Parses the library page's `?read=` query.
 * @returns the paper to open with its optional page, or null when the query names none.
 */
export function parseLibraryReadQuery(search: string): { paperId: string; page?: number } | null {
  const q = new URLSearchParams(search);
  const paperId = q.get(READ_PARAM)?.trim();
  if (!paperId) return null;
  const page = Number(q.get("page"));
  return Number.isInteger(page) && page > 0 ? { paperId, page } : { paperId };
}

/** Brings the browser tab running this page (the top page when called from a frame) to the front. */
export async function focusCurrentTab(): Promise<void> {
  const tab = await bx.tabs.getCurrent();
  if (tab?.id !== undefined) await bx.tabs.update(tab.id, { active: true });
  if (tab?.windowId !== undefined) await bx.windows.update(tab.windowId, { focused: true });
}

/** Hands the paper to the first open library page's workspace other than `except`; resolves false when there is none. */
async function openInOpenLibrary(paperId: string, page?: number, except?: Window): Promise<boolean> {
  const views = (bx.extension.getViews?.({ type: "tab" }) ?? []) as Window[];
  for (const view of views) {
    if (view === except) continue;
    let workspace: LibraryWorkspaceHandle | undefined;
    try { workspace = view.labshelfWorkspace; } catch { workspace = undefined; }
    if (workspace) {
      await workspace.openPaper(paperId, page);
      return true;
    }
  }
  return false;
}

/** Opens the paper in an open library page's workspace, else opens the library on it; resolves once the request is handed over. */
export async function openReader(paperId: string, page?: number): Promise<void> {
  if (await openInOpenLibrary(paperId, page)) return;
  await bx.tabs.create({ url: createLibraryReaderUrl(paperId, page) });
}

/** Hands the paper to another open library page and resolves true, or resolves false when this page is the only library. */
export function openInOtherLibrary(paperId: string, page?: number): Promise<boolean> {
  return openInOpenLibrary(paperId, page, globalThis.window as Window | undefined);
}

/**
 * For a reader page loaded as a browser tab of its own (an old bookmark or link): moves the paper into the library's workspace and closes this tab,
 * or turns this tab into the library when none is open.
 * @returns "moved" when an open library took the paper (this tab may stay if the browser refuses to close it), "replaced" when this tab navigates.
 */
export async function moveReaderIntoLibrary(paperId: string, page?: number): Promise<"moved" | "replaced"> {
  if (await openInOpenLibrary(paperId, page)) { window.close(); return "moved"; }
  location.replace(createLibraryReaderUrl(paperId, page));
  return "replaced";
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
