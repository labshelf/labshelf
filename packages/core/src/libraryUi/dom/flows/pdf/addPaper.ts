/**
 * Adds a paper: the user picks one of the sources the host offers (an open tab in the browser), and when the
 * capture finds no PDF, decides between searching again, saving the reference alone, saving it while opening the
 * page that stood in the way, and saving it while emailing the authors.
 */
import { quickPick } from "../../../../ui/dom/index.js";
import type { AddSource, PdfMiss } from "../../../protocol/index.js";
import type { UiContext } from "../../uiContext.js";
import { askNoPdf } from "./pdfDialogs.js";

/** Asks the host what a paper can be added from; papers land in the open folder. */
export function sendAddPaperRequest(ctx: UiContext): void {
  ctx.transport.post({ type: "paper.add", folder: ctx.store.get().folder });
}

export async function onAddSources(ctx: UiContext, folder: string, sources: AddSource[]): Promise<void> {
  const items = sources.map((s) => ({ label: s.label, description: s.description, icon: "globe" as const, value: s.id }));
  const sourceId = await quickPick(items, { title: "Add a paper from an open tab", placeholder: "Pick the tab showing the paper (DOI, arXiv or PDF page)" });
  if (sourceId !== undefined) ctx.transport.post({ type: "paper.addFrom", folder, sourceId, ifNoPdf: "ask", retryPdf: false });
}

export async function onAddNoPdf(ctx: UiContext, folder: string, sourceId: string, title: string, miss: PdfMiss): Promise<void> {
  const choice = await askNoPdf(title, miss);
  if (choice === "save" || choice === "open" || choice === "author") ctx.transport.post({ type: "paper.addFrom", folder, sourceId, ifNoPdf: choice, retryPdf: false });
  else if (choice === "retry") ctx.transport.post({ type: "paper.addFrom", folder, sourceId, ifNoPdf: "ask", retryPdf: true });
}
