// Mounts a whole notes file: the note bar, then one rich editor per item in file order, each in its own card with the item's author and date; the host saves, creates items and runs cells through ports.
import { formatError } from "../../errors/index.js";
import { createCellRuns, type CellLanguage, type MathRequest, type MathResult, type RunCellPort } from "../compute/index.js";
import { newItemId, parseItemFile, sameItemBody, type ItemSegment } from "../item/index.js";
import type { QmdViewStatePort } from "../noteViewState.js";
import { renderElement, showToast } from "../../ui/dom/index.js";
import { createCellRunGroup, type CellRunGroup } from "./cellRunStatus.js";
import { createCellsAbove, type OnEvalMath } from "./evalMathBridge.js";
import { mountNoteBar, type NoteBarEditor } from "./noteBar.js";
import { createLineNumbering, type LineNumbering } from "./lineGutter.js";
import { mountQmdEditor, QMD_VOCABULARY, type QmdEditorHandle } from "./qmdEditor.js";

/** How the host runs the cells of the note; without `runCell` the cells show their stored outputs and Run reports that the host has no runner. */
export interface NoteFileCells {
  runCell?: RunCellPort;
  /** Drops the note's process for `language`; a failure rejects. */
  restart?(language: CellLanguage): Promise<void>;
  /** Evaluates or checks prose math in the note's session. */
  runMath?(request: MathRequest): Promise<MathResult>;
  installPython?(): void;
}

export interface NoteFileOptions {
  /** The file text. */
  text: string;
  /** The note's key: its cell session key, and with `\n<item id>` the view-state key of each item. */
  noteKey: string;
  /** Stores an item's new body; the host queues and persists it. */
  save(itemId: string, body: string): void;
  /** Adds item `itemId` with `body` at the end of the file; when given, an empty file shows an editor whose first text becomes the first item. */
  create?(itemId: string, body: string): void;
  /** Resolves once every save the host queued has landed. */
  flush?(): Promise<void> | void;
  cells?: NoteFileCells;
  viewState?: QmdViewStatePort;
  /** Receives every failure the mount handles itself (a cell run, a restart). */
  onError?(action: string, error: unknown): void;
}

export interface NoteFileHandle {
  /** The editors in file order. */
  readonly editors: readonly NoteBarEditor[];
  /** Shows a new version of the file: bodies that differ from the ones shown are replaced; a change of the items' ids or order mounts the items again. */
  update(text: string): void;
  destroy(): void;
}

type Item = Pick<ItemSegment, "id" | "body" | "author" | "created">;

/** The items of a notes file, in file order. */
export function listNoteFileItems(text: string): Item[] {
  return parseItemFile(text).segments.flatMap((segment) => (segment.kind === "item" ? [segment] : []));
}

/** The editor header's `meta`, with only the fields the item has. */
const metaOf = (item: Item): { author?: string; date?: string } => ({
  ...(item.author === undefined ? {} : { author: item.author }), ...(item.created === undefined ? {} : { date: item.created.slice(0, 10) }),
});

interface Mounted { itemId: string; handle: QmdEditorHandle; card: HTMLElement }

function createRunner(options: NoteFileOptions, group: CellRunGroup) {
  const runs = createCellRuns();
  const { cells, noteKey } = options;
  const fail = (action: string, error: unknown): void => { options.onError?.(action, error); };
  const evalMath: OnEvalMath | undefined = cells?.runMath && ((request, callback) => {
    void cells.runMath!({ noteKey, op: request.op, tex: request.tex }).then(callback, (error: unknown) => {
      callback({ state: "failed", rewrites: [], messages: [formatError(error)] });
    });
  });
  return {
    runs, evalMath,
    restart(language: string): Promise<void> {
      if (!cells?.restart) return Promise.resolve();
      return cells.restart(language as CellLanguage).catch((error: unknown) => { fail("restart cell", error); throw error; });
    },
    canRun: (): boolean => cells?.runCell !== undefined,
  };
}

/** Mounts the notes file `options.text` into `host`. */
export function mountNoteFile(host: HTMLElement, options: NoteFileOptions): NoteFileHandle {
  const root = host.appendChild(renderElement("div", { class: "qmd-note-file", role: "group", "aria-label": QMD_VOCABULARY.item }));
  const latest = new Map<string, string>();
  let mounted: Mounted[] = [];
  let items: Item[] = [];
  // One numbering for the whole file: each item's line numbers continue the previous item's. A remount starts a new one.
  let numbering: LineNumbering = createLineNumbering();
  const group = createCellRunGroup({ onCancel: (requestId) => runner.runs.cancel(requestId), onInstallPython: () => options.cells?.installPython?.() });
  const runner = createRunner(options, group);
  const barHost = root.appendChild(renderElement("div", { class: "qmd-note-file-bar" }));
  const list = root.appendChild(renderElement("div", { class: "qmd-note-file-items" }));
  // The bar reads the editors only on an action, so it is mounted before them and hands each its actions; a file without items has no bar.
  let bar: ReturnType<typeof mountNoteBar> | undefined;
  const showBar = (shown: boolean): ReturnType<typeof mountNoteBar> | undefined => {
    if (shown && !bar) {
      bar = mountNoteBar(barHost, {
        editors: () => mounted, flush: async () => { for (const editor of mounted) editor.handle.flush(); await options.flush?.(); },
        restart: (language) => runner.restart(language), canRun: runner.canRun,
      });
    } else if (!shown && bar) { bar.destroy(); bar = undefined; barHost.replaceChildren(); }
    return bar;
  };

  const change = (itemId: string, body: string): void => { latest.set(itemId, body); options.save(itemId, body); };
  const bodyOf = (id: string): string | undefined => latest.get(id) ?? items.find((item) => item.id === id)?.body;

  const runOptions = (item: Item, card: HTMLElement, editor: () => QmdEditorHandle | undefined) => {
    const onRunCell = group.attach(item.id, card, (label, code, requestId, language, params, preview) => {
      void runner.runs.run(options.cells?.runCell, { requestId, label, code, language, noteKey: options.noteKey, ...(params ? { params } : {}), ...(preview ? { preview } : {}) }, {
        read: () => Promise.resolve(bodyOf(item.id)),
        write: (next) => { editor()?.setBody(next); change(item.id, next); return Promise.resolve(); },
        push: () => undefined,
        post: (state, info) => { group.show(requestId, state, info); },
        preview: (result) => { group.showPreview(requestId, result); },
        fail: (error) => { options.onError?.("run cell", error); showToast(`The cell could not run — ${formatError(error)}`, "error"); },
      });
    }, (language) => { void runner.restart(language).catch(() => undefined); });
    const onRestartCell = group.restartCell(item.id);
    const cellsAbove = createCellsAbove(
      () => items.slice(0, items.findIndex((other) => other.id === item.id)).map((earlier) => bodyOf(earlier.id) ?? ""), () => bodyOf(item.id) ?? "");
    return { onRunCell, ...(onRestartCell ? { onRestartCell } : {}), ...(runner.evalMath ? { onEvalMath: runner.evalMath, cellsAbove } : {}) };
  };

  const mountItem = (item: Item, actions: ReturnType<typeof mountNoteBar>): Mounted => {
    const card = list.appendChild(renderElement("article", { class: "qmd-note-file-item", "data-item-id": item.id }));
    const editorHost = card.appendChild(renderElement("div", { class: "qmd-note-file-editor" }));
    let handle: QmdEditorHandle | undefined;
    handle = mountQmdEditor(editorHost, {
      body: item.body, onChange: (next) => change(item.id, next), meta: metaOf(item),
      ...runOptions(item, editorHost, () => handle),
      noteActions: actions.actionsFor(item.id), gutter: { numbering },
      ...(options.viewState ? { viewState: { port: options.viewState, key: `${options.noteKey}\n${item.id}` } } : {}),
    });
    return { itemId: item.id, handle, card };
  };

  /** An empty file: one editor whose first text becomes the file's first item, or a line saying the note is empty. */
  const mountEmpty = (): void => {
    const { create } = options;
    if (!create) { list.append(renderElement("p", { class: "ls-empty-text" }, `This ${QMD_VOCABULARY.item} is empty.`)); return; }
    const card = list.appendChild(renderElement("article", { class: "qmd-note-file-item is-new" }));
    const editorHost = card.appendChild(renderElement("div", { class: "qmd-note-file-editor" }));
    let itemId: string | undefined;
    const handle = mountQmdEditor(editorHost, {
      body: "", gutter: { numbering },
      onChange: (next) => {
        if (itemId !== undefined) { change(itemId, next); return; }
        if (next.trim() === "") return;
        itemId = newItemId();
        const item: Item = { id: itemId, body: next };
        latest.set(itemId, next);
        items = [item];
        mounted = [{ itemId, handle, card }];
        card.setAttribute("data-item-id", itemId);
        create(itemId, next);
      },
    });
  };

  const unmountAll = (): void => {
    for (const editor of mounted) editor.handle.destroy();
    group.clear();
    mounted = [];
    list.replaceChildren();
    numbering = createLineNumbering();
  };

  const render = (text: string): void => {
    unmountAll();
    latest.clear();
    items = listNoteFileItems(text);
    const actions = showBar(items.length > 0);
    if (!actions) { mountEmpty(); return; }
    mounted = items.map((item) => mountItem(item, actions));
  };

  render(options.text);
  return {
    get editors() { return mounted; },
    update(text) {
      const next = listNoteFileItems(text);
      const sameItems = next.length === mounted.length && next.every((item, index) => item.id === mounted[index]!.itemId);
      if (!sameItems) { render(text); bar?.refresh(); return; }
      next.forEach((item, index) => {
        const shown = latest.get(item.id) ?? items[index]!.body;
        if (sameItemBody(shown, item.body)) return;
        latest.set(item.id, item.body);
        mounted[index]!.handle.setBody(item.body);
      });
      items = next;
    },
    destroy() { unmountAll(); showBar(false); root.remove(); },
  };
}
