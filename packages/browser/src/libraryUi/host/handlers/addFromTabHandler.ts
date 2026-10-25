// Lists the window's tabs as add sources and captures the picked one into the open folder.
// A capture with no PDF writes nothing until the UI confirms; an existing paper is selected, not duplicated.
import type { IfNoPdf } from "@labshelf/core";
import { formatPdfSourceLabel } from "@labshelf/core";
import { sendRuntime, type SaveOutcome, type TabSummary } from "../../../platform";
import type { HostContext } from "../hostContext";

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}

export async function offerOpenTabs(ctx: HostContext, folder: string): Promise<void> {
  const tabs = await sendRuntime<TabSummary[]>({ type: "tabs.list" });
  if (tabs.length === 0) { ctx.notice("info", "Open the paper's page in another tab first, then click Add again."); return; }
  const sources = tabs.map((t) => ({ id: String(t.id), label: t.title || t.url, description: hostOf(t.url) }));
  ctx.endpoint.post({ type: "add.sources", folder, sources });
}

export async function captureTab(ctx: HostContext, folder: string, sourceId: string, ifNoPdf: IfNoPdf, retryPdf: boolean): Promise<void> {
  const key = `add:${sourceId}`;
  ctx.endpoint.post({ type: "progress", key, text: retryPdf ? "Searching for the PDF…" : "Capturing paper…" });
  let result: SaveOutcome;
  try {
    result = await sendRuntime<SaveOutcome>({ type: "capture.tab", tabId: Number(sourceId), targetFolder: folder, ifNoPdf, ...(retryPdf ? { retryPdf } : {}) });
  } finally {
    ctx.endpoint.post({ type: "progress", key, text: null });
  }
  if (result.status === "no-pdf") {
    ctx.endpoint.post({ type: "add.noPdf", folder, sourceId, title: result.title, miss: result.miss });
    return;
  }
  await ctx.snapshots.refresh();
  ctx.endpoint.post({ type: "select", id: result.id });
  if (result.alreadyInLibrary) ctx.notice("info", `Already in your library — "${result.title}"`);
  else ctx.notice("ok", result.pdfSource ? `Added "${result.title}" (PDF via ${formatPdfSourceLabel(result.pdfSource)})` : `Added "${result.title}" — saved without a PDF`);
}
