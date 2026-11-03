// Mounts the rich editor of a LabShelf Markdown item body: ProseMirror state, keymap, input rules, the Visual/Source toggle and optional collab.
import { baseKeymap } from "prosemirror-commands";
import { history, redo, undo } from "prosemirror-history";
import { keymap } from "prosemirror-keymap";
import { EditorState, Plugin, type Command } from "prosemirror-state";
import { Decoration, DecorationSet, EditorView } from "prosemirror-view";
import { redoCommand, undoCommand, yCursorPlugin, ySyncPlugin, yUndoPlugin } from "y-prosemirror";
import type * as Y from "yjs";
import type { Awareness } from "y-protocols/awareness";
import { createDebouncer, type Debouncer } from "../../async/index.js";
import { renderElement } from "../../ui/dom/index.js";
import { bodyToDoc, docToBody, qmdSchema } from "../editor/index.js";
import type { CellLanguage } from "../compute/index.js";
import { cascadeStalePlugin, markUpstreamChange } from "./cascadeStale.js";
import { createCodeCellView, type RunCell } from "./codeCellView.js";
import { bindFoldViewState, collapseAll, expandAll, foldPlugin, foldStateOf, outlineOpenOf, setOutlineOpenOf, setReading, type FoldState } from "./foldPlugin.js";
import { OUTLINE_CHANGE_EVENT, outlineOf, revealBlockIn, type OutlineEntry } from "./noteOutline.js";
import type { QmdViewStatePort } from "../noteViewState.js";
import type { NoteFilesPort } from "../noteFiles.js";
import { noteSections, notebookCells, type NoteSection } from "./notebookCells.js";
import type { NotebookCell } from "../noteRuns.js";
import type { NoteActions } from "./noteBar.js";
import { createOutputView } from "./outputView.js";
import type { CellsAbove, OnEvalMath } from "./evalMathBridge.js";
import { createCitationView, createLinkView, createTaskItemView } from "./inlineViews.js";
import { blockDragPlugin, blockNavigationPlugin, placeCaretForInsert, placeCaretFromClick } from "./qmdBlocks.js";
import { createFigureView } from "./figureView.js";
import { loadFigureEditor } from "./figureEditor/index.js";
import { insertGapPlugin, isEmptyNote, renderInsertButton, showInsertMenu } from "./insertGap.js";
import { mathCheckPlugin } from "./mathCheckPlugin.js";
import { createMathView, loadCoreMath } from "./mathView.js";
import { createMathComputeHooks, createMathResultView, mathResultPlugin, type MathCompute } from "./mathResultView.js";
import { editRequestPlugin, qmdKeymap, shortcutLabel } from "./qmdCommands.js";
import { codeFenceEnter, qmdInputRules } from "./qmdInputRules.js";
import { liftItem, sinkItem, splitItem } from "./qmdListCommands.js";
import { revealProblemIn, trackEditorRoot } from "./problemNav.js";
import { mountSelectionBubble } from "./qmdControls.js";
import { mountLineGutter, type LineGutter, type LineNumbering } from "./lineGutter.js";

/** `noteActions` (from the note bar's actionsFor) adds Run section to headings, Run above / below to the cell menu and Mod-Shift-Enter (Run all). `onRunBelow` receives the item-local key of the cell whose Run below was pressed on a cell marked "May be out of date" (the cell label, else `cell-` and its ordinal); the host adds the item prefix. `status` is a host element (a save status, say) shown at the right of the row under the text. `gutter` shows the line gutter (numbers, and on an editable view the '+' of the hovered line); its `numbering` continues the numbers of the editors before this one. `files` reads and writes the note's assets/ files (a chart's CSV). */
export interface QmdEditorOptions { body: string; onChange(body: string): void; status?: HTMLElement; onRunCell?: RunCell; onRestartCell?(language: CellLanguage): void; onRunBelow?(cellKey: string): void; onEvalMath?: OnEvalMath; cellsAbove?: CellsAbove; onOpenLink?(href: string): void; readOnly?: boolean; meta?: { author?: string; date?: string }; collab?: { fragment: Y.XmlFragment; awareness: Awareness }; viewState?: { port: QmdViewStatePort; key: string }; noteActions?: NoteActions; gutter?: { numbering?: LineNumbering }; files?: NoteFilesPort }

/**
 * `notebook(itemId)` lists the code cells as notebook cells of item `itemId` (default ''); `sections()` lists the headings' sections; both empty once destroyed.
 * `collapseAll`, `expandAll` and `setReading` change what the view shows (plan D8, D14), never the body; `foldState()` reads it.
 * `revealProblem` selects the next (dir 1) or previous problem output searching from the selection ('caret') or the item's start / end ('edge'), expanding what hides it; false when there is none (plan D12).
 * `outline()` lists the headings, cells and figures in document order (empty once destroyed); `reveal(pos)` expands what hides the block at `pos`, selects it,
 * scrolls it into view and focuses the editor; `outlineOpen()` / `setOutlineOpen(open)` are the item's outline flag, saved through `viewState` like the folds (plan D15).
 */
export interface QmdEditorHandle { setBody(body: string): void; flush(): void; focus(): void; destroy(): void; notebook(itemId?: string): readonly NotebookCell[]; sections(): readonly NoteSection[]; markUpstreamChange(language: string, at: number): void; collapseAll(): void; expandAll(): void; setReading(reading: boolean): void; foldState(): FoldState; revealProblem(dir: -1 | 1, from: "caret" | "edge"): boolean; outline(): readonly OutlineEntry[]; reveal(pos: number): void; outlineOpen(): boolean; setOutlineOpen(open: boolean): void }

const CHANGE_DELAY_MS = 300;
const TOGGLE_KEY = "Mod-Alt-s";
/** Marks transactions that replace the content from outside, which must not report a change. */
const EXTERNAL = "qmdExternal";

/** UI words for a LabShelf Markdown item (D16); renaming "note" is a change here only. */
export const QMD_VOCABULARY: { readonly item: string } = { item: "note" };

/** Shows the empty-item placeholder through a node decoration with a class. */
function placeholderPlugin(text: string): Plugin {
  return new Plugin({
    props: {
      decorations(state) {
        const { doc } = state;
        if (!isEmptyNote(doc)) return null;
        return DecorationSet.create(doc, [Decoration.node(0, doc.firstChild!.nodeSize, { class: "qmd-editor-placeholder", "data-placeholder": text })]);
      },
    },
  });
}

/** Opens links through `onOpenLink` instead of navigating the host page. */
function linkPlugin(onOpenLink: (href: string) => void): Plugin {
  return new Plugin({
    props: {
      handleDOMEvents: {
        click(_view, event) {
          const anchor = (event.target as Element | null)?.closest?.("a[href]");
          if (!anchor) return false;
          event.preventDefault();
          onOpenLink(anchor.getAttribute("href") ?? "");
          return true;
        },
      },
    },
  });
}

/** Remote cursors drawn with classes only: the webview CSP forbids inline styles. */
function collabCursor(user: { name?: string }): HTMLElement {
  return renderElement("span", { class: "qmd-editor-cursor" }, "⁠", renderElement("span", { class: "qmd-editor-cursor-name", text: user.name ?? "" }), "⁠");
}

interface Chrome { header: HTMLElement; toggle: HTMLButtonElement; footer: HTMLElement; source: HTMLTextAreaElement }

/** The mutable state one mounted editor shares between its functions. */
interface Session { options: QmdEditorOptions; readOnly: boolean; chrome: Chrome; view: EditorView; changed: Debouncer<[]>; mode: "visual" | "source"; destroyed: boolean; gutter?: LineGutter; createState(body: string): EditorState }

function createChrome(options: QmdEditorOptions, readOnly: boolean): Chrome {
  const header = renderElement("div", { class: "qmd-editor-header" });
  const metaText = [options.meta?.author, options.meta?.date].filter((part) => part).join(" · ");
  if (metaText) header.append(renderElement("span", { class: "qmd-editor-meta", text: metaText }));
  const toggle = renderElement("button", { class: "ls-btn ls-btn-ghost qmd-editor-toggle", type: "button" });
  header.append(toggle);
  // The row under the text: the Insert button on the left, the host's status on the right.
  const footer = renderElement("div", { class: "qmd-editor-footer" });
  if (options.status) footer.append(options.status);
  footer.hidden = readOnly && !options.status;
  const source = renderElement("textarea", { class: "qmd-editor-source", spellcheck: "false" });
  source.readOnly = readOnly;
  return { header, toggle, footer, source };
}

const chainEnter: Command = (state, dispatch, view) => codeFenceEnter(state, dispatch, view) || splitItem(state, dispatch, view);

function createPlugins(options: QmdEditorOptions, toggleCommand: Command): Plugin[] {
  const { collab } = options;
  const plugins: Plugin[] = [qmdInputRules(), placeholderPlugin(`Empty ${QMD_VOCABULARY.item} — type to start`), editRequestPlugin(), blockNavigationPlugin(), blockDragPlugin()];
  if (!options.readOnly) plugins.push(insertGapPlugin());
  if (options.onOpenLink) plugins.push(linkPlugin(options.onOpenLink));
  plugins.push(cascadeStalePlugin(options.onRunBelow ? { onRunBelow: options.onRunBelow } : {}));
  const { noteActions } = options;
  plugins.push(foldPlugin(noteActions ? { runSection: (section) => noteActions.runScope({ kind: "section", section }), canRun: () => noteActions.canRun() } : {}));
  if (collab) {
    plugins.push(
      ySyncPlugin(collab.fragment),
      yCursorPlugin(collab.awareness, { cursorBuilder: collabCursor, selectionBuilder: () => ({ class: "qmd-editor-selection" }) }),
      // y-prosemirror's typings resolve their own prosemirror-state copy, so its plugin and commands are cast at this seam.
      yUndoPlugin() as unknown as Plugin,
      keymap({ "Mod-z": undoCommand as unknown as Command, "Mod-Shift-z": redoCommand as unknown as Command, "Mod-y": redoCommand as unknown as Command }),
    );
  } else {
    plugins.push(history(), keymap({ "Mod-z": undo, "Mod-Shift-z": redo, "Mod-y": redo }));
  }
  if (options.onEvalMath && options.cellsAbove && !options.readOnly) plugins.push(mathResultPlugin());
  if (options.onEvalMath && !options.readOnly) plugins.push(mathCheckPlugin({ onEvalMath: options.onEvalMath, ...(options.cellsAbove ? { cellsAbove: options.cellsAbove } : {}), isExternal: (tr) => tr.getMeta(EXTERNAL) === true }));
  if (noteActions) plugins.push(keymap({ "Mod-Shift-Enter": () => { if (!noteActions.canRun()) return false; noteActions.runScope({ kind: "all" }); return true; } }));
  plugins.push(keymap(qmdKeymap(noteActions ? { noteActions } : {})), keymap({ Enter: chainEnter, Tab: sinkItem, "Shift-Tab": liftItem, [TOGGLE_KEY]: toggleCommand }), keymap(baseKeymap));
  return plugins;
}

function createView(session: Session): EditorView {
  const { options, readOnly } = session;
  // Without a runner, or read-only, no math asks for a result and a stored result only shows.
  const compute: MathCompute | undefined = options.onEvalMath && !readOnly ? { onEvalMath: options.onEvalMath, ...(options.cellsAbove ? { cellsAbove: options.cellsAbove } : {}) } : undefined;
  const view: EditorView = new EditorView(null, {
    state: session.createState(options.body),
    editable: () => !readOnly,
    nodeViews: {
      math_inline: createMathView(false, undefined, compute && createMathComputeHooks(compute)),
      math_display: createMathView(true),
      math_result: createMathResultView(compute),
      code_cell: createCodeCellView(options.onRunCell, options.onRestartCell, undefined, options.noteActions),
      output: createOutputView(),
      task_item: createTaskItemView(),
      citation: createCitationView(),
      figure: createFigureView({ loadMath: loadCoreMath, loadEditor: loadFigureEditor, ...(options.files ? { files: options.files } : {}) }),
    },
    markViews: { link: createLinkView() },
    // PLATFORM: without layout (jsdom, a detached host) ranges have no client rects and ProseMirror's scroll throws.
    handleScrollToSelection: () => typeof document.createRange().getClientRects !== "function",
    dispatchTransaction(tr) {
      if (session.destroyed) return;
      view.updateState(view.state.apply(tr));
      session.gutter?.update(tr.docChanged);
      if (tr.docChanged && !tr.getMeta(EXTERNAL)) session.changed.call();
    },
  });
  return view;
}

function currentBody(session: Session): string {
  return session.mode === "source" ? session.chrome.source.value : docToBody(session.view.state.doc);
}

/** Shows `body` without reporting a change, replacing only the blocks that differ so the caret stays where it was. */
function showBody(session: Session, body: string): void {
  const { view } = session;
  const doc = bodyToDoc(body);
  const current = view.state.doc.content;
  const tr = view.state.tr.setMeta(EXTERNAL, true).setMeta("addToHistory", false);
  const start = current.findDiffStart(doc.content);
  if (start !== null) {
    const ends = current.findDiffEnd(doc.content)!;
    // Both ends step back over a run the two bodies share, so they never cross the start.
    const overlap = Math.max(0, start - Math.min(ends.a, ends.b));
    tr.replace(start, ends.a + overlap, doc.slice(start, ends.b + overlap));
  }
  for (const [name, value] of Object.entries(doc.attrs)) tr.setDocAttribute(name, value);
  view.dispatch(tr);
}

function renderToggle(session: Session): void {
  const label = session.mode === "visual" ? "Source" : "Visual";
  const { toggle, header } = session.chrome;
  toggle.hidden = session.mode === "visual" && !session.readOnly;
  header.hidden = toggle.hidden && !header.querySelector(".qmd-editor-meta");
  header.parentElement?.setAttribute("data-qmd-mode", session.mode);
  toggle.textContent = label;
  toggle.title = `${label} (${shortcutLabel(TOGGLE_KEY)})`;
  toggle.setAttribute("aria-pressed", String(session.mode === "source"));
}

function toggleMode(session: Session): void {
  const { view, chrome, readOnly } = session;
  const { source } = chrome;
  const insert = chrome.footer.querySelector<HTMLElement>(".qmd-editor-insert");
  if (session.mode === "visual") {
    source.value = docToBody(view.state.doc);
    session.mode = "source";
    if (insert) insert.hidden = true;
    view.dom.replaceWith(source);
    source.focus();
  } else {
    const body = source.value;
    session.mode = "visual";
    if (insert) insert.hidden = readOnly;
    source.replaceWith(view.dom);
    if (body !== docToBody(view.state.doc)) showBody(session, body);
    view.focus();
  }
  renderToggle(session);
}

function bindChrome(session: Session): void {
  const { toggle, source } = session.chrome;
  toggle.addEventListener("click", () => toggleMode(session));
  source.addEventListener("input", () => session.changed.call());
  source.addEventListener("keydown", (event) => {
    const mod = event.metaKey || event.ctrlKey;
    if (mod && event.altKey && !event.shiftKey && event.code === "KeyS") {
      event.preventDefault();
      toggleMode(session);
    }
  });
}

function createSession(options: QmdEditorOptions): Session {
  const readOnly = options.readOnly ?? false;
  const chrome = createChrome(options, readOnly);
  const toggleCommand: Command = () => {
    toggleMode(session);
    return true;
  };
  const plugins = createPlugins(options, toggleCommand);
  const { onRunCell } = options;
  // A normal run (no preview callback) reports the pending change first, so the host has the edited body before the run starts.
  const flushedRunCell: RunCell | undefined = onRunCell && ((label, code, language, params, preview) => {
    if (!preview) session.changed.flush();
    onRunCell(label, code, language, params, preview);
  });
  // The host reads the item's body to list the cells above a position, so the pending change goes first.
  const { cellsAbove } = options;
  const flushedCellsAbove: CellsAbove | undefined = cellsAbove && ((pos) => { session.changed.flush(); return cellsAbove(pos); });
  const session = {
    options: { ...options, ...(flushedRunCell ? { onRunCell: flushedRunCell } : {}), ...(flushedCellsAbove ? { cellsAbove: flushedCellsAbove } : {}) },
    readOnly,
    chrome,
    mode: "visual",
    destroyed: false,
    changed: createDebouncer(() => {
      if (!session.destroyed) options.onChange(currentBody(session));
    }, CHANGE_DELAY_MS),
    createState: (body: string) => EditorState.create({ schema: qmdSchema, doc: bodyToDoc(body), plugins }),
  } as Session;
  session.view = createView(session);
  return session;
}

/** A click or double click on the empty space around the blocks places the caret or opens the Insert menu there; @returns what removes both listeners. */
function bindEmptySpace(session: Session, root: HTMLElement): () => void {
  const { view } = session;
  const onEmptyClick = (event: MouseEvent): void => {
    const onSpace = event.target === root || event.target === view.dom;
    if (onSpace && event.button === 0 && session.mode === "visual" && !session.readOnly && placeCaretFromClick(view, event)) event.preventDefault();
  };
  // A double click on empty space opens the Insert panel there, inserting at that spot.
  const onEmptyDoubleClick = (event: MouseEvent): void => {
    if (event.button !== 0 || session.mode !== "visual" || session.readOnly || !placeCaretForInsert(view, event)) return;
    event.preventDefault();
    showInsertMenu(view, { x: event.clientX, y: event.clientY }, () => toggleMode(session));
  };
  root.addEventListener("mousedown", onEmptyClick);
  root.addEventListener("dblclick", onEmptyDoubleClick);
  return () => {
    root.removeEventListener("mousedown", onEmptyClick);
    root.removeEventListener("dblclick", onEmptyDoubleClick);
  };
}

/** Binds the saved view state (once the view sits in the root, so Reading mode reaches the root's class) and tells a note outline over this editor to re-read it when its blocks or an output's problem class change; @returns what unbinds both. */
function bindViewStateAndOutline(root: HTMLElement, view: EditorView, viewState: QmdEditorOptions["viewState"]): () => void {
  const unbindViewState = viewState ? bindFoldViewState(view, viewState) : null;
  const outlineWatch = new MutationObserver(() => root.dispatchEvent(new CustomEvent(OUTLINE_CHANGE_EVENT, { bubbles: true, composed: true })));
  outlineWatch.observe(view.dom, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ["class"] });
  return () => {
    unbindViewState?.();
    outlineWatch.disconnect();
  };
}

/** The handle's fold, Reading mode and outline members, which act on the visual view only while the session is alive. */
function foldMembers(session: Session, root: HTMLElement): Pick<QmdEditorHandle, "collapseAll" | "expandAll" | "setReading" | "foldState" | "revealProblem" | "outline" | "reveal" | "outlineOpen" | "setOutlineOpen"> {
  const { view } = session;
  return {
    collapseAll() { if (!session.destroyed) collapseAll(view); },
    expandAll() { if (!session.destroyed) expandAll(view); },
    setReading(reading) {
      if (session.destroyed) return;
      setReading(view, reading);
      // The editor's own view is out of the page while the Source textarea shows, so the root is set here as well.
      root.classList.toggle("is-reading", reading);
    },
    foldState: () => foldStateOf(view.state),
    revealProblem: (dir, from) => !session.destroyed && session.mode === "visual" && revealProblemIn(view, dir, from),
    outline: () => (session.destroyed ? [] : outlineOf(view)),
    reveal(pos) { if (!session.destroyed && session.mode === "visual") revealBlockIn(view, pos); },
    outlineOpen: () => outlineOpenOf(view),
    setOutlineOpen(open) { if (!session.destroyed) setOutlineOpenOf(view, open); },
  };
}

export function mountQmdEditor(root: HTMLElement, options: QmdEditorOptions): QmdEditorHandle {
  const session = createSession(options);
  const { chrome, view, changed } = session;
  bindChrome(session);
  root.classList.add("qmd-editor");
  root.replaceChildren(chrome.header, view.dom, chrome.footer);
  const unbindEmptySpace = bindEmptySpace(session, root);
  if (options.gutter) session.gutter = mountLineGutter(root, view, { editable: !session.readOnly, ...(options.gutter.numbering ? { numbering: options.gutter.numbering } : {}) });
  // With a gutter every line has its own '+', so the round one under the text is left out.
  if (!session.readOnly && !options.gutter) chrome.footer.prepend(renderInsertButton(view, () => toggleMode(session)));
  const bubble = session.readOnly ? null : mountSelectionBubble(root, view);
  renderToggle(session);
  const unbindViewState = bindViewStateAndOutline(root, view, options.viewState);

  const handle: QmdEditorHandle = {
    ...foldMembers(session, root),
    setBody(body) {
      if (session.destroyed) return;
      changed.cancel();
      if (session.mode === "source") chrome.source.value = body;
      else showBody(session, body);
    },
    flush() { changed.flush(); },
    notebook: (itemId = "") => (session.destroyed ? [] : notebookCells(view, itemId)),
    sections: () => (session.destroyed ? [] : noteSections(view)),
    markUpstreamChange(language, at) { if (!session.destroyed) markUpstreamChange(view, language, at); },
    focus() {
      if (session.mode === "source") chrome.source.focus();
      else view.focus();
    },
    destroy() {
      if (session.destroyed) return;
      session.destroyed = true;
      changed.cancel();
      unbindViewState();
      unbindEmptySpace();
      session.gutter?.destroy();
      bubble?.destroy();
      view.destroy();
      root.replaceChildren();
      root.classList.remove("qmd-editor");
    },
  };
  trackEditorRoot(handle, root);
  return handle;
}
