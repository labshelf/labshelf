// Handles the capture.* and searchHit.save runtime messages: inspecting a tab, searching for its
// PDF, saving the draft and attaching a PDF to an already-saved paper.
import type { IfNoPdf, ILogger } from "@labshelf/core";
import { bx } from "../../platform";
import type {
  AttachPdfData, DraftView, PdfStatusData, RuntimeMessage, SaveOutcome, SavedPaperData,
} from "../../platform";
import {
  attachPdfToPaper, findPdf, refreshExisting, resetPdfSearch, saveOrAsk, summarizeAttempts,
} from "../../capture/index";
import type { CaptureDraft, SaveDecision, SavedPaper } from "../../capture/index";
import { draftForTab, hitDraftFor } from "../draftCache";
import { broadcastChanged } from "../broadcast";
import type { LibraryMutations } from "../../storage";
import { pdfExists, ref } from "./libraryRef";
import { accessTabDeps, openAccessAfterCapture } from "./access";
import { askAuthor, type AskAuthorDeps } from "./askAuthor";

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
    ...(d.existing ? { existing: ref(d.existing.id, d.existing.path, await pdfExists(d.existing.path)) } : {}),
  };
}

/** Turns a consent-gated save decision into the reply the surfaces switch on. */
function outcome(draft: CaptureDraft, decision: SaveDecision): SaveOutcome {
  if (decision.kind === "saved") return saved(decision.saved);
  return {
    status: "no-pdf",
    title: draft.metadata.title ?? "Untitled",
    miss: decision.miss,
  };
}

// A capture wrote to IDB; tell open pages.
function saved(result: SavedPaper): SavedPaperData {
  const { paper } = result;
  broadcastChanged("capture", paper.id);
  return {
    ...ref(paper.id, paper.path, result.pdfSource !== null),
    status: "saved",
    title: paper.title,
    pdfSource: result.pdfSource,
  };
}

async function libraryCopy(d: CaptureDraft): Promise<SavedPaperData> {
  const paper = d.existing!;
  return {
    ...ref(paper.id, paper.path, await pdfExists(paper.path)),
    status: "saved",
    title: paper.title,
    pdfSource: null,
    alreadyInLibrary: true,
  };
}

export async function handleCaptureInspect(log: ILogger, msg: Extract<RuntimeMessage, { type: "capture.inspect" }>): Promise<DraftView> {
  const draft = await draftForTab(log, msg.tabId, await tabUrl(msg.tabId));
  const view = await draftView(draft);
  // Start the PDF search now; also for a library copy that still has no PDF,
  // so the popup can offer to attach what this page yields. The popup asks
  // for the result separately.
  if (draft.isPaper && !view.existing?.hasPdf) void findPdf(log, draft);
  return view;
}

export async function handleCaptureFindPdf(log: ILogger, msg: Extract<RuntimeMessage, { type: "capture.findPdf" }>): Promise<PdfStatusData> {
  const draft = await draftForTab(log, msg.tabId, await tabUrl(msg.tabId));
  const pdf = await findPdf(log, draft);
  return pdf
    ? { found: true, source: pdf.source }
    : { found: false, miss: summarizeAttempts(draft.pdfAttempts) };
}

export async function handleCaptureSave(
  log: ILogger,
  mutations: LibraryMutations,
  msg: Extract<RuntimeMessage, { type: "capture.save" }>,
): Promise<SaveOutcome> {
  const draft = await draftForTab(log, msg.tabId, await tabUrl(msg.tabId));
  if (msg.retryPdf) resetPdfSearch(draft);
  const ifNoPdf = msg.ifNoPdf ?? "ask";
  const decision = await saveOrAsk(log, mutations, draft, {
    ...(msg.folder ? { folder: msg.folder } : {}),
    ...(msg.tags ? { tags: msg.tags } : {}),
    ...(msg.note ? { note: msg.note } : {}),
  }, ifNoPdf);
  const reply = outcome(draft, decision);
  await afterSave({ log, mutations }, draft, reply, ifNoPdf, msg.tabId);
  return reply;
}

// The "open" and "author" choices: the reference is saved (or was already there) without a PDF, so the page in the way
// or the request email opens. The email opens in the captured tab.
async function afterSave(
  deps: AskAuthorDeps, draft: CaptureDraft, reply: SaveOutcome | SavedPaperData, ifNoPdf: IfNoPdf, tabId: number | undefined,
): Promise<void> {
  if (reply.status !== "saved" || reply.hasPdf || !draft.existing) return;
  if (ifNoPdf === "open") await openAccessAfterCapture(accessTabDeps(deps.log, deps.mutations), draft, { id: reply.id, title: reply.title });
  if (ifNoPdf === "author") await askAuthor(deps, draft.existing, { tabId, page: draft.page, articleUrl: draft.pageUrl });
}

interface UnlessSaved {
  folder?: string | undefined;
  ifNoPdf?: IfNoPdf | undefined;
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
): Promise<SaveOutcome | SavedPaperData> {
  if (request.retryPdf) resetPdfSearch(draft);
  await refreshExisting(draft);
  const ifNoPdf = request.ifNoPdf ?? "ask";
  const reply = draft.existing
    ? await libraryCopy(draft)
    : outcome(draft, await saveOrAsk(log, mutations, draft, request.folder ? { folder: request.folder } : {}, ifNoPdf));
  await afterSave({ log, mutations }, draft, reply, ifNoPdf, request.tabId);
  return reply;
}

export async function handleCaptureTab(
  log: ILogger,
  mutations: LibraryMutations,
  msg: Extract<RuntimeMessage, { type: "capture.tab" }>,
): Promise<SaveOutcome | SavedPaperData> {
  // Fresh look on the first call; the "Save without PDF" confirmation reuses
  // the cached draft (and its finished search).
  const draft = await draftForTab(log, msg.tabId, await tabUrl(msg.tabId), msg.ifNoPdf !== "save");
  return saveUnlessInLibrary(log, mutations, draft, { folder: msg.targetFolder, ifNoPdf: msg.ifNoPdf, retryPdf: msg.retryPdf, tabId: msg.tabId });
}

export async function handleSearchHitSave(
  log: ILogger,
  mutations: LibraryMutations,
  msg: Extract<RuntimeMessage, { type: "searchHit.save" }>,
  pageTabId: number | undefined,
): Promise<SaveOutcome | SavedPaperData> {
  return saveUnlessInLibrary(log, mutations, await hitDraftFor(log, msg.hit), { ...msg, tabId: pageTabId });
}

/**
 * Runs (or reuses) the draft's PDF search and writes what it finds into the paper already saved under `id`.
 * @returns whether paper.pdf was written now, or what the search tried
 */
export async function attachFoundPdf(
  log: ILogger,
  mutations: LibraryMutations,
  draft: CaptureDraft,
  id: string,
): Promise<AttachPdfData> {
  const pdf = await findPdf(log, draft);
  if (!pdf) return { id, attached: false, miss: summarizeAttempts(draft.pdfAttempts) };
  const { written } = await attachPdfToPaper(mutations, id, pdf.bytes, { version: pdf.version });
  if (written) {
    broadcastChanged("attach", id);
  }
  return { id, attached: written, ...(written ? { source: pdf.source } : { alreadyHadPdf: true }) };
}

export async function handleCaptureAttachPdf(
  log: ILogger,
  mutations: LibraryMutations,
  msg: Extract<RuntimeMessage, { type: "capture.attachPdf" }>,
): Promise<AttachPdfData> {
  const draft = await draftForTab(log, msg.tabId, await tabUrl(msg.tabId));
  if (!draft.existing) throw new Error("This paper is not in your library.");
  // The search already ran at inspect; findPdf returns the memoised result.
  return attachFoundPdf(log, mutations, draft, draft.existing.id);
}
