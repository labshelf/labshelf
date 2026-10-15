// Handles the capture.* and scholar.save runtime messages: inspecting a tab, searching for its
// PDF, saving the draft and attaching a PDF to an already-saved paper.
import { bx } from "../../platform/browserApi";
import type {
  AttachPdfData, DraftView, PdfStatusData, RuntimeMessage, SaveOutcome, SavedPaperData,
} from "../../platform/runtimeMessages";
import {
  attachPdfToPaper, findPdf, refreshExisting, resetPdfSearch, saveOrAsk, summarizeAttempts,
} from "../../capture/index";
import type { CaptureDraft, SaveDecision, SavedPaper } from "../../capture/index";
import { draftForTab, scholarDraftFor } from "../draftCache";
import { broadcastChanged } from "../broadcast";
import { pdfExists, ref } from "./libraryRef";

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
    origin: d.origin,
    ...(m.year ? { year: m.year } : {}),
    ...(venue ? { venue } : {}),
    ...(d.ids.doi ? { doi: d.ids.doi } : {}),
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
    ...(draft.pageUrl ? { pageUrl: draft.pageUrl } : {}),
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
    citeKey: paper.citeKey,
    pdfSource: result.pdfSource,
  };
}

async function libraryCopy(d: CaptureDraft): Promise<SavedPaperData> {
  const paper = d.existing!;
  return {
    ...ref(paper.id, paper.path, await pdfExists(paper.path)),
    status: "saved",
    title: paper.title,
    citeKey: paper.citeKey,
    pdfSource: null,
    alreadyInLibrary: true,
  };
}

export async function handleCaptureInspect(msg: Extract<RuntimeMessage, { type: "capture.inspect" }>): Promise<DraftView> {
  const draft = await draftForTab(msg.tabId, await tabUrl(msg.tabId));
  const view = await draftView(draft);
  // Start the PDF search now; also for a library copy that still has no PDF,
  // so the popup can offer to attach what this page yields. The popup asks
  // for the result separately.
  if (draft.isPaper && !view.existing?.hasPdf) void findPdf(draft);
  return view;
}

export async function handleCaptureFindPdf(msg: Extract<RuntimeMessage, { type: "capture.findPdf" }>): Promise<PdfStatusData> {
  const draft = await draftForTab(msg.tabId, await tabUrl(msg.tabId));
  const pdf = await findPdf(draft);
  return pdf
    ? { found: true, source: pdf.source }
    : { found: false, miss: summarizeAttempts(draft.pdfAttempts) };
}

export async function handleCaptureSave(
  msg: Extract<RuntimeMessage, { type: "capture.save" }>,
  scheduleSync: ScheduleSync,
): Promise<SaveOutcome> {
  const draft = await draftForTab(msg.tabId, await tabUrl(msg.tabId));
  if (msg.retryPdf) resetPdfSearch(draft);
  return outcome(draft, await saveOrAsk(draft, {
    ...(msg.folder ? { folder: msg.folder } : {}),
    ...(msg.tags ? { tags: msg.tags } : {}),
    ...(msg.note ? { note: msg.note } : {}),
  }, msg.ifNoPdf ?? "ask"), scheduleSync);
}

export async function handleCaptureTab(
  msg: Extract<RuntimeMessage, { type: "capture.tab" }>,
  scheduleSync: ScheduleSync,
): Promise<SaveOutcome | SavedPaperData> {
  // Fresh look on the first call; the "Save without PDF" confirmation reuses
  // the cached draft (and its finished search).
  const draft = await draftForTab(msg.tabId, await tabUrl(msg.tabId), msg.ifNoPdf !== "save");
  if (msg.retryPdf) resetPdfSearch(draft);
  await refreshExisting(draft);
  // D4: the tab's paper may already be in the library — never write a duplicate.
  if (draft.existing) return libraryCopy(draft);
  return outcome(draft, await saveOrAsk(draft, msg.targetFolder ? { folder: msg.targetFolder } : {}, msg.ifNoPdf ?? "ask"), scheduleSync);
}

export async function handleScholarSave(
  msg: Extract<RuntimeMessage, { type: "scholar.save" }>,
  scheduleSync: ScheduleSync,
): Promise<SaveOutcome | SavedPaperData> {
  const draft = await scholarDraftFor(msg.hit);
  if (msg.retryPdf) resetPdfSearch(draft);
  await refreshExisting(draft);
  if (draft.existing) return libraryCopy(draft);
  return outcome(draft, await saveOrAsk(draft, msg.folder ? { folder: msg.folder } : {}, msg.ifNoPdf ?? "ask"), scheduleSync);
}

export async function handleCaptureAttachPdf(
  msg: Extract<RuntimeMessage, { type: "capture.attachPdf" }>,
  scheduleSync: ScheduleSync,
): Promise<AttachPdfData> {
  const draft = await draftForTab(msg.tabId, await tabUrl(msg.tabId));
  if (!draft.existing) throw new Error("This paper is not in your library.");
  const id = draft.existing.id;
  // The search already ran at inspect; findPdf returns the memoised result.
  const pdf = await findPdf(draft);
  if (!pdf) return { id, attached: false, miss: summarizeAttempts(draft.pdfAttempts) };
  const { written } = await attachPdfToPaper(id, pdf.bytes);
  if (written) {
    scheduleSync("capture.attachPdf");
    broadcastChanged("attach", id);
  }
  return { id, attached: written, ...(written ? { source: pdf.source } : { alreadyHadPdf: true }) };
}
