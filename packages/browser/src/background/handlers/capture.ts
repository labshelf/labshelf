// Handles the capture.* and scholar.save runtime messages: inspecting a tab, searching for its
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
import { draftForTab, scholarDraftFor } from "../draftCache";
import { broadcastChanged } from "../broadcast";
import type { LibraryMutations } from "../../storage";
import { pdfExists, ref } from "./libraryRef";
import { accessTabDeps, openAccessAfterCapture } from "./access";

type ScheduleSync = (reason: string) => void;

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
function outcome(draft: CaptureDraft, decision: SaveDecision, scheduleSync: ScheduleSync): SaveOutcome {
  if (decision.kind === "saved") return saved(decision.saved, scheduleSync);
  return {
    status: "no-pdf",
    title: draft.metadata.title ?? "Untitled",
    miss: decision.miss,
  };
}

// A capture wrote to IDB; coalesce the follow-up sync and tell open pages.
function saved(result: SavedPaper, scheduleSync: ScheduleSync): SavedPaperData {
  scheduleSync("capture");
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
  scheduleSync: ScheduleSync,
): Promise<SaveOutcome> {
  const draft = await draftForTab(log, msg.tabId, await tabUrl(msg.tabId));
  if (msg.retryPdf) resetPdfSearch(draft);
  const ifNoPdf = msg.ifNoPdf ?? "ask";
  const decision = await saveOrAsk(log, mutations, draft, {
    ...(msg.folder ? { folder: msg.folder } : {}),
    ...(msg.tags ? { tags: msg.tags } : {}),
    ...(msg.note ? { note: msg.note } : {}),
  }, ifNoPdf);
  const reply = outcome(draft, decision, scheduleSync);
  if (ifNoPdf === "open") await openIfPdfMissing(log, mutations, scheduleSync, draft, reply);
  return reply;
}

// The "open" choice: the reference is saved (or was already there) without a PDF, so the page in the way opens now.
async function openIfPdfMissing(
  log: ILogger, mutations: LibraryMutations, scheduleSync: ScheduleSync, draft: CaptureDraft, reply: SaveOutcome | SavedPaperData,
): Promise<void> {
  if (reply.status !== "saved" || reply.hasPdf) return;
  await openAccessAfterCapture(accessTabDeps(log, mutations, scheduleSync), draft, { id: reply.id, title: reply.title });
}

interface UnlessSaved {
  folder?: string | undefined;
  ifNoPdf?: IfNoPdf | undefined;
  retryPdf?: boolean | undefined;
}

// The paper may already be in the library (saved or removed elsewhere since the draft was cached): never write a duplicate.
async function saveUnlessInLibrary(
  log: ILogger,
  mutations: LibraryMutations,
  draft: CaptureDraft,
  request: UnlessSaved,
  scheduleSync: ScheduleSync,
): Promise<SaveOutcome | SavedPaperData> {
  if (request.retryPdf) resetPdfSearch(draft);
  await refreshExisting(draft);
  const ifNoPdf = request.ifNoPdf ?? "ask";
  const reply = draft.existing
    ? await libraryCopy(draft)
    : outcome(draft, await saveOrAsk(log, mutations, draft, request.folder ? { folder: request.folder } : {}, ifNoPdf), scheduleSync);
  if (ifNoPdf === "open") await openIfPdfMissing(log, mutations, scheduleSync, draft, reply);
  return reply;
}

export async function handleCaptureTab(
  log: ILogger,
  mutations: LibraryMutations,
  msg: Extract<RuntimeMessage, { type: "capture.tab" }>,
  scheduleSync: ScheduleSync,
): Promise<SaveOutcome | SavedPaperData> {
  // Fresh look on the first call; the "Save without PDF" confirmation reuses
  // the cached draft (and its finished search).
  const draft = await draftForTab(log, msg.tabId, await tabUrl(msg.tabId), msg.ifNoPdf !== "save");
  return saveUnlessInLibrary(log, mutations, draft, { folder: msg.targetFolder, ifNoPdf: msg.ifNoPdf, retryPdf: msg.retryPdf }, scheduleSync);
}

export async function handleScholarSave(
  log: ILogger,
  mutations: LibraryMutations,
  msg: Extract<RuntimeMessage, { type: "scholar.save" }>,
  scheduleSync: ScheduleSync,
): Promise<SaveOutcome | SavedPaperData> {
  return saveUnlessInLibrary(log, mutations, await scholarDraftFor(log, msg.hit), msg, scheduleSync);
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
  scheduleSync: ScheduleSync,
  reason: string,
): Promise<AttachPdfData> {
  const pdf = await findPdf(log, draft);
  if (!pdf) return { id, attached: false, miss: summarizeAttempts(draft.pdfAttempts) };
  const { written } = await attachPdfToPaper(mutations, id, pdf.bytes);
  if (written) {
    scheduleSync(reason);
    broadcastChanged("attach", id);
  }
  return { id, attached: written, ...(written ? { source: pdf.source } : { alreadyHadPdf: true }) };
}

export async function handleCaptureAttachPdf(
  log: ILogger,
  mutations: LibraryMutations,
  msg: Extract<RuntimeMessage, { type: "capture.attachPdf" }>,
  scheduleSync: ScheduleSync,
): Promise<AttachPdfData> {
  const draft = await draftForTab(log, msg.tabId, await tabUrl(msg.tabId));
  if (!draft.existing) throw new Error("This paper is not in your library.");
  // The search already ran at inspect; findPdf returns the memoised result.
  return attachFoundPdf(log, mutations, draft, draft.existing.id, scheduleSync, "capture.attachPdf");
}
