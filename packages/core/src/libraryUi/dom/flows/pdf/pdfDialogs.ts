/**
 * Opens the dialogs around a missing PDF: opening a paper that has none, a search that came back empty, and a capture
 * that found no PDF. The first two offer to attach a file or to search (again); the capture asks whether to save the reference alone.
 * When a sign-in or a bot check stood in the way, the last two also offer to open that page, and where the host can,
 * both offer to email the authors for a copy. A preprint's search for
 * its published version asks first, because the new file replaces the old one.
 */
import { PDF_VERSION_LABEL, isPrePublication } from "../../../../model/index.js";
import { showDialog, type DialogButton } from "../../../../ui/dom/index.js";
import { ASK_AUTHOR_LABEL, findMissMessage, noPdfDialogCopy, pdfAccessLabel } from "../../../pdfCopy.js";
import type { PdfMiss } from "../../../protocol/index.js";
import type { UiContext } from "../../uiContext.js";
import { askAuthor, attachPdf, findPdf } from "../paper/index.js";

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
      ...(access ? [{ id: "open", label: pdfAccessLabel(access), primary: true }] : []),
    ],
  });
  if (choice === "author") askAuthor(ctx, id);
  else if (choice === "attach") attachPdf(ctx, id);
  else if (choice === "retry") findPdf(ctx, id);
  else if (choice === "open" && access) ctx.transport.post({ type: "paper.openForPdf", id, access });
}

/** Asks before looking for the published version of a paper whose PDF is a preprint or an accepted manuscript. */
export async function confirmFindBetterPdf(ctx: UiContext, id: string): Promise<void> {
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
export type NoPdfChoice = "save" | "open" | "author" | "retry";

/**
 * Asks whether a capture without a PDF saves the reference alone, saves it and opens the page that stood in the way
 * ("open"), saves it and emails the authors ("author"), or searches again; undefined when cancelled. `root` mounts the
 * dialog inside a content script's shadow root.
 */
export function askNoPdf(title: string, miss: PdfMiss, root?: ShadowRoot): Promise<NoPdfChoice | undefined> {
  const buttons: Array<DialogButton<NoPdfChoice>> = [
    { id: "retry", label: "Search again" },
    { id: "author", label: ASK_AUTHOR_LABEL },
    { id: "save", label: "Save without PDF", primary: !miss.access },
    ...(miss.access ? [{ id: "open" as const, label: pdfAccessLabel(miss.access), primary: true }] : []),
  ];
  return showDialog({ ...noPdfDialogCopy(title, miss), severity: "warning", buttons, ...(root ? { root } : {}) });
}
