/**
 * Adding a paper from another open tab: the host lists the window's tabs as add sources, then captures the one the
 * user picked into the open folder. A capture that found no PDF writes nothing and asks the UI first; a paper already
 * in the library is selected instead of duplicated.
 */
import type { IfNoPdf } from "@labshelf/core";
import { pdfSourceLabel } from "@labshelf/core";
import type { SaveOutcome, TabSummary } from "../../../platform";
import type { HostContext } from "../hostContext";
import { send } from "../runtimeRequests";

function hostOf(url: string): string {
  try { return new URL(url).hostname; } catch { return ""; }
}

export async function offerOpenTabs(ctx: HostContext, folder: string): Promise<void> {
  const tabs = await send<TabSummary[]>({ type: "tabs.list" });
  if (tabs.length === 0) { ctx.notice("info", "Open the paper's page in another tab first, then click Add again."); return; }
  const sources = tabs.map((t) => ({ id: String(t.id), label: t.title || t.url, description: hostOf(t.url) }));
  ctx.endpoint.post({ type: "add.sources", folder, sources });
}

export async function captureTab(ctx: HostContext, folder: string, sourceId: string, ifNoPdf: IfNoPdf, retryPdf: boolean): Promise<void> {
  const key = `add:${sourceId}`;
  ctx.endpoint.post({ type: "progress", key, text: retryPdf ? "Searching for the PDF…" : "Capturing paper…" });
  let result: SaveOutcome;
  try {
    result = await send<SaveOutcome>({ type: "capture.tab", tabId: Number(sourceId), targetFolder: folder, ifNoPdf, ...(retryPdf ? { retryPdf } : {}) });
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
  else ctx.notice("ok", result.pdfSource ? `Added "${result.title}" (PDF via ${pdfSourceLabel(result.pdfSource)})` : `Added "${result.title}" — saved without a PDF`);
}
