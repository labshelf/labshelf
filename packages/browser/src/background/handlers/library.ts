// Handles the library.folders/library.lookup/library.open, paper.findPdf (with or without replace)/paper.remove and
// tabs.list runtime messages.
import { bx } from "../../platform";
import type {
  AttachPdfReply, FolderOption, FoldersReply, LibraryFindReply, LibraryFindItem, RuntimeMessage, TabSummary,
} from "../../platform";
import { readSettings } from "../../platform";
import { attachPdfToPaper, createDraftFromPaper, findPdf, normalizeFolder, derivePdfMiss } from "../../capture/index";
import { attachFoundPdf } from "./capture";
import { listCachedPaperRecords, buildFolderTree, listPdfDirs } from "../../storage";
import type { LibraryMutations } from "../../storage";
import { removePaperDrafts } from "../draftCache";
import { sendLibraryChanged } from "../broadcast";
import { createFolderHash } from "../../libraryUi";
import { createLibraryReference } from "./libraryReference";
import { PAPERS_DIR, findInLibrary, isPrePublication, findPublishedDoi, type FolderTreeNode, type ILogger } from "@labshelf/core";

// "Find PDF" for a paper already saved (no tab). One run per id is kept in
// flight so repeated clicks share the search, and paper.pdf is written at the
// record's CURRENT path (attachPdfToPaper re-reads it).
const findingPdf = new Map<string, Promise<AttachPdfReply>>();

function shareInflight(key: string, start: () => Promise<AttachPdfReply>): Promise<AttachPdfReply> {
  const inflight = findingPdf.get(key);
  if (inflight) return inflight;
  const run = start();
  findingPdf.set(key, run);
  void run.catch(() => undefined).finally(() => { if (findingPdf.get(key) === run) findingPdf.delete(key); });
  return run;
}

export function answerFindPdfForPaper(log: ILogger, mutations: LibraryMutations, id: string): Promise<AttachPdfReply> {
  return shareInflight(id, async () => {
    const record = (await listCachedPaperRecords()).find((r) => r.id === id);
    if (!record) throw new Error("This paper is no longer in your library.");
    return attachFoundPdf(log, mutations, await createDraftFromPaper(log, record), id);
  });
}

/**
 * "Find Published Version" on a paper whose PDF is a preprint or accepted manuscript: the search learns the journal
 * DOI when the preprint records one, keeps only copies that outrank the current file, and replaces it with the best.
 */
export function answerFindBetterPdf(log: ILogger, mutations: LibraryMutations, id: string): Promise<AttachPdfReply> {
  return shareInflight(`better:${id}`, async () => {
    const record = (await listCachedPaperRecords()).find((r) => r.id === id);
    if (!record) throw new Error("This paper is no longer in your library.");
    if (!isPrePublication(record.pdfVersion)) throw new Error("This paper's PDF is not a preprint.");
    const draft = await createDraftFromPaper(log, record);
    const doi = await findPublishedDoi(
      { logger: log, contactEmail: (await readSettings()).contactEmail },
      { arxivId: draft.ids.arxivId, doi: draft.ids.doi ?? draft.metadata.doi },
    );
    if (doi) draft.ids = { ...draft.ids, doi };
    draft.betterThan = record.pdfVersion;
    const pdf = await findPdf(log, draft);
    if (!pdf) return { id, attached: false, miss: derivePdfMiss(draft.pdfAttempts) };
    await attachPdfToPaper(mutations, id, pdf.bytes, { version: pdf.version, replace: true });
    void log.log("INFO", "library", "PDF replaced by a better version", { id, from: record.pdfVersion, to: pdf.version ?? null, url: pdf.url, publishedDoi: doi ?? null });
    sendLibraryChanged("attach", id);
    return { id, attached: true, replaced: true, source: pdf.source };
  });
}

export async function answerRemovePaper(
  id: string,
  mutations: LibraryMutations,
  log: ILogger,
): Promise<{ removed: boolean }> {
  const record = (await listCachedPaperRecords()).find((r) => r.id === id);
  if (!record) return { removed: false };
  const { done, failed } = await mutations.trashPapers([{ id: record.id, path: record.path }]);
  if (!done.length) throw new Error(failed[0]?.error ?? "The paper could not be removed.");
  removePaperDrafts(record.id);
  sendLibraryChanged("remove", record.id);
  await log.log("INFO", "background", "paper removed from popup", { id: record.id });
  return { removed: true };
}

export async function answerLibraryFolders(): Promise<FoldersReply> {
  const [tree, settings] = await Promise.all([buildFolderTree(PAPERS_DIR), readSettings()]);
  const folders: FolderOption[] = [{ path: PAPERS_DIR, depth: 0 }];
  const walk = (nodes: FolderTreeNode[], depth: number): void => {
    for (const n of nodes) { folders.push({ path: n.path, depth }); walk(n.children, depth + 1); }
  };
  walk(tree, 1);
  // A remembered folder that was since deleted or renamed falls back to the root.
  const lastFolder = folders.some((f) => f.path === settings.lastFolder) ? settings.lastFolder : PAPERS_DIR;
  return { folders, lastFolder };
}

export async function answerLibraryFind(items: LibraryFindItem[]): Promise<LibraryFindReply> {
  const [records, dirs] = await Promise.all([listCachedPaperRecords(), listPdfDirs()]);
  const out: LibraryFindReply = {};
  for (const item of items) {
    const hit = findInLibrary(records, item);
    if (hit) out[item.key] = createLibraryReference(hit.id, hit.path, dirs.has(hit.path));
  }
  return out;
}

export async function answerLibraryOpen(msg: Extract<RuntimeMessage, { type: "library.open" }>): Promise<{ opened: true }> {
  const folder = normalizeFolder(msg.folder);
  const query = msg.paperId ? `?paper=${encodeURIComponent(msg.paperId)}` : "";
  await bx.tabs.create({ url: `${bx.runtime.getURL("libraryPage/index.html")}${query}${createFolderHash(folder)}` });
  return { opened: true };
}

export async function answerListTabs(): Promise<TabSummary[]> {
  const tabs = await bx.tabs.query({ currentWindow: true });
  return tabs
    .filter((t) => t.id !== undefined && /^https?:/.test(t.url ?? ""))
    .map((t) => ({ id: t.id!, title: t.title ?? "", url: t.url ?? "" }) satisfies TabSummary);
}
