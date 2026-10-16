// Handles the library.folders/library.lookup/library.open, paper.findPdf (with or without replace)/paper.remove and
// tabs.list runtime messages.
import { bx } from "../../platform";
import type {
  AttachPdfData, FolderOption, FoldersData, LookupData, LookupItem, RuntimeMessage, TabSummary,
} from "../../platform";
import { getSettings } from "../../platform";
import { attachPdfToPaper, draftFromRecord, findPdf, safeFolder, summarizeAttempts } from "../../capture/index";
import { attachFoundPdf } from "./capture";
import { listAllRecords, buildFolderTree, pdfDirs } from "../../storage";
import type { LibraryMutations } from "../../storage";
import { forgetPaper } from "../draftCache";
import { broadcastChanged } from "../broadcast";
import { hashForFolder } from "../../library-page";
import { ref } from "./libraryRef";
import { PAPERS_DIR, findInLibrary, isPrePublication, publishedDoiOf, type FolderTreeNode, type ILogger } from "@labshelf/core";

type ScheduleSync = (reason: string) => void;

// "Find PDF" for a paper already saved (no tab). One run per id is kept in
// flight so repeated clicks share the search, and paper.pdf is written at the
// record's CURRENT path (attachPdfToPaper re-reads it).
const findingPdf = new Map<string, Promise<AttachPdfData>>();

export async function handleFindPdfForPaper(log: ILogger, mutations: LibraryMutations, id: string, scheduleSync: ScheduleSync): Promise<AttachPdfData> {
  const inflight = findingPdf.get(id);
  if (inflight) return inflight;
  const run = (async (): Promise<AttachPdfData> => {
    const record = (await listAllRecords()).find((r) => r.id === id);
    if (!record) throw new Error("This paper is no longer in your library.");
    return attachFoundPdf(log, mutations, await draftFromRecord(log, record), id, scheduleSync, "paper.findPdf");
  })();
  findingPdf.set(id, run);
  void run.catch(() => undefined).finally(() => { if (findingPdf.get(id) === run) findingPdf.delete(id); });
  return run;
}

/**
 * "Find Published Version" on a paper whose PDF is a preprint or accepted manuscript: the search learns the journal
 * DOI when the preprint records one, keeps only copies that outrank the current file, and replaces it with the best.
 */
export async function handleFindBetterPdf(log: ILogger, mutations: LibraryMutations, id: string, scheduleSync: ScheduleSync): Promise<AttachPdfData> {
  const key = `better:${id}`;
  const inflight = findingPdf.get(key);
  if (inflight) return inflight;
  const run = (async (): Promise<AttachPdfData> => {
    const record = (await listAllRecords()).find((r) => r.id === id);
    if (!record) throw new Error("This paper is no longer in your library.");
    if (!isPrePublication(record.pdfVersion)) throw new Error("This paper's PDF is not a preprint.");
    const draft = await draftFromRecord(log, record);
    const doi = await publishedDoiOf(
      { logger: log, contactEmail: (await getSettings()).contactEmail },
      { arxivId: draft.ids.arxivId, doi: draft.ids.doi ?? draft.metadata.doi },
    );
    if (doi) draft.ids = { ...draft.ids, doi };
    draft.betterThan = record.pdfVersion;
    const pdf = await findPdf(log, draft);
    if (!pdf) return { id, attached: false, miss: summarizeAttempts(draft.pdfAttempts) };
    await attachPdfToPaper(mutations, id, pdf.bytes, { version: pdf.version, replace: true });
    void log.log("INFO", "library", "PDF replaced by a better version", { id, from: record.pdfVersion, to: pdf.version ?? null, url: pdf.url, publishedDoi: doi ?? null });
    scheduleSync("paper.findBetterPdf");
    broadcastChanged("attach", id);
    return { id, attached: true, replaced: true, source: pdf.source };
  })();
  findingPdf.set(key, run);
  void run.catch(() => undefined).finally(() => { if (findingPdf.get(key) === run) findingPdf.delete(key); });
  return run;
}

export async function handleRemovePaper(
  id: string,
  mutations: LibraryMutations,
  log: ILogger,
  scheduleSync: ScheduleSync,
): Promise<{ removed: boolean }> {
  const record = (await listAllRecords()).find((r) => r.id === id);
  if (!record) return { removed: false };
  const { done, failed } = await mutations.trashPapers([{ id: record.id, path: record.path }]);
  if (!done.length) throw new Error(failed[0]?.error ?? "The paper could not be removed.");
  forgetPaper(record.id);
  scheduleSync("paper.remove");
  broadcastChanged("remove", record.id);
  await log.log("INFO", "background", "paper removed from popup", { id: record.id });
  return { removed: true };
}

export async function handleLibraryFolders(): Promise<FoldersData> {
  const [tree, settings] = await Promise.all([buildFolderTree(PAPERS_DIR), getSettings()]);
  const folders: FolderOption[] = [{ path: PAPERS_DIR, depth: 0 }];
  const walk = (nodes: FolderTreeNode[], depth: number): void => {
    for (const n of nodes) { folders.push({ path: n.path, depth }); walk(n.children, depth + 1); }
  };
  walk(tree, 1);
  // A remembered folder that was since deleted or renamed falls back to the root.
  const lastFolder = folders.some((f) => f.path === settings.lastFolder) ? settings.lastFolder : PAPERS_DIR;
  return { folders, lastFolder };
}

export async function handleLibraryLookup(items: LookupItem[]): Promise<LookupData> {
  const [records, dirs] = await Promise.all([listAllRecords(), pdfDirs()]);
  const out: LookupData = {};
  for (const item of items) {
    const hit = findInLibrary(records, item);
    if (hit) out[item.key] = ref(hit.id, hit.path, dirs.has(hit.path));
  }
  return out;
}

export async function handleLibraryOpen(msg: Extract<RuntimeMessage, { type: "library.open" }>): Promise<{ opened: true }> {
  const folder = safeFolder(msg.folder);
  const query = msg.paperId ? `?paper=${encodeURIComponent(msg.paperId)}` : "";
  await bx.tabs.create({ url: `${bx.runtime.getURL("library-page/index.html")}${query}${hashForFolder(folder)}` });
  return { opened: true };
}

export async function handleListTabs(): Promise<TabSummary[]> {
  const tabs = await bx.tabs.query({ currentWindow: true });
  return tabs
    .filter((t) => t.id !== undefined && /^https?:/.test(t.url ?? ""))
    .map((t) => ({ id: t.id!, title: t.title ?? "", url: t.url ?? "" }) satisfies TabSummary);
}
