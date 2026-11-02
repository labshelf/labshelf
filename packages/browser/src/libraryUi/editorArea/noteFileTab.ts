// Shows a whole notes file in a tab through the core mountNoteFile (a project note, a paper's notes.qmd): reads it once, queues the item saves and new items one after another, and runs cells through the helper.
import { PaperNotesStore, formatError, serializeItemFile, type CellLanguage, type MathRequest, type RunCellPort } from "@labshelf/core";
import { mountNoteFile, renderElement, showToast, type NoteFileHandle } from "@labshelf/core/dom";
import { getBrowserCellPorts } from "../../helper";
import { createPaperNotesPort } from "../../storage";
import type { TabContext, TabModule } from "./tabKinds";

const MODULE = "tabs.noteFile";

/** Where one notes file is read and written, and what names it. */
export interface NoteFileSource {
  /** Shown while loading and in errors. */
  label: string;
  /** The cell session and view-state key of the note. */
  noteKey: string;
  read(): Promise<string | null>;
  editItem(itemId: string, body: string): Promise<void>;
  /** Adds an item; without it an empty file only says it is empty. */
  addItem?(itemId: string, body: string): Promise<void>;
  /** Runs the note's cells; the helper's temp folder when absent. */
  runCell?(ports: ReturnType<typeof getBrowserCellPorts>): RunCellPort;
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

export function mountNoteFileTab(host: HTMLElement, ctx: TabContext, source: NoteFileSource): { dispose(): void } {
  const body = host.appendChild(renderElement("div", { class: "ls-workspace-fill ls-note-file" }));
  const writer = createNoteWriter(ctx, source);
  const ports = getBrowserCellPorts(ctx.logger);
  const { runMath } = ports;
  let handle: NoteFileHandle | undefined;
  let disposed = false;
  ctx.tab.onBeforeClose(writer.flush);
  const placeholder = body.appendChild(renderElement("p", { class: "ls-workspace-placeholder" }, `Loading ${source.label}…`));
  void source.read().then((text) => {
    if (disposed) return;
    placeholder.remove();
    handle = mountNoteFile(body, {
      text: text ?? "", noteKey: source.noteKey, ...(ctx.noteViewState ? { viewState: ctx.noteViewState } : {}),
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
      void writer.flush().then(() => { handle?.destroy(); body.remove(); });
    },
  };
}

/** A paper's notes.qmd as a tab: read and written through the paper notes store, so its path comes from the library layout; an empty file takes a first note. */
export const mountPaperNoteTab: TabModule["mountTab"] = (host, params, ctx) => {
  const paperId = params["paperId"] ?? "";
  const store = new PaperNotesStore(createPaperNotesPort(ctx.fs), { logger: ctx.logger });
  return mountNoteFileTab(host, ctx, {
    label: "notes",
    noteKey: `paper:${paperId}`,
    read: async () => serializeItemFile(await store.read(paperId)),
    editItem: (itemId, body) => store.editItem(paperId, itemId, body),
    addItem: async (itemId, body) => { await store.addItem(paperId, { id: itemId, body }); },
  });
};
