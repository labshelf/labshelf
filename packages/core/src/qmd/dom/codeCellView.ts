// Shows code cells like figures: a new cell's code with a quiet Run line under it, and a cell with a result folded behind its outputs until Show code unfolds it.
import type { Node as ProseNode } from "prosemirror-model";
import type { Decoration, EditorView, NodeView, NodeViewConstructor } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { NodeSelection, TextSelection } from "prosemirror-state";
import { completionStatus } from "@codemirror/autocomplete";
import type { EditorView as CodeEditorView, KeyBinding } from "@codemirror/view";
import type { CellLanguage, CellResult, CellRunInfo } from "../compute/index.js";
import { paramValues, type CellParamValue } from "../item/index.js";
import type { CellParamValues } from "./cellParamStrip.js";
import { createCellParams, type CellParams } from "./codeCellParams.js";
import { createCodeCellEditor, setCodeCellEditable, setCodeCellLanguage, syncCodeCellEditor } from "./codeCellEditor.js";
import { exitNode, fenceCellLanguage, registerCellControls, registerNodeEditor, renderLanguagePicker, renderRestartButton, setViewNodeAttribute, type CellControls, type EditSide } from "./inlineViews.js";
import { shortcutLabel } from "./qmdCommands.js";
import { CELL_RAN_EVENT } from "./cellRunStatus.js";
import { cellLanguageName, type CellSummaryState } from "./cellSummary.js";
import { collapsedSummary, setFold } from "./foldPlugin.js";
import { createCellRuns, type CellRuns } from "./notebookCells.js";
import { moveBlock } from "./blockMove.js";
import { cellMenuEntries } from "./cellMenu.js";
import { jumpProblemWithin } from "./problemNav.js";
import type { NoteActions } from "./noteBar.js";
import { showMenu } from "../../ui/dom/widgets/menu.js";
import type { CellRunEnd } from "../noteRuns.js";
import { formatRunTime, noteCellRun, outputContent, readCellLabel } from "./outputView.js";
import { loadCorePlotly, type PlotlyLoader } from "./plotView.js";

const isHistoryKey = (event: KeyboardEvent): boolean => (event.metaKey || event.ctrlKey) && !event.altKey && /^[zy]$/i.test(event.key);

/** The editor shows `code` without the final newline that ends its last line. */
const editorText = (code: string): string => (code.endsWith("\n") ? code.slice(0, -1) : code);

/**
 * Runs a cell: its label, its code, its language and its param values. A preview passes `preview`, which the host calls exactly
 * once: with the result when its cellPreview arrives, or with undefined when the request ends without one; a normal run passes none.
 * Returning false (and only false) says the host refused a normal run, one being in flight.
 */
export type RunCell = (label: string, code: string, language: CellLanguage, params?: Record<string, CellParamValue>, preview?: (result: CellResult | undefined) => void) => unknown;
/** Restarts the session of one language. */
export type RestartCell = (language: CellLanguage) => void;

/**
 * Shows a code cell like a figure. A cell without a result shows its code in a CodeMirror editor with one quiet line
 * under it (the language picker, Run and Restart), which also drags the cell. A cell with a result keeps its code out of the note: its
 * outputs carry the line, and Show code unfolds the code in place above them.
 * Edits become transactions on the cell's `code`; arrow keys past the first or last line, and Escape, hand the caret
 * back to the note, and undo and redo go through the note's history.
 */
class CodeCellView implements NodeView {
  readonly dom: HTMLElement;
  private readonly pre: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly controls: CellControls;
  private actionsKey: string | null = null;
  private readonly editor: CodeEditorView;
  private readonly listeners = new Set<() => void>();
  private readonly classObserver: MutationObserver;
  /** The one line a collapsed cell shows in place of its code and outputs (D8); a click or Enter expands the cell. */
  private summary: HTMLElement | null = null;
  /** Watches the outputs' out-of-date classes while the cell is collapsed, so the summary says so too. */
  private readonly outputObserver: MutationObserver;
  private collapsed: { text: string; state: CellSummaryState } | null;
  private summaryKey = "";
  private hasOutput = false;
  private open = false;
  private running = false;
  private readonly cellParams: CellParams;
  private readonly runs: CellRuns;
  /** How long the last run in this view took, shown after Run; never stored, so a reopened note shows none. */
  private runTime = "";

  constructor(private node: ProseNode, private readonly view: EditorView, private readonly getPos: () => number | undefined,
    decorations: readonly Decoration[], private readonly onRunCell?: RunCell, private readonly onRestartCell?: RestartCell, private readonly loadPlotly: PlotlyLoader = loadCorePlotly,
    private readonly noteActions?: NoteActions) {
    // The line is the cell's handle: dragging it moves the cell with its outputs (blockDragPlugin).
    this.actions = renderElement("div", { class: "qmd-cell-actions", contenteditable: "false", draggable: "true" });
    this.editor = createCodeCellEditor({
      text: editorText(node.attrs.code as string),
      language: this.language(),
      editable: view.editable,
      keys: this.keys(),
      onChange: (text) => this.commit(text),
      noteCode: () => this.noteCode(),
    });
    this.pre = renderElement("div", { class: "qmd-cell-code" }, this.editor.dom);
    this.panel = renderElement("div", { class: "qmd-cell-panel" }, this.pre, this.actions);
    this.cellParams = this.makeCellParams();
    this.dom = renderElement("div", { class: "qmd-cell" }, this.panel, this.cellParams.strip.el, this.cellParams.previewOutput);
    this.outputObserver = new MutationObserver(() => this.renderSummary());
    this.collapsed = collapsedSummary(decorations);
    this.runs = createCellRuns(this.dom, () => this.view.dom, () => this.renderActions());
    registerNodeEditor(this.dom, (side) => this.focusCode(side));
    this.controls = {
      language: () => cellLanguageName(this.node.attrs.lang as string | null),
      cellLanguage: () => this.language(),
      setLanguage: (language) => this.setLanguage(language),
      canRun: () => this.canRun(),
      run: () => void this.run(),
      runToEnd: () => this.run(),
      cancel: () => this.runs.cancel(),
      setQueue: (state) => this.runs.setQueue(state),
      canRestart: () => this.onRestartCell !== undefined && this.language() !== undefined,
      restart: () => this.restart(),
      hasResult: () => this.hasOutput,
      folded: () => this.hasOutput && !this.open,
      isOpen: () => this.open,
      setOpen: (open) => (open ? this.openCode() : this.closeCode()),
      isRunning: () => this.running,
      previewResult: () => this.cellParams.previewResult() ?? undefined,
      subscribe: (listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); },
      refresh: (now) => { if (now) this.syncOutputs(true); else queueMicrotask(() => this.syncOutputs()); },
    };
    registerCellControls(this.dom, this.controls, view, getPos());
    this.classObserver = this.observeRunning();
    this.dom.addEventListener(CELL_RAN_EVENT, (event) => this.ran((event as CustomEvent<CellRunInfo>).detail));
    this.render();
    this.watchOutputs();
    // A cell with a result starts folded, so the note reads as text with its results in it.
    this.syncOutputs();
  }

  /** A run of this cell ended with a result: its time goes on the cell line and its warnings reach the outputs, in this view only. */
  private ran(info: CellRunInfo): void {
    noteCellRun(this.dom, info);
    this.runTime = formatRunTime(info.durationMs);
    this.renderActions();
    this.notify();
  }

  /** The run status marks the cell `is-running`; outputs show it in their line. */
  private observeRunning(): MutationObserver {
    const observer = new MutationObserver(() => {
      const running = this.dom.classList.contains("is-running");
      if (running === this.running) return;
      this.running = running;
      this.cellParams.runChanged(running);
      this.notify();
    });
    observer.observe(this.dom, { attributes: true, attributeFilter: ["class"] });
    return observer;
  }

  private makeCellParams(): CellParams {
    return createCellParams({
      view: this.view,
      getPos: this.getPos,
      runPreview: this.onRunCell,
      node: () => this.node,
      language: () => this.language(),
      label: () => this.label(),
      canRun: () => this.canRun(),
      run: (values) => this.run(values),
      changed: () => this.notify(),
      loadPlotly: this.loadPlotly,
    });
  }

  /** Expands the collapsed cell (view state only). */
  private expand(): void {
    setFold(this.view, { cell: [this.label(), false] });
  }

  /** The DOM of the output blocks after the cell. */
  private outputDoms(): HTMLElement[] {
    const pos = this.getPos();
    if (pos === undefined || this.view.isDestroyed) return [];
    const doms: HTMLElement[] = [];
    const doc = this.view.state.doc;
    for (let at = pos + this.node.nodeSize, next = doc.resolve(at).nodeAfter; next?.type.name === "output"; at += next.nodeSize, next = doc.resolve(at).nodeAfter) {
      const dom = this.view.nodeDOM(at);
      if (dom instanceof HTMLElement) doms.push(dom);
    }
    return doms;
  }

  /** Watches the outputs once they are drawn (after this view in the same update) while the cell is collapsed, and redraws the summary. */
  private watchOutputs(): void {
    this.outputObserver.disconnect();
    this.renderSummary();
    if (!this.collapsed) return;
    queueMicrotask(() => {
      if (!this.collapsed || this.view.isDestroyed) return;
      this.outputObserver.disconnect();
      for (const dom of this.outputDoms()) this.outputObserver.observe(dom, { attributes: true, attributeFilter: ["class"] });
      this.renderSummary();
    });
  }

  /** The summary line: a glyph and text for an error or an out-of-date result (never colour alone), then '<Language> · <kind> · ran <when>'. */
  private renderSummary(): void {
    if (!this.collapsed) {
      this.summary?.remove();
      this.summary = null;
      this.summaryKey = "";
      return;
    }
    const summary = this.summary ?? this.createSummary();
    const outputs = this.outputDoms();
    const stale = outputs.some((dom) => dom.classList.contains("is-out-of-date")) ? "Out of date"
      : outputs.some((dom) => dom.classList.contains("is-maybe-stale")) ? "May be out of date" : null;
    const { text } = this.collapsed;
    const state: CellSummaryState = this.collapsed.state === "error" || stale === null ? this.collapsed.state : stale === "Out of date" ? "out-of-date" : "maybe-out-of-date";
    const key = `${text}\u0000${state}\u0000${stale ?? ""}`;
    if (key === this.summaryKey) return;
    this.summaryKey = key;
    summary.dataset.state = state;
    const children: Node[] = [renderElement("span", { class: "qmd-cell-summary-chevron", html: renderIcon("chevron-right"), "aria-hidden": "true" })];
    if (this.collapsed.state === "error") children.push(renderElement("span", { class: "qmd-cell-summary-glyph is-error", html: renderIcon("x"), "aria-hidden": "true" }));
    children.push(renderElement("span", { class: "qmd-cell-summary-text" }, text));
    if (stale) {
      children.push(renderElement("span", { class: "qmd-cell-summary-stale" },
        renderElement("span", { class: "qmd-cell-summary-glyph is-stale", html: renderIcon("warning"), "aria-hidden": "true" }), ` ${stale}`));
    }
    summary.replaceChildren(...children);
  }

  /** The summary element exists only while the cell is collapsed; it sits first in the cell. */
  private createSummary(): HTMLElement {
    const summary = renderElement("div", { class: "qmd-cell-summary", role: "button", tabindex: "0", contenteditable: "false", title: "Expand cell" });
    summary.addEventListener("click", () => this.expand());
    summary.addEventListener("keydown", (event) => {
      if (event.key !== "Enter" && event.key !== " ") return;
      event.preventDefault();
      this.expand();
    });
    this.dom.prepend(summary);
    this.summary = summary;
    this.summaryKey = "";
    return summary;
  }

  private label(): string {
    return readCellLabel(this.node.attrs.options as string) || this.positionLabel();
  }

  private notify(): void {
    this.cellParams.renderPreview(this.hasOutput);
    for (const listener of this.listeners) listener();
  }

  /** Folds the cell while it has a result; a result arriving while its code has the caret leaves the code unfolded. */
  /** `drawing`: called while the editor draws its first document, before it has a doc view (`isDestroyed`). */
  private syncOutputs(drawing = false): void {
    if (!drawing && this.view.isDestroyed) return;
    const pos = this.getPos();
    const label = readCellLabel(this.node.attrs.options as string);
    let hasOutput = false;
    let at = pos === undefined ? -1 : pos + this.node.nodeSize;
    for (let next = at < 0 ? null : this.view.state.doc.resolve(at).nodeAfter; next?.type.name === "output"; next = this.view.state.doc.resolve(at).nodeAfter) {
      if (outputContent(next.attrs.raw as string).trim()) hasOutput = true;
      at += next.nodeSize;
    }
    if (!hasOutput && label) this.view.state.doc.descendants((child) => { if (child.type.name === "output" && child.attrs.cell === label && outputContent(child.attrs.raw as string).trim()) { hasOutput = true; } });
    if (hasOutput === this.hasOutput) return;
    const focused = this.editor.hasFocus;
    this.hasOutput = hasOutput;
    this.open = hasOutput && focused;
    this.showPanel();
    this.notify();
  }

  /** Shows the code unless the cell has a result and is folded; an unfolded cell with a result leaves its line to the outputs. */
  private showPanel(): void {
    this.panel.hidden = this.hasOutput && !this.open;
    this.dom.classList.toggle("qmd-cell-folded", this.panel.hidden);
    this.dom.classList.toggle("qmd-cell-has-output", this.hasOutput);
  }

  /** Unfolds the code of a cell with a result in place, above its outputs, and puts the caret in it. */
  private openCode(): void {
    if (!this.hasOutput) { this.focusCode("start"); return; }
    const wasOpen = this.open;
    this.open = true;
    this.showPanel();
    this.editor.requestMeasure();
    if (this.view.editable) {
      this.editor.focus();
      if (!wasOpen) this.editor.dispatch({ selection: { anchor: 0 } });
    }
    this.notify();
  }

  /** Folds the code of a cell with a result again. */
  private closeCode(): void {
    if (!this.open) return;
    this.open = false;
    this.showPanel();
    this.notify();
  }

  /** The cell's language when it is one the editor runs. */
  private language(): CellLanguage | undefined {
    return fenceCellLanguage(this.node.attrs.lang as string | null);
  }

  /** Whether Run, Mod-Enter and Shift-Enter run this cell: the host runs cells and the cell's language is a cell language. */
  private canRun(): boolean {
    return this.onRunCell !== undefined && this.language() !== undefined;
  }

  /** The quiet line under the code: the language picker (or the fence language as text), Run with the last run's time, Restart and, in an editable note, the ⋯ cell menu; redrawn only when one of them changes. */
  private renderActions(): void {
    const key = `${this.node.attrs.lang as string | null}\u0000${this.view.editable}\u0000${this.runTime}\u0000${this.runs.queue()}`;
    if (key === this.actionsKey) return;
    this.actionsKey = key;
    const sep = (): HTMLElement => renderElement("span", { class: "qmd-action-sep", "aria-hidden": "true" }, "·");
    const children: Node[] = [renderLanguagePicker(this.controls, "qmd-cell-lang", this.view.editable)];
    if (this.canRun()) {
      const run = renderElement("button", { class: "qmd-cell-run", type: "button", title: `Run (${shortcutLabel("Mod-Enter")}) · run and continue below (${shortcutLabel("Shift-Enter")})`, "aria-label": "Run cell" },
        "Run",
        renderElement("span", { class: "qmd-cell-run-icon", html: renderIcon("play"), "aria-hidden": "true" }),
        renderElement("span", { class: "qmd-cell-run-spinner", html: renderIcon("loader"), "aria-hidden": "true" }));
      run.addEventListener("click", () => void this.run());
      children.push(sep(), run);
      if (this.runTime) children.push(renderElement("span", { class: "qmd-cell-time", title: "How long the last run took" }, this.runTime));
    }
    const queue = this.runs.renderQueue();
    if (queue) children.push(sep(), queue);
    const restart = renderRestartButton(this.controls, "qmd-cell-run qmd-cell-restart");
    if (restart) children.push(sep(), restart);
    // The cell menu shows only while the note is editable, which the key above already holds.
    if (this.view.editable) children.push(this.renderMenuButton());
    this.actions.replaceChildren(...children);
  }

  /** The ⋯ button at the end of the cell line, opening the cell menu (plan D10). */
  private renderMenuButton(): HTMLButtonElement {
    const button = renderElement("button", { class: "qmd-cell-menu", type: "button", "aria-haspopup": "menu", "aria-label": "Cell actions", title: "Cell actions" }, "⋯");
    button.addEventListener("click", () => showMenu(button, cellMenuEntries(this.view, this.getPos, this.noteActions)));
    return button;
  }

  private render(): void {
    const label = readCellLabel(this.node.attrs.options as string);
    this.renderActions();
    setCodeCellLanguage(this.editor, this.language());
    this.dom.dataset.cellLabel = label;
    this.cellParams.render();
    const code = this.node.attrs.code as string;
    syncCodeCellEditor(this.editor, editorText(code));
  }

  /** Hands the caret back to the note in `dir`. */
  private leave(dir: 1 | -1): boolean {
    return exitNode(this.view, this.getPos, dir);
  }

  /** The keys the cell handles before the code editor: run (staying with Mod-Enter, moving on with Shift-Enter), history, Escape, Backspace in an empty cell, and arrows past the edges. */
  private keys(): KeyBinding[] {
    const idle = (editor: CodeEditorView): boolean => completionStatus(editor.state) !== "active";
    const caret = (editor: CodeEditorView): number | null => (editor.state.selection.main.empty ? editor.state.selection.main.head : null);
    const leave = (dir: 1 | -1, atEdge: (editor: CodeEditorView, head: number) => boolean) => (editor: CodeEditorView): boolean => {
      const head = caret(editor);
      return head !== null && idle(editor) && atEdge(editor, head) && this.leave(dir);
    };
    const run = (): boolean => { if (!this.canRun()) return false; void this.run(); return true; };
    // Run all from inside a cell too: the note's keymap never sees keys the code editor handles.
    const runAll = (): boolean => { if (!this.noteActions?.canRun()) return false; this.noteActions.runScope({ kind: "all" }); return true; };
    // Move the cell and jump to a problem from inside a cell too: the note's keymap never sees keys the code editor handles.
    const move = (dir: -1 | 1) => (): boolean => {
      const pos = this.getPos();
      if (pos === undefined) return false;
      const selected = this.view.state.apply(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
      if (!moveBlock(dir)(selected)) return false;
      this.view.dispatch(this.view.state.tr.setSelection(NodeSelection.create(this.view.state.doc, pos)));
      return moveBlock(dir)(this.view.state, this.view.dispatch.bind(this.view), this.view);
    };
    const jump = (dir: -1 | 1) => (): boolean => {
      if (this.noteActions?.jumpProblem) { this.noteActions.jumpProblem(dir); return true; }
      return jumpProblemWithin(this.view, dir);
    };
    return [
      // Undo and redo go through the note's history, which also holds the code edits.
      { any: (_editor, event) => isHistoryKey(event) && (this.view.someProp("handleKeyDown", (handle) => handle(this.view, event)) ?? false) },
      { key: "Mod-Shift-Enter", run: runAll },
      { key: "Alt-ArrowUp", run: move(-1) },
      { key: "Alt-ArrowDown", run: move(1) },
      { key: "F8", run: jump(1) },
      { key: "Shift-F8", run: jump(-1) },
      { key: "Mod-Enter", run },
      // Shift-Enter runs the cell and carries on writing below its result, so a note reads as text with results in it.
      { key: "Shift-Enter", run: () => { if (this.canRun()) void this.run(); this.closeCode(); return this.leave(1); } },
      { key: "Escape", run: (editor) => idle(editor) && this.leave(1) },
      { key: "Backspace", run: (editor) => editor.state.doc.length === 0 && this.removeCell() },
      { key: "ArrowUp", run: leave(-1, (editor, head) => editor.state.doc.lineAt(head).number === 1) },
      { key: "ArrowLeft", run: leave(-1, (_editor, head) => head === 0) },
      { key: "ArrowDown", run: leave(1, (editor, head) => editor.state.doc.lineAt(head).number === editor.state.doc.lines) },
      { key: "ArrowRight", run: leave(1, (editor, head) => head === editor.state.doc.length) },
    ];
  }

  /** The code of every cell in the note, for completion. */
  private noteCode(): string {
    const codes: string[] = [];
    this.view.state.doc.descendants((child) => { if (child.type.name === "code_cell") codes.push(child.attrs.code as string); return !child.isAtom; });
    return codes.join("\n");
  }

  /** Puts the caret into the code at its `side`, unfolding a folded cell. */
  private focusCode(side: EditSide): void {
    if (!this.view.editable) return;
    if (this.hasOutput && !this.open) this.openCode();
    this.editor.focus();
    this.editor.dispatch({ selection: { anchor: side === "start" ? 0 : this.editor.state.doc.length }, scrollIntoView: true });
  }

  /** Backspace in an empty cell replaces it with an empty paragraph holding the caret. */
  private removeCell(): boolean {
    const pos = this.getPos();
    if (pos === undefined) return false;
    const paragraph = this.view.state.schema.nodes.paragraph!;
    const tr = this.view.state.tr.replaceWith(pos, pos + this.node.nodeSize, paragraph.create());
    this.view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1)).scrollIntoView());
    this.view.focus();
    return true;
  }

  /** A normal run, with `params` or else the values of the cell's param lines; resolves at its end state ('missing' when it cannot run). */
  private run(params?: CellParamValues): Promise<CellRunEnd> {
    const language = this.language();
    const onRunCell = this.onRunCell;
    if (!onRunCell || !language) return Promise.resolve("missing");
    const values = params ?? paramValues(this.cellParams.declared());
    const code = this.node.attrs.code as string;
    // The cell is marked as the one whose run is pending, so the run status can show it running in place.
    return this.runs.run(() => (Object.keys(values).length > 0 ? onRunCell(this.label(), code, language, values) : onRunCell(this.label(), code, language)));
  }

  private restart(): void {
    const language = this.language();
    if (this.onRestartCell && language) this.onRestartCell(language);
  }

  /** Switches the cell to `language`, dropping the stored fence info so the fence is written for the new language. */
  private setLanguage(language: CellLanguage): void {
    const pos = this.getPos();
    if (pos === undefined || !this.view.editable || this.language() === language) return;
    this.view.dispatch(this.view.state.tr.setNodeMarkup(pos, undefined, { ...this.node.attrs, lang: language, info: null }));
  }

  /** The host's address of an unlabeled cell: `cell-<n>`, its 1-based position among the item's cells (contract qmd-items#outputs). */
  private positionLabel(): string {
    const pos = this.getPos();
    let position = 0;
    this.view.state.doc.descendants((child, childPos) => {
      if (pos === undefined || childPos > pos) return false;
      if (child.type.name === "code_cell") position++;
      return child.type.name !== "code_cell";
    });
    return `cell-${position}`;
  }

  /** Writes the edited text back; `code` holds whole lines, so the final newline the editor does not show is restored. */
  private commit(text: string): void {
    const code = text === "" ? "" : `${text}\n`;
    if (code !== this.node.attrs.code) setViewNodeAttribute(this.view, this.getPos, "code", code);
  }

  update(node: ProseNode, decorations: readonly Decoration[]): boolean {
    if (node.type !== this.node.type) return false;
    if (node.attrs.code !== this.node.attrs.code) this.runs.edited();
    this.node = node;
    this.collapsed = collapsedSummary(decorations);
    this.render();
    this.watchOutputs();
    this.syncOutputs();
    setCodeCellEditable(this.editor, this.view.editable);
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target as Node | null;
    if (target === null || this.pre.contains(target) || this.cellParams.strip.el.contains(target)) return target !== null;
    // A drag from the line goes to the editor, which moves the cell with its outputs; a param preview's figure and its
    // buttons take their own pointer, wheel and key events, like a stored output's (outputView.ts).
    return event.type !== "dragstart" && (target as Element).closest?.(".qmd-cell-summary, .qmd-cell-actions, .qmd-output-plot, .qmd-plot-tools, .qmd-output-expand") != null;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.classObserver.disconnect();
    this.outputObserver.disconnect();
    this.runs.destroy();
    this.cellParams.destroy();
    this.editor.destroy();
  }
}

/**
 * A node view for `code_cell`; the Run link and Mod-Enter call `onRunCell(label, code, language, params?)` and are absent without it or
 * for a fence language that is not a cell language; Restart <Language> calls `onRestartCell(language)` and shows only with it.
 * `noteActions` drives the cell menu's Run above and Run below and Mod-Shift-Enter (Run all); without it those run entries are disabled.
 */
export function createCodeCellView(onRunCell?: RunCell, onRestartCell?: RestartCell, loadPlotly?: PlotlyLoader, noteActions?: NoteActions): NodeViewConstructor {
  return (node, view, getPos, decorations) => new CodeCellView(node, view, getPos, decorations, onRunCell, onRestartCell, loadPlotly, noteActions);
}
