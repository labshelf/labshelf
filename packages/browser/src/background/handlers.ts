// Answers the runtime messages the extension pages and the search page buttons send: capturing a tab or search hit,
// finding and attaching a PDF, opening the page that stood in the way of one, and the library folders, lookup, open and
// remove requests.
import {
  PAPERS_DIR, PDF_FILE, PaperNotesStore, createFolderHash, deriveParentDir, findInLibrary, findPublishedDoi, isPrePublication,
  type FolderTreeNode, type ILogger, type MissingPdfAction, type PdfAccess,
} from "@labshelf/core";
import { bx, readSettings } from "../platform";
import type {
  AttachPdfReply, BrowserTab, DraftView, FindPdfReply, FolderOption, FoldersReply, LibraryFindItem, LibraryFindReply,
  LibraryReference, RuntimeMessage, WriteOutcome, WrittenPaperReply,
} from "../platform";
import {
  attachPdfToPaper, createDraftFromPaper, derivePdfMiss, findPdf, normalizeFolder, openAccessTab, refreshExisting,
  refreshPdfSearch, writeOrAsk,
} from "../capture/index";
import type { AccessTabDeps, CaptureDraft, SavedPaper, WriteDecision } from "../capture/index";
import { buildFolderTree, createLibraryFileSystem, createPaperNotesPort, listCachedPaperRecords, listPdfDirs } from "../storage";
import type { LibraryMutations } from "../storage";
import { sendLibraryChanged } from "./broadcast";
import { readHitDraft, readTabDraft, removePaperDrafts } from "./drafts";
import { sendCopyRequest, type CopyRequestDeps } from "./copyRequest";

// ----- Library references

function createLibraryReference(id: string, path: string, hasPdf: boolean): LibraryReference {
  return { id, path, folder: deriveParentDir(path, "/"), hasPdf };
}

/** Whether `<path>/paper.pdf` exists (one stat; library.lookup uses a bulk scan). */
async function hasPdfFile(path: string): Promise<boolean> {
  return (await createLibraryFileSystem().stat(`${path}/${PDF_FILE}`)) !== undefined;
}

// ----- Access pages

/** What a watched tab needs to attach a PDF: the write and the notice to open library pages. */
export function createAccessTabDeps(log: ILogger, mutations: LibraryMutations): AccessTabDeps {
  return {
    log,
    async attach(paperId, bytes) {
      const { record, written } = await attachPdfToPaper(mutations, paperId, bytes);
      if (written) {
        sendLibraryChanged("attach", paperId, `PDF attached to "${record.title}"`);
      }
      return written;
    },
  };
}

/** Library page "Open to sign in" / "Open to pass the check" on a paper already saved. */
export async function answerOpenForPdf(deps: AccessTabDeps, msg: { id: string; access: PdfAccess }): Promise<{ opened: true }> {
  // The URL crosses runtime messaging, so only a web page is opened, never a script or extension URL.
  if (!/^https?:\/\//i.test(msg.access.url)) throw new Error("LabShelf opens only web pages for a PDF.");
  const record = (await listCachedPaperRecords()).find((r) => r.id === msg.id);
  if (!record) throw new Error("This paper is no longer in your library.");
  await openAccessTab(deps, { id: record.id, title: record.title }, msg.access);
  return { opened: true };
}

/** A capture saved with "open": opens the access page its PDF search ran into, for the paper it saved. */
async function openAccessAfterCapture(deps: AccessTabDeps, draft: CaptureDraft, paper: { id: string; title: string }): Promise<void> {
  const { access } = derivePdfMiss(draft.pdfAttempts);
  if (access) await openAccessTab(deps, paper, access);
  else void deps.log.log("WARN", "capture", "open asked, but no sign-in or bot check stood in the way", { paperId: paper.id });
}

// ----- Capture

async function tabUrl(tabId: number): Promise<string> {
  const tab = await bx.tabs.get(tabId);
  return tab.url ?? "";
}

async function draftView(d: CaptureDraft): Promise<DraftView> {
  const m = d.metadata;
  const venue = m.journal ?? m.publisher;
  return {
    isPaper: d.isPaper,
    title: m.title ?? "",
    authors: m.authors ?? [],
    ...(m.year ? { year: m.year } : {}),
    ...(venue ? { venue } : {}),
    ...(d.existing ? { existing: createLibraryReference(d.existing.id, d.existing.path, await hasPdfFile(d.existing.path)) } : {}),
  };
}

/** Turns a consent-gated save decision into the reply the surfaces switch on. */
function outcome(draft: CaptureDraft, decision: WriteDecision): WriteOutcome {
  if (decision.kind === "saved") return saved(decision.saved);
  return {
    status: "no-pdf",
    title: draft.metadata.title ?? "Untitled",
    miss: decision.miss,
  };
}

// A capture wrote to IDB; tell open pages.
function saved(result: SavedPaper): WrittenPaperReply {
  const { paper } = result;
  sendLibraryChanged("capture", paper.id);
  return {
    ...createLibraryReference(paper.id, paper.path, result.pdfSource !== null),
    status: "saved",
    title: paper.title,
    pdfSource: result.pdfSource,
  };
}

async function libraryCopy(d: CaptureDraft): Promise<WrittenPaperReply> {
  const paper = d.existing!;
  return {
    ...createLibraryReference(paper.id, paper.path, await hasPdfFile(paper.path)),
    status: "saved",
    title: paper.title,
    pdfSource: null,
    alreadyInLibrary: true,
  };
}

export async function answerCaptureInspect(log: ILogger, msg: Extract<RuntimeMessage, { type: "capture.inspect" }>): Promise<DraftView> {
  const draft = await readTabDraft(log, msg.tabId, await tabUrl(msg.tabId));
  const view = await draftView(draft);
  // Start the PDF search now; also for a library copy that still has no PDF,
  // so the popup can offer to attach what this page yields. The popup asks
  // for the result separately.
  if (draft.isPaper && !view.existing?.hasPdf) void findPdf(log, draft);
  return view;
}

export async function answerCaptureFindPdf(log: ILogger, msg: Extract<RuntimeMessage, { type: "capture.findPdf" }>): Promise<FindPdfReply> {
  const draft = await readTabDraft(log, msg.tabId, await tabUrl(msg.tabId));
  const pdf = await findPdf(log, draft);
  return pdf
    ? { found: true, source: pdf.source }
    : { found: false, miss: derivePdfMiss(draft.pdfAttempts) };
}

export async function answerCaptureWrite(
  log: ILogger,
  mutations: LibraryMutations,
  msg: Extract<RuntimeMessage, { type: "capture.save" }>,
): Promise<WriteOutcome> {
  const draft = await readTabDraft(log, msg.tabId, await tabUrl(msg.tabId));
  if (msg.retryPdf) refreshPdfSearch(draft);
  const ifNoPdf = msg.ifNoPdf ?? "ask";
  const decision = await writeOrAsk(log, mutations, draft, {
    ...(msg.folder ? { folder: msg.folder } : {}),
    ...(msg.tags ? { tags: msg.tags } : {}),
    ...(msg.note ? { note: msg.note, notes: new PaperNotesStore(createPaperNotesPort(createLibraryFileSystem()), { logger: log }) } : {}),
  }, ifNoPdf);
  const reply = outcome(draft, decision);
  await afterSave({ log, mutations }, draft, reply, ifNoPdf, msg.tabId);
  return reply;
}

// The "open" and "author" choices: the reference is saved (or was already there) without a PDF, so the page in the way
// or the request email opens. The email opens in the captured tab.
async function afterSave(
  deps: CopyRequestDeps, draft: CaptureDraft, reply: WriteOutcome | WrittenPaperReply, ifNoPdf: MissingPdfAction, tabId: number | undefined,
): Promise<void> {
  if (reply.status !== "saved" || reply.hasPdf || !draft.existing) return;
  if (ifNoPdf === "open") await openAccessAfterCapture(createAccessTabDeps(deps.log, deps.mutations), draft, { id: reply.id, title: reply.title });
  if (ifNoPdf === "author") await sendCopyRequest(deps, draft.existing, { tabId, page: draft.page, articleUrl: draft.pageUrl });
}

interface UnlessSaved {
  folder?: string | undefined;
  ifNoPdf?: MissingPdfAction | undefined;
  retryPdf?: boolean | undefined;
  /** The tab the request email opens in. */
  tabId?: number | undefined;
}

// The paper may already be in the library (saved or removed elsewhere since the draft was cached): never write a duplicate.
async function saveUnlessInLibrary(
  log: ILogger,
  mutations: LibraryMutations,
  draft: CaptureDraft,
  request: UnlessSaved,
): Promise<WriteOutcome | WrittenPaperReply> {
  if (request.retryPdf) refreshPdfSearch(draft);
  await refreshExisting(draft);
  const ifNoPdf = request.ifNoPdf ?? "ask";
  const reply = draft.existing
    ? await libraryCopy(draft)
    : outcome(draft, await writeOrAsk(log, mutations, draft, request.folder ? { folder: request.folder } : {}, ifNoPdf));
  await afterSave({ log, mutations }, draft, reply, ifNoPdf, request.tabId);
  return reply;
}

export async function answerCaptureTab(
  log: ILogger,
  mutations: LibraryMutations,
  msg: Extract<RuntimeMessage, { type: "capture.tab" }>,
): Promise<WriteOutcome | WrittenPaperReply> {
  // Fresh look on the first call; the "Save without PDF" confirmation reuses
  // the cached draft (and its finished search).
  const draft = await readTabDraft(log, msg.tabId, await tabUrl(msg.tabId), msg.ifNoPdf !== "save");
  return saveUnlessInLibrary(log, mutations, draft, { folder: msg.targetFolder, ifNoPdf: msg.ifNoPdf, retryPdf: msg.retryPdf, tabId: msg.tabId });
}

export async function answerSearchHitWrite(
  log: ILogger,
  mutations: LibraryMutations,
  msg: Extract<RuntimeMessage, { type: "searchHit.save" }>,
  pageTabId: number | undefined,
): Promise<WriteOutcome | WrittenPaperReply> {
  return saveUnlessInLibrary(log, mutations, await readHitDraft(log, msg.hit), { ...msg, tabId: pageTabId });
}

/**
 * Runs (or reuses) the draft's PDF search and writes what it finds into the paper already saved under `id`.
 * @returns whether paper.pdf was written now, or what the search tried
 */
async function attachFoundPdf(
  log: ILogger,
  mutations: LibraryMutations,
  draft: CaptureDraft,
  id: string,
): Promise<AttachPdfReply> {
  const pdf = await findPdf(log, draft);
  if (!pdf) return { id, attached: false, miss: derivePdfMiss(draft.pdfAttempts) };
  const { written } = await attachPdfToPaper(mutations, id, pdf.bytes, { version: pdf.version });
  if (written) {
    sendLibraryChanged("attach", id);
  }
  return { id, attached: written, ...(written ? { source: pdf.source } : { alreadyHadPdf: true }) };
}

export async function answerCaptureAttachPdf(
  log: ILogger,
  mutations: LibraryMutations,
  msg: Extract<RuntimeMessage, { type: "capture.attachPdf" }>,
): Promise<AttachPdfReply> {
  const draft = await readTabDraft(log, msg.tabId, await tabUrl(msg.tabId));
  if (!draft.existing) throw new Error("This paper is not in your library.");
  // The search already ran at inspect; findPdf returns the memoised result.
  return attachFoundPdf(log, mutations, draft, draft.existing.id);
}

// ----- Library

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

export async function answerListTabs(): Promise<BrowserTab[]> {
  const tabs = await bx.tabs.query({ currentWindow: true });
  return tabs
    .filter((t) => t.id !== undefined && /^https?:/.test(t.url ?? ""))
    .map((t) => ({ id: t.id!, title: t.title ?? "", url: t.url ?? "" }) satisfies BrowserTab);
}
