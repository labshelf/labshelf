/**
 * Hosts the library page: dispatches every library UI message to the IndexedDB and background handlers.
 * Attach PDF runs synchronously so its file picker opens inside the click that asked for it.
 */
import { errorMessage, type HostEndpoint, type ILogger, type UiToHost } from "@labshelf/core";
import {
  captureTab, createFolder, createPaperFileHandlers, createPdfHandlers, deleteFolder, exportAnnotations, movePapers, offerOpenTabs, removePapers,
  renameFolder, sendDetails, setNote, setStatus, setTags, writeClipboard, type PaperFileHandlers,
  type PdfHandlers,
} from "./handlers";
import { watchChangeNotices } from "./changeNotices";
import { createHostContext, type HostContext } from "./hostContext";
import { watchLibraryChanges } from "./snapshots";

export interface LibraryHostOptions {
  log: ILogger;
  /** A paper to select once the library has loaded (the page opened from the popup or Scholar). */
  initialPaper?: string | null;
}

function run(ctx: HostContext, work: () => Promise<void>): void {
  void work().catch((err: unknown) => {
    ctx.notice("error", errorMessage(err));
    void ctx.log.error("library-page", err);
  });
}

async function onReady(ctx: HostContext, loaded: () => Promise<void>, initialPaper: string | null | undefined): Promise<void> {
  await loaded();
  if (initialPaper && ctx.papers([initialPaper]).length) ctx.endpoint.post({ type: "select", id: initialPaper });
}

interface Handlers {
  pdf: PdfHandlers;
  files: PaperFileHandlers;
}

function dispatch(ctx: HostContext, { pdf, files }: Handlers, loaded: () => Promise<void>, m: UiToHost, options: LibraryHostOptions): void {
  switch (m.type) {
    case "ready": run(ctx, () => onReady(ctx, loaded, options.initialPaper)); return;
    case "navigate": ctx.folder = m.folder; return;
    case "folder.create": run(ctx, () => createFolder(ctx, m.parent, m.name)); return;
    case "folder.rename": run(ctx, () => renameFolder(ctx, m.path, m.name)); return;
    case "folder.delete": run(ctx, () => deleteFolder(ctx, m.path)); return;
    case "paper.open": run(ctx, () => pdf.open(m.id)); return;
    case "paper.findPdf": run(ctx, () => pdf.find(m.id, m.replace ?? false)); return;
    case "paper.attachPdf": pdf.attach(m.id); return;
    case "paper.openForPdf": run(ctx, () => pdf.openForPdf(m.id, m.access)); return;
    case "paper.askAuthor": run(ctx, () => pdf.askAuthor(m.id)); return;
    case "paper.setStatus": run(ctx, () => setStatus(ctx, m.ids, m.status)); return;
    // The page has no tree of its own to mark, so the selection needs no answer.
    case "paper.selected": return;
    case "paper.files": run(ctx, () => files.list(m.id)); return;
    case "paper.describeFile": run(ctx, () => files.describe(m.id, m.name, m.description)); return;
    case "paper.openFile": run(ctx, () => files.open(m.id, m.name)); return;
    case "paper.copyFilePath": run(ctx, () => files.copyPath(m.id, m.name)); return;
    case "paper.details": run(ctx, () => sendDetails(ctx, m.id)); return;
    case "paper.setTags": run(ctx, () => setTags(ctx, m.ids, m.add, m.remove)); return;
    case "paper.setNote": run(ctx, () => setNote(ctx, m.id, m.note)); return;
    case "annotations.export": run(ctx, () => exportAnnotations(ctx, m.id)); return;
    case "paper.move": run(ctx, () => movePapers(ctx, m.ids, m.target)); return;
    case "paper.remove": run(ctx, () => removePapers(ctx, m.ids)); return;
    case "paper.add": run(ctx, () => offerOpenTabs(ctx, m.folder)); return;
    case "paper.addFrom": run(ctx, () => captureTab(ctx, m.folder, m.sourceId, m.ifNoPdf, m.retryPdf)); return;
    case "clipboard.write": run(ctx, () => writeClipboard(ctx, m.text, m.label)); return;
    default:
      // The page declares none of the capabilities behind the other messages (text layer, similar content, reveal,
      // open in the default app, fetch metadata) and never shows the citation map, so the UI never sends them.
      void ctx.log.log("WARN", "library-page", "Unhandled library UI message", { type: m.type });
  }
}

/** Starts answering the UI on `endpoint`. */
export function attachLibraryHost(
  endpoint: HostEndpoint, options: LibraryHostOptions,
): { reloadSnapshots(): Promise<void>; paperIdAtPath(path: string): Promise<string | null> } {
  const ctx = createHostContext(endpoint, options.log);
  const pdf = createPdfHandlers(ctx);
  const handlers: Handlers = { pdf, files: createPaperFileHandlers(ctx, pdf.open) };
  // The router asks for a paper path while the first load is still running; both wait on the same load.
  let firstLoad: Promise<void> | null = null;
  const loaded = (): Promise<void> => (firstLoad ??= ctx.snapshots.load());
  endpoint.subscribe((m) => dispatch(ctx, handlers, loaded, m, options));
  watchLibraryChanges(ctx.snapshots, ctx.log);
  watchChangeNotices(ctx);
  return {
    reloadSnapshots: () => ctx.snapshots.reload(),
    paperIdAtPath: async (path) => {
      await loaded();
      return ctx.snapshots.current().papers.find((p) => p.path === path)?.id ?? null;
    },
  };
}
