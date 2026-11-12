// Mounts a whole notes file: the note bar, then one rich editor per item in file order, each in its own card with the item's author and date; the host saves, creates items and runs cells through ports.
// In live mode the items come from a qmd doc and each editor edits its item's fragment (noteFileLive.ts follows the doc).
import type * as Y from "yjs";
import { formatError } from "../../errors/index.js";
import { createCellRuns, type CellLanguage, type MathRequest, type MathResult, type RunCellPort } from "../compute/index.js";
import { newItemId, parseItemFile, sameItemBody, type ItemSegment } from "../item/index.js";
import type { NoteFilesPort } from "../noteFiles.js";
import type { QmdViewStatePort } from "../noteViewState.js";
import { renderElement, showToast } from "../../ui/dom/index.js";
import { createCellRunGroup, type CellRunGroup } from "./cellRunStatus.js";
import { createCellsAbove, type OnEvalMath } from "./evalMathBridge.js";
import { mountNoteBar, type NoteBarEditor } from "./noteBar.js";
import { createLineNumbering, type LineNumbering } from "./lineGutter.js";
import { mountQmdEditor, QMD_VOCABULARY, type QmdEditorHandle, type QmdEditorOptions } from "./qmdEditor.js";
import type { QmdPopupOptions } from "./qmdBubble.js";
import type { NotePaperObjects } from "./paperObjectPicker.js";
import { followLiveItems, placeLiveCards, toLiveItem, type LiveItems } from "./noteFileLive.js";
import type { QmdDocItem } from "../qmdDocItems.js";

/** How the host runs the cells of the note; without `runCell` the cells show their stored outputs and Run reports that the host has no runner. */
export interface NoteFileCells {
  runCell?: RunCellPort;
  /** Drops the note's process for `language`; a failure rejects. */
  restart?(language: CellLanguage): Promise<void>;
  /** Evaluates or checks prose math in the note's session. */
  runMath?(request: MathRequest): Promise<MathResult>;
  installPython?(): void;
}

/** A live qmd doc to edit in place: the editors bind to its item fragments and `persist` writes it to disk at once. */
interface NoteFileLive { doc: Y.Doc; persist(): Promise<void> | void }

export interface NoteFileOptions {
  /** The file text; ignored with `live`. */
  text: string;
  /** The note's key: its cell session key, and with `\n<item id>` the view-state key of each item. */
  noteKey: string;
  /** Stores an item's new body; the host queues and persists it. Never called with `live`: the fragment edit is the save. */
  save(itemId: string, body: string): void;
  /** Adds item `itemId` with `body` at the end of the file; when given, an empty file shows an editor whose first text becomes the first item. */
  create?(itemId: string, body: string): void;
  /** Resolves once every save the host queued has landed; with `live`, `live.persist` takes its place. */
  flush?(): Promise<void> | void;
  /** Binds the mount to a qmd doc: one editor per doc item on its fragment (no awareness), following the doc's items in place. */
  live?: NoteFileLive;
  cells?: NoteFileCells;
  viewState?: QmdViewStatePort;
  /** Reads and writes the files beside the note (a chart's CSV under assets/); absent means the editors keep chart data inline. */
  files?: NoteFilesPort;
  /** Offers From paper… in each item editor: a library paper's equations, figures and tables, starting on `defaultPaperId` (the note's paper) when given. */
  paperObjects?: NotePaperObjects;
  /** Opens a link of the note, such as a `labshelf:` link to a paper's page; also gives the bubble Open in PDF. */
  onOpenLink?(href: string): void;
  /** The bubble's settings (the notePopup of editor-prefs.json), with `setPrefs` to save them from Customize popup…. */
  popup?: QmdPopupOptions;
  /** Receives every failure the mount handles itself (a cell run, a restart). */
  onError?(action: string, error: unknown): void;
}

export interface NoteFileHandle {
  /** The editors in file order. */
  readonly editors: readonly NoteBarEditor[];
  /** Shows a new version of the file: bodies that differ from the ones shown are replaced; a change of the items' ids or order mounts the items again. Ignored with `live`. */
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

/** `live` marks an editor of a doc item, which the live follower owns. */
interface Mounted { itemId: string; handle: QmdEditorHandle; card: HTMLElement; live?: boolean }

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

/** What one mounted notes file holds: its options, the bodies edited since the text arrived, the mounted editors and the items they show. */
interface NoteFileState {
  options: NoteFileOptions;
  latest: Map<string, string>;
  mounted: Mounted[];
  items: Item[];
  /** One numbering for the whole file: each item's line numbers continue the previous item's. A remount starts a new one. */
  numbering: LineNumbering;
  group: CellRunGroup;
  runner: ReturnType<typeof createRunner>;
  barHost: HTMLElement;
  list: HTMLElement;
  bar: ReturnType<typeof mountNoteBar> | undefined;
  /** The editor of an empty file until its first text makes it an item: the bar's switch reaches it too. */
  empty: Mounted | undefined;
  /** The follower of `options.live`'s items while mounted. */
  live: LiveItems<Mounted> | undefined;
}

type NoteBarActions = ReturnType<typeof mountNoteBar>;

// The bar reads the editors only on an action, so it is mounted before them and hands each its actions; an empty file has it too, for the Advanced switch.
function showBar(s: NoteFileState, shown: boolean): NoteBarActions | undefined {
  if (shown && !s.bar) {
    s.bar = mountNoteBar(s.barHost, {
      editors: () => (s.mounted.length > 0 || !s.empty ? s.mounted : [s.empty]), flush: async () => {
        for (const editor of s.mounted) editor.handle.flush();
        const { live } = s.options;
        await (live ? live.persist() : s.options.flush?.());
      },
      restart: (language) => s.runner.restart(language), canRun: s.runner.canRun,
    });
  } else if (!shown && s.bar) { s.bar.destroy(); s.bar = undefined; s.barHost.replaceChildren(); }
  return s.bar;
}

// A live item's body is its fragment, which the editor already changed.
function change(s: NoteFileState, itemId: string, body: string): void { if (s.options.live) return; s.latest.set(itemId, body); s.options.save(itemId, body); }
const bodyOf = (s: NoteFileState, id: string): string | undefined => s.latest.get(id) ?? s.items.find((item) => item.id === id)?.body;

/** The cell-run and math options of one item's editor. */
function runOptions(s: NoteFileState, item: Item, card: HTMLElement, editor: () => QmdEditorHandle | undefined) {
  const { options, group, runner } = s;
  const onRunCell = group.attach(item.id, card, (label, code, requestId, language, params, preview) => {
    void runner.runs.run(options.cells?.runCell, { requestId, label, code, language, noteKey: options.noteKey, ...(params ? { params } : {}), ...(preview ? { preview } : {}) }, {
      read: () => Promise.resolve(bodyOf(s, item.id)),
      write: (next) => { editor()?.setBody(next); change(s, item.id, next); return Promise.resolve(); },
      push: () => undefined,
      post: (state, info) => { group.show(requestId, state, info); },
      preview: (result) => { group.showPreview(requestId, result); },
      fail: (error) => { options.onError?.("run cell", error); showToast(`The cell could not run — ${formatError(error)}`, "error"); },
    });
  }, (language) => { void runner.restart(language).catch(() => undefined); });
  const onRestartCell = group.restartCell(item.id);
  const cellsAbove = createCellsAbove(
    () => s.items.slice(0, s.items.findIndex((other) => other.id === item.id)).map((earlier) => bodyOf(s, earlier.id) ?? ""), () => bodyOf(s, item.id) ?? "");
  return { onRunCell, ...(onRestartCell ? { onRestartCell } : {}), ...(runner.evalMath ? { onEvalMath: runner.evalMath, cellsAbove } : {}) };
}

/** An item editor's host options: the note's files, links, bubble settings and From paper… (the host's port, with the other items' bodies for the equation labels already taken). */
function hostOptions(s: NoteFileState, itemId: string): Pick<QmdEditorOptions, "files" | "onOpenLink" | "popup" | "paperObjects"> {
  const { paperObjects, files, onOpenLink, popup } = s.options;
  return {
    ...(files ? { files } : {}), ...(onOpenLink ? { onOpenLink } : {}), ...(popup ? { popup } : {}),
    ...(paperObjects ? { paperObjects: { ...paperObjects, otherBodies: () => s.items.filter((other) => other.id !== itemId).map((other) => bodyOf(s, other.id) ?? "") } } : {}),
  };
}

/** One item's card and editor; with `fragment` the editor edits that fragment of the live doc. */
function mountItem(s: NoteFileState, item: Item, actions: NoteBarActions, fragment?: Y.XmlFragment): Mounted {
  const card = s.list.appendChild(renderElement("article", { class: "qmd-note-file-item", "data-item-id": item.id }));
  const editorHost = card.appendChild(renderElement("div", { class: "qmd-note-file-editor" }));
  let handle: QmdEditorHandle | undefined;
  handle = mountQmdEditor(editorHost, {
    body: item.body, onChange: (next) => change(s, item.id, next), meta: metaOf(item), ...(fragment ? { collab: { fragment } } : {}),
    ...runOptions(s, item, editorHost, () => handle),
    noteActions: actions.actionsFor(item.id), gutter: { numbering: s.numbering },
    ...(s.options.viewState ? { viewState: { port: s.options.viewState, key: `${s.options.noteKey}\n${item.id}` } } : {}),
    ...hostOptions(s, item.id),
  });
  return { itemId: item.id, handle, card, ...(fragment ? { live: true } : {}) };
}

/** An empty file: one editor whose first text becomes the file's first item, or a line saying the note is empty. */
function mountEmpty(s: NoteFileState): void {
  const { create } = s.options;
  if (!create) { s.list.append(renderElement("p", { class: "ls-empty-text" }, `This ${QMD_VOCABULARY.item} is empty.`)); return; }
  const card = s.list.appendChild(renderElement("article", { class: "qmd-note-file-item is-new" }));
  const editorHost = card.appendChild(renderElement("div", { class: "qmd-note-file-editor" }));
  let itemId: string | undefined;
  const handle = mountQmdEditor(editorHost, {
    body: "", gutter: { numbering: s.numbering }, ...hostOptions(s, ""),
    onChange: (next) => {
      if (itemId !== undefined) { change(s, itemId, next); return; }
      if (next.trim() === "") return;
      itemId = newItemId();
      const item: Item = { id: itemId, body: next };
      s.latest.set(itemId, next);
      s.items = [item];
      s.mounted = [{ itemId, handle, card }];
      s.empty = undefined;
      card.setAttribute("data-item-id", itemId);
      create(itemId, next);
    },
  });
  s.empty = { itemId: "", handle, card };
}

function unmountAll(s: NoteFileState): void {
  if (s.live) { s.live.destroy(); s.live = undefined; s.mounted = s.mounted.filter((editor) => !editor.live); }
  for (const editor of s.mounted) editor.handle.destroy();
  s.empty?.handle.destroy();
  s.empty = undefined;
  s.group.clear();
  s.mounted = [];
  s.list.replaceChildren();
  s.numbering = createLineNumbering();
}

/** Shows the live doc's editors in doc order; an empty doc shows what an empty file shows, until its first item arrives. */
function showLive(s: NoteFileState, live: NoteFileLive, mounted: readonly Mounted[], items: readonly QmdDocItem[]): void {
  s.items = items.map((item) => toLiveItem(live.doc, item));
  const placeholders = [s.empty, ...s.mounted.filter((editor) => !editor.live)].flatMap((editor) => (editor ? [editor] : []));
  if (mounted.length === 0) {
    if (placeholders.length === 0) { s.mounted = []; if (!s.list.hasChildNodes()) mountEmpty(s); }
  } else {
    for (const editor of placeholders) editor.handle.destroy();
    s.empty = undefined;
    s.mounted = [...mounted];
    placeLiveCards(s.list, mounted.map((editor) => editor.card));
  }
  s.bar?.refresh();
}

function renderLive(s: NoteFileState, live: NoteFileLive): void {
  unmountAll(s);
  s.latest.clear();
  const actions = showBar(s, true)!;
  s.live = followLiveItems(live.doc, {
    mount: (item) => mountItem(s, toLiveItem(live.doc, item), actions, item.fragment),
    destroy: (editor) => { editor.handle.destroy(); editor.card.remove(); },
    show: (mounted, items) => showLive(s, live, mounted, items),
  });
}

function render(s: NoteFileState, text: string): void {
  if (s.options.live) { renderLive(s, s.options.live); return; }
  unmountAll(s);
  s.latest.clear();
  s.items = listNoteFileItems(text);
  const actions = showBar(s, true)!;
  if (s.items.length === 0) mountEmpty(s);
  else s.mounted = s.items.map((item) => mountItem(s, item, actions));
  // The editors have loaded their view state: the bar takes their Advanced flag and hands it to the ones that differ.
  s.bar?.refresh();
}

/** Shows a new version of the file: a change of the items' ids or order mounts them again, else the bodies that differ are replaced. */
function updateFile(s: NoteFileState, text: string): void {
  if (s.options.live) return;
  const next = listNoteFileItems(text);
  const sameItems = next.length === s.mounted.length && next.every((item, index) => item.id === s.mounted[index]!.itemId);
  if (!sameItems) { render(s, text); s.bar?.refresh(); return; }
  next.forEach((item, index) => {
    const shown = s.latest.get(item.id) ?? s.items[index]!.body;
    if (sameItemBody(shown, item.body)) return;
    s.latest.set(item.id, item.body);
    s.mounted[index]!.handle.setBody(item.body);
  });
  s.items = next;
}

/** Mounts the notes file `options.text`, or with `options.live` the items of its doc, into `host`. */
export function mountNoteFile(host: HTMLElement, options: NoteFileOptions): NoteFileHandle {
  const root = host.appendChild(renderElement("div", { class: "qmd-note-file", role: "group", "aria-label": QMD_VOCABULARY.item }));
  const group = createCellRunGroup({ onCancel: (requestId) => runner.runs.cancel(requestId), onInstallPython: () => options.cells?.installPython?.() });
  const runner = createRunner(options, group);
  const s: NoteFileState = {
    options, latest: new Map(), mounted: [], items: [], numbering: createLineNumbering(), group, runner,
    barHost: root.appendChild(renderElement("div", { class: "qmd-note-file-bar" })),
    list: root.appendChild(renderElement("div", { class: "qmd-note-file-items" })), bar: undefined, empty: undefined, live: undefined,
  };
  render(s, options.text);
  return {
    get editors() { return s.mounted; },
    update: (text) => updateFile(s, text),
    destroy() { unmountAll(s); showBar(s, false); root.remove(); },
  };
}
