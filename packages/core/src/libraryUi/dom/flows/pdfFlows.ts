/**
 * The PDF flows: the dialogs around a missing PDF (opening a paper that has none, a search that came back empty, a capture
 * that found no PDF) and adding a paper from the sources the host offers.
 */
import { PDF_VERSION_LABEL, isPrePublication } from "../../../model/index.js";
import { showDialog, type DialogButton, pickQuickEntry } from "../../../ui/dom/index.js";
import { ASK_AUTHOR_LABEL, findMissMessage, createNoPdfDialogCopy, formatPdfAccessLabel } from "../../copy.js";
import type { PdfMiss, AddSource } from "../../protocol/index.js";
import type { UiContext } from "../uiContext.js";
import { sendCopyRequest, attachPdf, findPdf } from "./paperFlows.js";

export async function onPdfMissing(ctx: UiContext, id: string): Promise<void> {
  const choice = await showDialog({
    title: "This paper has no PDF",
    message: "LabShelf has no PDF for this paper yet. Find one on the web automatically, or attach a file you already have.",
    severity: "info",
    buttons: [{ id: "attach", label: "Attach PDF…" }, { id: "find", label: "Find PDF", primary: true }],
  });
  if (choice === "find") findPdf(ctx, id);
  else if (choice === "attach") attachPdf(ctx, id);
}

export async function onFindMiss(ctx: UiContext, id: string, miss: PdfMiss): Promise<void> {
  const title = ctx.store.get().papers.find((p) => p.id === id)?.title ?? id;
  const { access } = miss;
  const choice = await showDialog({
    title: "No PDF found",
    message: findMissMessage(title, miss),
    severity: "warning",
    buttons: [
      { id: "attach", label: "Attach PDF…" },
      { id: "retry", label: "Search again", primary: !access },
      ...(ctx.caps.askAuthor ? [{ id: "author", label: ASK_AUTHOR_LABEL }] : []),
      ...(access ? [{ id: "open", label: formatPdfAccessLabel(access), primary: true }] : []),
    ],
  });
  if (choice === "author") sendCopyRequest(ctx, id);
  else if (choice === "attach") attachPdf(ctx, id);
  else if (choice === "retry") findPdf(ctx, id);
  else if (choice === "open" && access) ctx.transport.post({ type: "paper.openForPdf", id, access });
}

/** Asks before looking for the published version of a paper whose PDF is a preprint or an accepted manuscript. */
export async function askFindBetterPdf(ctx: UiContext, id: string): Promise<void> {
  const paper = ctx.store.get().papers.find((p) => p.id === id);
  if (!paper || !isPrePublication(paper.pdfVersion)) return;
  const marks = ctx.store.get().stats[id]?.annotations ?? 0;
  const warning = marks
    ? ` This paper has ${marks} highlight${marks === 1 ? "" : "s"} or note${marks === 1 ? "" : "s"}. They stay, but the new pages may not line up with them.`
    : "";
  const choice = await showDialog({
    title: "Look for the published version?",
    message: `The PDF of "${paper.title}" is the ${PDF_VERSION_LABEL[paper.pdfVersion].toLowerCase()} version. If LabShelf finds the published version, it replaces this file.${warning}`,
    severity: marks ? "warning" : "info",
    buttons: [{ id: "find", label: "Find and Replace", primary: true }],
  });
  if (choice === "find") findPdf(ctx, id, true);
}

/** A capture's answer to "No PDF found"; every choice but "retry" saves the reference. */
export type MissingPdfChoice = "save" | "open" | "author" | "retry";

/**
 * Asks whether a capture without a PDF saves the reference alone, saves it and opens the page that stood in the way
 * ("open"), saves it and emails the authors ("author"), or searches again; undefined when cancelled. `root` mounts the
 * dialog inside a content script's shadow root.
 */
export function askNoPdf(title: string, miss: PdfMiss, root?: ShadowRoot): Promise<MissingPdfChoice | undefined> {
  const buttons: Array<DialogButton<MissingPdfChoice>> = [
    { id: "retry", label: "Search again" },
    { id: "author", label: ASK_AUTHOR_LABEL },
    { id: "save", label: "Save without PDF", primary: !miss.access },
    ...(miss.access ? [{ id: "open" as const, label: formatPdfAccessLabel(miss.access), primary: true }] : []),
  ];
  return showDialog({ ...createNoPdfDialogCopy(title, miss), severity: "warning", buttons, ...(root ? { root } : {}) });
}

/** Asks the host what a paper can be added from; papers land in the open folder. */
export function sendAddPaperRequest(ctx: UiContext): void {
  ctx.transport.post({ type: "paper.add", folder: ctx.store.get().folder });
}

export async function onAddSources(ctx: UiContext, folder: string, sources: AddSource[]): Promise<void> {
  const items = sources.map((s) => ({ label: s.label, description: s.description, icon: "globe" as const, value: s.id }));
  const sourceId = await pickQuickEntry(items, { title: "Add a paper from an open tab", placeholder: "Pick the tab showing the paper (DOI, arXiv or PDF page)" });
  if (sourceId !== undefined) ctx.transport.post({ type: "paper.addFrom", folder, sourceId, ifNoPdf: "ask", retryPdf: false });
}

export async function onAddNoPdf(ctx: UiContext, folder: string, sourceId: string, title: string, miss: PdfMiss): Promise<void> {
  const choice = await askNoPdf(title, miss);
  if (choice === "save" || choice === "open" || choice === "author") ctx.transport.post({ type: "paper.addFrom", folder, sourceId, ifNoPdf: choice, retryPdf: false });
  else if (choice === "retry") ctx.transport.post({ type: "paper.addFrom", folder, sourceId, ifNoPdf: "ask", retryPdf: true });
}
