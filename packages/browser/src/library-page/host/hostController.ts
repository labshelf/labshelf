/**
 * The library page's host: answers every message the library UI sends by dispatching to the IndexedDB and background
 * handlers. Failures become error notices. Attach PDF is dispatched synchronously so its file picker opens inside
 * the click that asked for it.
 */
import type { HostEndpoint, UiToHost } from "@labshelf/core";
import { offerOpenTabs, captureTab } from "./addFromTabHandler";
import { deleteFolder, createFolder, renameFolder } from "./folderHandlers";
import { createHostContext, type HostContext } from "./hostContext";
import { watchLibraryChanges } from "./librarySnapshots";
import { movePapers, removePapers, setStatus, writeClipboard } from "./paperHandlers";
import { createPdfHandlers, type PdfHandlers } from "./pdfHandlers";
import { errorMessage } from "./runtimeRequests";

export interface LibraryHostOptions {
  /** A paper to select once the library has loaded (the page opened from the popup or Scholar). */
  initialPaper?: string | null;
}

function run(ctx: HostContext, work: () => Promise<void>): void {
  void work().catch((err: unknown) => {
    ctx.notice("error", errorMessage(err));
    void ctx.log.error("library-page", err);
  });
}

async function onReady(ctx: HostContext, initialPaper: string | null | undefined): Promise<void> {
  await ctx.snapshots.load();
  if (initialPaper && ctx.papers([initialPaper]).length) ctx.endpoint.post({ type: "select", id: initialPaper });
}

function dispatch(ctx: HostContext, pdf: PdfHandlers, m: UiToHost, options: LibraryHostOptions): void {
  switch (m.type) {
    case "ready": run(ctx, () => onReady(ctx, options.initialPaper)); return;
    case "navigate": ctx.folder = m.folder; return;
    case "folder.create": run(ctx, () => createFolder(ctx, m.parent, m.name)); return;
    case "folder.rename": run(ctx, () => renameFolder(ctx, m.path, m.name)); return;
    case "folder.delete": run(ctx, () => deleteFolder(ctx, m.path)); return;
    case "paper.open": run(ctx, () => pdf.open(m.id)); return;
    case "paper.findPdf": run(ctx, () => pdf.find(m.id)); return;
    case "paper.attachPdf": pdf.attach(m.id); return;
    case "paper.setStatus": run(ctx, () => setStatus(ctx, m.ids, m.status)); return;
    case "paper.move": run(ctx, () => movePapers(ctx, m.ids, m.target)); return;
    case "paper.remove": run(ctx, () => removePapers(ctx, m.ids)); return;
    case "paper.add": run(ctx, () => offerOpenTabs(ctx, m.folder)); return;
    case "paper.addFrom": run(ctx, () => captureTab(ctx, m.folder, m.sourceId, m.ifNoPdf, m.retryPdf)); return;
    case "clipboard.write": run(ctx, () => writeClipboard(ctx, m.text, m.label)); return;
    default:
      // The page declares none of the capabilities behind the other messages, so the UI never sends them.
      void ctx.log.warn("Unhandled library UI message", { type: m.type });
  }
}

/** Starts answering the UI on `endpoint`; returns the host context for page glue (sync, status bar). */
export function attachLibraryHost(endpoint: HostEndpoint, options: LibraryHostOptions = {}): HostContext {
  const ctx = createHostContext(endpoint);
  const pdf = createPdfHandlers(ctx);
  endpoint.subscribe((m) => dispatch(ctx, pdf, m, options));
  watchLibraryChanges(ctx.snapshots, ctx.log);
  return ctx;
}
