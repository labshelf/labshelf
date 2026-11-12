// Shows a whole notes file in a tab through the core mountNoteFile (a project note, a paper's notes.qmd): reads it once, queues the item saves and new items one after another, and runs cells through the helper.
import { DEFAULT_NOTE_POPUP, PAPER_NOTES_FILE, PaperNotesStore, posixPathOps, formatError, noteFilesPortFor, parsePaperLink, serializeItemFile, type CellLanguage, type SelectionPopupPrefs, type MathRequest, type NoteFilesPort, type RunCellPort } from "@labshelf/core";
import { mountNoteFile, renderElement, showToast, type NoteFileHandle } from "@labshelf/core/dom";
import type { PaperObjectsPort } from "@labshelf/core/paperObjects";
import { getBrowserCellPorts } from "../../helper";
import { createBrowserNoteFileIo, createPaperNotesPort, listCachedPaperRecords, readCachedPaperRecord } from "../../storage";
import { editorPrefsOf } from "../../writing/editorPrefs";
import { resolvePaperLink } from "../paperLink";
import { openNoteFileLive, type NoteFileLiveBinding } from "./noteFileLive";
import type { TabContext, TabModule } from "./tabKinds";

const MODULE = "tabs.noteFile";

/** Where one notes file is read and written, and what names it. */
export interface NoteFileSource {
  /** Shown while loading and in errors. */
  label: string;
  /** The cell session and view-state key of the note. */
  noteKey: string;
  /** The notes file's library path; when set the tab edits the file's live replica, and reads the file once only when live files are unavailable. A function resolves it when the path is known late (undefined: no live mode). */
  livePath?: string | (() => Promise<string | undefined>);
  read(): Promise<string | null>;
  editItem(itemId: string, body: string): Promise<void>;
  /** Adds an item; without it an empty file only says it is empty. */
  addItem?(itemId: string, body: string): Promise<void>;
  /** Runs the note's cells; the helper's temp folder when absent. */
  runCell?(ports: ReturnType<typeof getBrowserCellPorts>): RunCellPort;
  /** The files beside the note (a chart's CSV); without it the note cannot import or keep files. */
  files?: NoteFilesPort;
  /** Offers From paper… in the note's editors, starting on `defaultPaperId` when given; the inserted images go to `files`. */
  paperObjects?: { port: PaperObjectsPort; defaultPaperId?: string };
}

/**
 * Queues the writes of one note. INVARIANT: writes run one after another, so a later edit of an item never lands before an earlier one, and an item's first edit never before its creation.
 * Only the latest body of each item is written.
 */
function createNoteWriter(ctx: TabContext, source: NoteFileSource) {
  const pending = new Map<string, string>();
  let chain: Promise<boolean> = Promise.resolve(true);
  const enqueue = (work: () => Promise<void>, action: string): Promise<boolean> => {
    chain = chain.then(async () => {
      try { await work(); return true; } catch (error) {
        void ctx.logger.error(MODULE, error, { action, note: source.label });
        showToast(formatError(error), "error");
        return false;
      }
    });
    return chain;
  };
  const flush = (): Promise<boolean> => enqueue(async () => {
    for (const [id, body] of [...pending]) { pending.delete(id); await source.editItem(id, body); }
    ctx.tab.setDirty(pending.size > 0);
  }, "save note");
  return {
    save(id: string, body: string): void { pending.set(id, body); ctx.tab.setDirty(true); void flush(); },
    create(id: string, body: string): void { const { addItem } = source; if (addItem) void enqueue(() => addItem(id, body), "add note"); },
    flush,
  };
}

/** A labshelf: link opens its paper in a tab at its page; a web link opens in a new browser tab. */
async function openNoteLink(ctx: TabContext, href: string): Promise<void> {
  if (!parsePaperLink(href)) {
    if (/^https?:/i.test(href)) window.open(href, "_blank", "noopener");
    return;
  }
  const found = resolvePaperLink(href, await listCachedPaperRecords());
  if (!found.ok) { showToast(found.message, "error"); return; }
  ctx.workspace.openTab("paper", { paperId: found.paperId, ...(found.page === undefined ? {} : { page: String(found.page) }) });
}

export function mountNoteFileTab(host: HTMLElement, ctx: TabContext, source: NoteFileSource): { dispose(): void } {
  const body = host.appendChild(renderElement("div", { class: "ls-workspace-fill ls-note-file" }));
  const writer = createNoteWriter(ctx, source);
  let binding: NoteFileLiveBinding | undefined;
  const ports = getBrowserCellPorts(ctx.logger);
  const { runMath } = ports;
  let handle: NoteFileHandle | undefined;
  let disposed = false;
  ctx.tab.onBeforeClose(async () => { if (!binding) return writer.flush(); await binding.close(); return true; });
  const placeholder = body.appendChild(renderElement("p", { class: "ls-workspace-placeholder" }, `Loading ${source.label}…`));
  // The bubble follows the library's editor-prefs.json, which the source tabs and the other app share.
  const prefs = editorPrefsOf(ctx.fs, ctx.logger);
  let notePopup: SelectionPopupPrefs = DEFAULT_NOTE_POPUP;
  const stopFollowing = prefs.onNotePopupChange((next) => { notePopup = next; });
  const popup = { prefs: () => notePopup, setPrefs: (next: SelectionPopupPrefs) => { notePopup = next; void prefs.setNotePopup(next).catch(() => undefined); } };
  /** The live file of the note, else the file's text read once. */
  const load = async (): Promise<{ live: NoteFileLiveBinding } | { text: string | null }> => {
    const path = typeof source.livePath === "function" ? await source.livePath().catch(() => undefined) : source.livePath;
    const live = path === undefined ? undefined : await openNoteFileLive(ctx.logger, path);
    return live ? { live } : { text: await source.read() };
  };
  void Promise.all([load(), prefs.notePopup().catch(() => DEFAULT_NOTE_POPUP)]).then(([loaded, stored]) => {
    if (disposed) { if ("live" in loaded) void loaded.live.close(); return; }
    if ("live" in loaded) binding = loaded.live;
    const text = "text" in loaded ? loaded.text : null;
    notePopup = stored;
    placeholder.remove();
    handle = mountNoteFile(body, {
      popup, onOpenLink: (href) => { void openNoteLink(ctx, href); },
      text: text ?? "", ...(binding ? { live: binding.live } : {}), noteKey: source.noteKey, ...(source.files ? { files: source.files } : {}),
      ...(source.paperObjects ? { paperObjects: source.paperObjects } : {}), ...(ctx.noteViewState ? { viewState: ctx.noteViewState } : {}),
      save: writer.save, ...(source.addItem ? { create: writer.create } : {}), flush: async () => { await writer.flush(); },
      cells: {
        runCell: source.runCell ? source.runCell(ports) : ports.runCell,
        restart: (language: CellLanguage) => ports.restartCell(source.noteKey, language),
        ...(runMath ? { runMath: (request: MathRequest) => runMath(request) } : {}),
        installPython: () => ports.installPython(),
      },
      onError: (action, error) => { void ctx.logger.error(MODULE, error, { action, note: source.label }); },
    });
  }, (error: unknown) => {
    placeholder.textContent = `Could not open ${source.label}.`;
    void ctx.logger.error(MODULE, error, { action: "open note", note: source.label });
  });
  return {
    dispose() {
      disposed = true;
      stopFollowing();
      // A live note is flushed and released by its binding; the editor goes after the flush either way.
      void (binding ? binding.close() : writer.flush()).then(() => { handle?.destroy(); body.remove(); });
    },
  };
}

/** A port whose folder is resolved on first use, for a note whose record loads asynchronously. */
export function lazyFiles(resolve: () => Promise<NoteFilesPort>): NoteFilesPort {
  let port: Promise<NoteFilesPort> | undefined;
  const get = (): Promise<NoteFilesPort> => (port ??= resolve());
  return {
    read: async (path) => (await get()).read(path),
    write: async (path, bytes) => (await get()).write(path, bytes),
    pickTextFile: async (accept) => (await get()).pickTextFile(accept),
  };
}

/** A paper's notes.qmd as a tab: read and written through the paper notes store, so its path comes from the library layout; an empty file takes a first note. */
export const mountPaperNoteTab: TabModule["mountTab"] = (host, params, ctx) => {
  const paperId = params["paperId"] ?? "";
  const store = new PaperNotesStore(createPaperNotesPort(ctx.fs), { logger: ctx.logger });
  return mountNoteFileTab(host, ctx, {
    label: "notes",
    noteKey: `paper:${paperId}`,
    livePath: async () => { const paper = await readCachedPaperRecord(paperId); return paper ? posixPathOps.join(paper.path, PAPER_NOTES_FILE) : undefined; },
    read: async () => serializeItemFile(await store.read(paperId)),
    editItem: (itemId, body) => store.editItem(paperId, itemId, body),
    addItem: async (itemId, body) => { await store.addItem(paperId, { id: itemId, body }); },
    ...(ctx.paperObjects ? { paperObjects: { port: ctx.paperObjects, defaultPaperId: paperId } } : {}),
    files: lazyFiles(async () => {
      const paper = await readCachedPaperRecord(paperId);
      if (!paper) throw new Error("That paper is not in the library.");
      return noteFilesPortFor(createBrowserNoteFileIo(ctx.fs), paper.path);
    }),
  });
};
