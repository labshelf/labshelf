// Wires the library page host: what its handlers share (the channel to the UI, snapshots, mutations, logger, current folder), the dispatch of UI messages to them and adding papers to a Space.
import {
  PAPERS_DIR, formatError, movePaperFolders, removePapers, sendPaperDetails, setPaperNote, setPaperTags, type HostEndpoint, type LibraryUiHost, type ILogger, type PaperRecord, type ProjectShareDeps, type ShareHost, type SpaceStore, type UiToHost,
} from "@labshelf/core";
import { askInputBox, pickQuickEntry } from "@labshelf/core/dom";
import { bx, type LibraryChangedEvent } from "../../platform";
import { createLibraryMutations, type LibraryMutations } from "../../storage";
import {
  addTabPaper, createFolder, createLibraryUiHost, createPaperFileHandlers, createPdfHandlers, exportAnnotations, offerOpenTabs, removeFolder,
  renameFolder, setReadingStatus, writeClipboard, type PaperFileHandlers, type PdfHandlers,
} from "./handlers";
import { createBrowserShareHost, type ShareLinkRelay } from "./browserShareHost";
import { createLibrarySnapshots, createSidecarReads, watchLibraryChanges, type LibrarySnapshots, type SidecarReads } from "./snapshots";


export interface HostContext {
  endpoint: HostEndpoint;
  snapshots: LibrarySnapshots;
  sidecars: SidecarReads;
  mutations: LibraryMutations;
  log: ILogger;
  /** The folder the UI shows, kept from its navigate messages. */
  folder: string;
  notice(kind: "info" | "ok" | "error", text: string): void;
  /** The records of `ids` that exist, in the order given. */
  papers(ids: readonly string[]): PaperRecord[];
}

function createHostCompositionRoot(endpoint: HostEndpoint, log: ILogger): HostContext {
  const sidecars = createSidecarReads(log);
  const snapshots = createLibrarySnapshots(endpoint, sidecars);
  return {
    endpoint, snapshots, sidecars, log,
    mutations: createLibraryMutations(log),
    folder: PAPERS_DIR,
    notice: (kind, text) => endpoint.post({ type: "notice", kind, text }),
    papers: (ids) => {
      const byId = new Map(snapshots.current().papers.map((p) => [p.id, p]));
      return ids.map((id) => byId.get(id)).filter((p): p is PaperRecord => !!p);
    },
  };
}

/** @returns a function that stops listening */
function watchChangeNotices(ctx: HostContext): () => void {
  // Must stay synchronous and return nothing: a listener returning a Promise would answer popup requests with undefined.
  const onRuntime = (msg: unknown): void => {
    const change = msg as LibraryChangedEvent | undefined;
    if (change?.type === "library.changed" && change.notice) ctx.notice("ok", change.notice);
  };
  bx.runtime.onMessage.addListener(onRuntime);
  return () => bx.runtime.onMessage.removeListener(onRuntime);
}

export interface LibraryHostOptions {
  log: ILogger;
  /** The page's Spaces, which papers are added to. */
  spaces?: { store: SpaceStore };
  /** A paper to select once the library has loaded (the page opened from the popup or Scholar). */
  initialPaper?: string | null;
  /** Receives the ids the UI reports as selected (an empty list when nothing is). */
  onSelection?: (ids: string[]) => void;
  /** The owner's relay, which a folder shared as a link is uploaded to. */
  shareRelay: ShareLinkRelay;
}

function run(ctx: HostContext, work: () => Promise<void>): void {
  void work().catch((err: unknown) => {
    ctx.notice("error", formatError(err));
    void ctx.log.error("libraryUi", err);
  });
}

// A repeat ready (another surface mounting after the load) gets the snapshot the first load already posted.
async function onReady(ctx: HostContext, loaded: () => Promise<void>, initialPaper: string | null | undefined, repeat: boolean): Promise<void> {
  await loaded();
  if (repeat) { ctx.endpoint.post({ type: "snapshot", snapshot: ctx.snapshots.current() }); return; }
  if (initialPaper && ctx.papers([initialPaper]).length) ctx.endpoint.post({ type: "select", id: initialPaper });
}

interface Handlers {
  ui: LibraryUiHost;
  pdf: PdfHandlers;
  files: PaperFileHandlers;
}

function dispatch(ctx: HostContext, { ui, pdf, files }: Handlers, loaded: () => Promise<void>, m: UiToHost, options: LibraryHostOptions, repeat: boolean): void {
  switch (m.type) {
    case "ready": run(ctx, () => onReady(ctx, loaded, options.initialPaper, repeat)); return;
    case "navigate": ctx.folder = m.folder; return;
    case "folder.create": run(ctx, () => createFolder(ctx, m.parent, m.name)); return;
    case "folder.rename": run(ctx, () => renameFolder(ctx, m.path, m.name)); return;
    case "folder.delete": run(ctx, () => removeFolder(ctx, m.path)); return;
    case "paper.open": run(ctx, () => pdf.open(m.id)); return;
    case "paper.findPdf": run(ctx, () => pdf.find(m.id, m.replace ?? false)); return;
    case "paper.attachPdf": pdf.attach(m.id); return;
    case "paper.openForPdf": run(ctx, () => pdf.openForPdf(m.id, m.access)); return;
    case "paper.askAuthor": run(ctx, () => pdf.askAuthor(m.id)); return;
    case "paper.setStatus": run(ctx, () => setReadingStatus(ctx, m.ids, m.status)); return;
    // The page has no tree of its own to mark, so the selection needs no answer.
    case "paper.selected": options.onSelection?.(m.ids); return;
    case "paper.files": run(ctx, () => files.list(m.id)); return;
    case "paper.describeFile": run(ctx, () => files.describe(m.id, m.name, m.description)); return;
    case "paper.openFile": run(ctx, () => files.open(m.id, m.name)); return;
    case "paper.copyFilePath": run(ctx, () => files.copyPath(m.id, m.name)); return;
    case "paper.details": run(ctx, () => sendPaperDetails(ui, m.id)); return;
    case "paper.setTags": run(ctx, () => setPaperTags(ui, m.ids, m.add, m.remove)); return;
    case "paper.setNote": run(ctx, () => setPaperNote(ui, m.id, m.note)); return;
    case "annotations.export": run(ctx, () => exportAnnotations(ctx, m.id)); return;
    case "paper.addToSpace":
      run(ctx, async () => {
        if (!options.spaces) throw new Error("Spaces are unavailable on this page");
        await addToSpace(options.spaces.store, m.ids, ctx.notice, ctx.log);
      });
      return;
    case "paper.move": run(ctx, () => movePaperFolders(ui, m.ids, m.target)); return;
    case "paper.remove": run(ctx, () => removePapers(ui, m.ids)); return;
    case "paper.add": run(ctx, () => offerOpenTabs(ctx, m.folder)); return;
    case "paper.addFrom": run(ctx, () => addTabPaper(ctx, m.folder, m.sourceId, m.ifNoPdf, m.retryPdf)); return;
    case "clipboard.write": run(ctx, () => writeClipboard(ctx, m.text, m.label)); return;
    default:
      // The page declares none of the capabilities behind the other messages (text layer, similar content, reveal,
      // open in the default app, fetch metadata) and never shows the citation map, so the UI never sends them.
      void ctx.log.log("WARN", "libraryUi", "Unhandled library UI message", { type: m.type });
  }
}

/** Adds papers to the Space the user picks, or to a new one. */
export async function addToSpace(
  store: SpaceStore, ids: string[], notice: (kind: "ok", text: string) => void, log: ILogger,
): Promise<void> {
  const choices = store.list().flatMap((result) => result.state === "ready" ? [{ label: result.space.name, value: result.space.id }] : []);
  const choice = await pickQuickEntry<string | { create: true }>([...choices, { label: "New Space…", value: { create: true } }], { title: "Add to Space" });
  if (choice === undefined) return;
  let id: string;
  if (typeof choice === "string") id = choice;
  else {
    const name = await askInputBox({ title: "New Space", validate: (value) => value.trim() ? null : "Enter a Space name" });
    if (name === undefined) return;
    id = await store.createSpace(name);
  }
  await store.addPapers(id, ids);
  void log.log("INFO", "spaces", "Added papers to Space", { spaceId: id, paperIds: ids });
  notice("ok", `Added ${ids.length === 1 ? "paper" : "papers"} to Space`);
}

/** Starts answering the UI on `endpoint`. */
export function attachLibraryHost(
  endpoint: HostEndpoint, options: LibraryHostOptions,
): { reloadSnapshots(): Promise<void>; paperIdAtPath(path: string): Promise<string | null>; sharing: ShareHost; addProjectSharing(deps: ProjectShareDeps): void } {
  const ctx = createHostCompositionRoot(endpoint, options.log);
  const pdf = createPdfHandlers(ctx);
  const { host: sharing, addProjects } = createBrowserShareHost(ctx, options.shareRelay, options.log);
  const handlers: Handlers = { ui: createLibraryUiHost(ctx), pdf, files: createPaperFileHandlers(ctx, pdf.open) };
  // The router asks for a paper path while the first load is still running; both wait on the same load.
  let firstLoad: Promise<void> | null = null;
  const loaded = (): Promise<void> => (firstLoad ??= ctx.snapshots.load());
  let readySeen = false;
  endpoint.subscribe((m) => {
    const repeat = m.type === "ready" && readySeen;
    if (m.type === "ready") readySeen = true;
    dispatch(ctx, handlers, loaded, m, options, repeat);
  });
  watchLibraryChanges(ctx.snapshots, ctx.log);
  watchChangeNotices(ctx);
  return {
    reloadSnapshots: () => ctx.snapshots.reload(),
    sharing,
    addProjectSharing: addProjects,
    paperIdAtPath: async (path) => {
      await loaded();
      return ctx.snapshots.current().papers.find((p) => p.path === path)?.id ?? null;
    },
  };
}
