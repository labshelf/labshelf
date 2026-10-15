// Opens a paper in the reader page, one tab per paper, focusing an existing tab instead of opening a copy.
// PLATFORM: open tabs are found through extension.getViews, so no "tabs" permission is needed.
import { bx } from "../platform/browserApi";

export const READER_PAGE = "reader/index.html";

/** What each reader tab publishes on its window for readerTabs to find it. */
export interface ReaderWindowHandle {
  paperId: string;
  reveal(page?: number): Promise<void>;
}

declare global {
  interface Window { labshelfReader?: ReaderWindowHandle }
}

/**
 * @returns the extension URL of the reader page for a paper.
 */
export function readerUrl(paperId: string, page?: number): string {
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
  await bx.tabs.create({ url: readerUrl(paperId, page) });
}
