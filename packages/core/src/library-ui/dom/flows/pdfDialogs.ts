/**
 * The dialogs around a missing PDF: opening a paper that has none, and a search that came back empty. Both offer to
 * attach a file or to search (again).
 */
import { showDialog } from "../../../ui/dom/index.js";
import { findMissMessage } from "../../pdfCopy.js";
import type { PdfMiss } from "../../protocol/index.js";
import type { UiContext } from "../uiContext.js";
import { attachPdf, findPdf } from "./paperCommands.js";

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
  const choice = await showDialog({
    title: "No PDF found",
    message: findMissMessage(title, miss),
    severity: "warning",
    buttons: [{ id: "attach", label: "Attach PDF…" }, { id: "retry", label: "Search again", primary: true }],
  });
  if (choice === "attach") attachPdf(ctx, id);
  else if (choice === "retry") findPdf(ctx, id);
}
