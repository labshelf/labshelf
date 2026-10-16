// Opens the page that stood in the way of a paper's PDF in a visible tab, and attaches the PDF once the user gets through.
import { errorMessage, type ILogger, type PdfAccess } from "@labshelf/core";
import { bx } from "../../platform";
import { dropWatch, saveWatch, watchOfPaper, watchOfTab } from "./accessWatches";
import { pdfInTab } from "./pdfInTab";

const MODULE = "capture";
// Long enough to sign in through an institution's single sign-on, short enough that a forgotten tab stops costing.
const WATCH_MS = 5 * 60_000;

export interface AccessTabDeps {
  log: ILogger;
  /** Writes the PDF into the paper; resolves to whether it was written (a PDF that arrived meanwhile is kept). */
  attach(paperId: string, bytes: Uint8Array): Promise<boolean>;
}

/** Opens `access.url` for the paper, or brings back the tab already open for it, and watches it for the PDF. */
export async function openAccessTab(deps: AccessTabDeps, paper: { id: string; title: string }, access: PdfAccess): Promise<void> {
  const open = await watchOfPaper(paper.id);
  if (open) {
    if (await bx.tabs.update(open.tabId, { active: true }).catch(() => undefined)) return;
    await dropWatch(open.tabId);
  }
  const tab = await bx.tabs.create({ url: access.url, active: true });
  if (tab.id === undefined) throw new Error("The browser did not open a tab for the publisher's page.");
  await saveWatch({ tabId: tab.id, paperId: paper.id, title: paper.title, until: Date.now() + WATCH_MS });
  void deps.log.log("INFO", MODULE, "watching a tab for the PDF", { paperId: paper.id, kind: access.kind, url: access.url });
  // The page may have finished loading before the watch was stored, as it does when the user is already signed in.
  const now = await bx.tabs.get(tab.id).catch(() => undefined);
  if (now?.status === "complete" && now.url) await onTabLoaded(deps, tab.id, now.url);
}

const checking = new Set<number>();

/**
 * Checks a watched tab each time a page in it finishes loading, and attaches the PDF it yields. The background
 * registers this on `tabs.onUpdated` at its top level, so a sleeping service worker wakes for it.
 */
export async function onTabLoaded(deps: AccessTabDeps, tabId: number, url: string): Promise<void> {
  const watch = await watchOfTab(tabId);
  if (!watch || checking.has(tabId)) return;
  if (Date.now() > watch.until) {
    await dropWatch(tabId);
    void deps.log.log("INFO", MODULE, "stopped watching a tab: time limit", { paperId: watch.paperId, url });
    return;
  }
  checking.add(tabId);
  try {
    const pdf = await pdfInTab(deps.log, tabId, url, watch.title);
    if (!pdf) return;
    await dropWatch(tabId);
    const written = await deps.attach(watch.paperId, pdf.bytes);
    void deps.log.log("INFO", MODULE, "watched tab yielded the PDF", { paperId: watch.paperId, url: pdf.url, written });
  } catch (error) {
    void deps.log.log("WARN", MODULE, "watched tab check failed", { paperId: watch.paperId, url, error: errorMessage(error) });
  } finally {
    checking.delete(tabId);
  }
}
