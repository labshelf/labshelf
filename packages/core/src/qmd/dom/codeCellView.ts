// Shows code cells like figures: a new cell's code with a quiet Run line under it, and a cell with a result folded behind its outputs until Show code unfolds it.
import type { Node as ProseNode } from "prosemirror-model";
import type { EditorView, NodeView, NodeViewConstructor } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { TextSelection } from "prosemirror-state";
import { completionStatus } from "@codemirror/autocomplete";
import type { EditorView as CodeEditorView, KeyBinding } from "@codemirror/view";
import { cellLanguageLabel, type CellLanguage, type CellResult } from "../compute/index.js";
import { formatCellParamLine, paramValues, parseCellParams, setCellParamValue, type CellParam, type CellParamValue } from "../item/index.js";
import { createCellParamStrip, paramsFromControls, withParamValue, type CellParamStrip, type CellParamValues } from "./cellParamStrip.js";
import { createCodeCellEditor, setCodeCellEditable, setCodeCellLanguage, syncCodeCellEditor } from "./codeCellEditor.js";
import { exitNode, fenceCellLanguage, registerCellControls, registerNodeEditor, renderLanguagePicker, renderRestartButton, setViewNodeAttribute, type CellControls, type EditSide } from "./inlineViews.js";
import { shortcutLabel } from "./qmdCommands.js";
import { outputContent, readCellLabel, renderPreviewResult } from "./outputView.js";

const isHistoryKey = (event: KeyboardEvent): boolean => (event.metaKey || event.ctrlKey) && !event.altKey && /^[zy]$/i.test(event.key);

/** The editor shows `code` without the final newline that ends its last line. */
const editorText = (code: string): string => (code.endsWith("\n") ? code.slice(0, -1) : code);

/** The name a cell's fence language is shown by: a cell language's label, or the fence language as written. */
const cellLanguageName = (lang: string | null): string => {
  const language = fenceCellLanguage(lang);
  return language ? cellLanguageLabel(language) : lang ?? "";
};

/**
 * Runs a cell: its label, its code, its language and its param values. A preview passes `preview`, which the host calls exactly
 * once: with the result when its cellPreview arrives, or with undefined when the request ends without one; a normal run passes none.
 */
export type RunCell = (label: string, code: string, language: CellLanguage, params?: Record<string, CellParamValue>, preview?: (result: CellResult | undefined) => void) => void;
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
  private hasOutput = false;
  private open = false;
  private running = false;
  private readonly strip: CellParamStrip;
  /** The params the last result's Manipulate controls describe; drawn while the cell has no param lines. */
  private resultParams: CellParam[] = [];
  /** The result of the latest drag preview, shown in place of the stored output until the release run ends. */
  private previewResult: CellResult | null = null;
  /** Set by a release; the end of the next normal run drops the preview result. */
  private releaseRun: "pending" | "running" | null = null;
  /** A preview result of a cell without a stored output, drawn after the cell inside this view (never in the document). */
  private readonly previewOutput: HTMLElement;
  private shownPreview: CellResult | null = null;

  constructor(private node: ProseNode, private readonly view: EditorView, private readonly getPos: () => number | undefined,
    private readonly onRunCell?: RunCell, private readonly onRestartCell?: RestartCell) {
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
    // The strip is a sibling of the panel, so a folded cell still shows it above its outputs.
    this.strip = createCellParamStrip({ preview: (values, done) => this.preview(values, done), release: (values) => this.release(values) });
    this.previewOutput = renderElement("div", { class: "qmd-output qmd-cell-preview is-preview", contenteditable: "false", hidden: true });
    this.dom = renderElement("div", { class: "qmd-cell" }, this.panel, this.strip.el, this.previewOutput);
    registerNodeEditor(this.dom, (side) => this.focusCode(side));
    this.controls = {
      language: () => cellLanguageName(this.node.attrs.lang as string | null),
      cellLanguage: () => this.language(),
      setLanguage: (language) => this.setLanguage(language),
      canRun: () => this.canRun(),
      run: () => this.run(),
      canRestart: () => this.onRestartCell !== undefined && this.language() !== undefined,
      restart: () => this.restart(),
      hasResult: () => this.hasOutput,
      folded: () => this.hasOutput && !this.open,
      isOpen: () => this.open,
      setOpen: (open) => (open ? this.openCode() : this.closeCode()),
      isRunning: () => this.running,
      previewResult: () => this.previewResult ?? undefined,
      subscribe: (listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); },
      refresh: (now) => { if (now) this.syncOutputs(true); else queueMicrotask(() => this.syncOutputs()); },
    };
    registerCellControls(this.dom, this.controls, view, getPos());
    // The run status marks the cell `is-running`; outputs show it in their line.
    this.classObserver = new MutationObserver(() => {
      const running = this.dom.classList.contains("is-running");
      if (running === this.running) return;
      this.running = running;
      if (!running) this.runEnded();
      else if (this.releaseRun === "pending") this.releaseRun = "running";
      this.notify();
    });
    this.classObserver.observe(this.dom, { attributes: true, attributeFilter: ["class"] });
    this.render();
    // A cell with a result starts folded, so the note reads as text with its results in it.
    this.syncOutputs();
  }

  /** After a normal run: a release run drops the preview result; a param-less Manipulate cell asks for its controls. */
  private runEnded(): void {
    if (this.releaseRun === "running") { this.releaseRun = null; this.previewResult = null; }
    const language = this.language();
    if (!this.onRunCell || language !== "mathematica" || this.params().length > 0 || !(this.node.attrs.code as string).includes("Manipulate[")) return;
    this.onRunCell(this.label(), this.node.attrs.code as string, language, {}, (result) => {
      if (!result?.controls || this.view.isDestroyed) return;
      this.resultParams = paramsFromControls(result.controls);
      this.renderStrip();
    });
  }

  /** The params the strip draws: the cell's param lines, or else the last result's Manipulate controls. */
  private params(): CellParam[] {
    return parseCellParams(this.node.attrs.options as string);
  }

  private stripParams(): CellParam[] {
    const declared = this.params();
    return declared.length > 0 ? declared : this.resultParams;
  }

  private renderStrip(): void {
    this.strip.render(this.stripParams(), this.canRun());
  }

  /** A drag preview: runs the cell with `values`, showing the result in place of the stored output. */
  private preview(values: CellParamValues, done: () => void): void {
    const language = this.language();
    if (!this.onRunCell || !language) { done(); return; }
    this.onRunCell(this.label(), this.node.attrs.code as string, language, values, (result) => {
      if (result && !this.view.isDestroyed) { this.previewResult = result; this.notify(); }
      done();
    });
  }

  /** A release: writes the values into the param lines (Manipulate controls become param lines) in one step, then runs. */
  private release(values: CellParamValues): void {
    const options = this.node.attrs.options as string;
    const declared = this.params();
    let next = options;
    if (declared.length > 0) {
      for (const param of declared) if (values[param.name] !== undefined) next = setCellParamValue(next, param.name, values[param.name]!);
    } else if (this.resultParams.length > 0) {
      const base = options === "" || options.endsWith("\n") ? options : `${options}\n`;
      next = base + this.resultParams.map((param) => `${formatCellParamLine(withParamValue(param, values[param.name]))}\n`).join("");
    }
    if (next !== options && this.view.editable) setViewNodeAttribute(this.view, this.getPos, "options", next);
    this.releaseRun = "pending";
    this.run(values);
  }

  private label(): string {
    return readCellLabel(this.node.attrs.options as string) || this.positionLabel();
  }

  private notify(): void {
    this.renderPreviewOutput();
    for (const listener of this.listeners) listener();
  }

  /** Shows the preview result after the cell while it has no stored output (an output shows it in place otherwise). */
  private renderPreviewOutput(): void {
    const result = this.hasOutput ? null : this.previewResult;
    this.previewOutput.hidden = result === null;
    if (result === this.shownPreview) return;
    this.shownPreview = result;
    if (result === null) this.previewOutput.replaceChildren();
    else this.previewOutput.replaceChildren(renderElement("div", { class: "qmd-output-body" }, renderPreviewResult(result)));
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

  /** The quiet line under the code: the language picker (or the fence language as text), Run and Restart; redrawn only when one of them changes. */
  private renderActions(): void {
    const key = `${this.node.attrs.lang as string | null}\u0000${this.view.editable}`;
    if (key === this.actionsKey) return;
    this.actionsKey = key;
    const sep = (): HTMLElement => renderElement("span", { class: "qmd-action-sep", "aria-hidden": "true" }, "·");
    const children: Node[] = [renderLanguagePicker(this.controls, "qmd-cell-lang", this.view.editable)];
    if (this.canRun()) {
      const run = renderElement("button", { class: "qmd-cell-run", type: "button", title: `Run (${shortcutLabel("Mod-Enter")}) · run and continue below (${shortcutLabel("Shift-Enter")})`, "aria-label": "Run cell" },
        "Run",
        renderElement("span", { class: "qmd-cell-run-icon", html: renderIcon("play"), "aria-hidden": "true" }),
        renderElement("span", { class: "qmd-cell-run-spinner", html: renderIcon("loader"), "aria-hidden": "true" }));
      run.addEventListener("click", () => this.run());
      children.push(sep(), run);
    }
    const restart = renderRestartButton(this.controls, "qmd-cell-run qmd-cell-restart");
    if (restart) children.push(sep(), restart);
    this.actions.replaceChildren(...children);
  }

  private render(): void {
    const label = readCellLabel(this.node.attrs.options as string);
    this.renderActions();
    setCodeCellLanguage(this.editor, this.language());
    this.dom.dataset.cellLabel = label;
    this.renderStrip();
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
    const run = (): boolean => { if (!this.canRun()) return false; this.run(); return true; };
    return [
      // Undo and redo go through the note's history, which also holds the code edits.
      { any: (_editor, event) => isHistoryKey(event) && (this.view.someProp("handleKeyDown", (handle) => handle(this.view, event)) ?? false) },
      { key: "Mod-Enter", run },
      // Shift-Enter runs the cell and carries on writing below its result, so a note reads as text with results in it.
      { key: "Shift-Enter", run: () => { if (this.canRun()) this.run(); this.closeCode(); return this.leave(1); } },
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

  /** A normal run, with `params` or else the values of the cell's param lines. */
  private run(params?: CellParamValues): void {
    const language = this.language();
    if (!this.onRunCell || !language) return;
    const values = params ?? paramValues(this.params());
    // Marks the cell whose run is pending, so the run status can show it running in place.
    for (const cell of Array.from(this.view.dom.querySelectorAll(".qmd-cell.is-run-requested"))) cell.classList.remove("is-run-requested");
    this.dom.classList.add("is-run-requested");
    const code = this.node.attrs.code as string;
    if (Object.keys(values).length > 0) this.onRunCell(this.label(), code, language, values);
    else this.onRunCell(this.label(), code, language);
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

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    this.syncOutputs();
    setCodeCellEditable(this.editor, this.view.editable);
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target as Node | null;
    if (target === null || this.pre.contains(target) || this.strip.el.contains(target)) return target !== null;
    // A drag from the line goes to the editor, which moves the cell with its outputs.
    return event.type !== "dragstart" && (target as Element).closest?.(".qmd-cell-actions") != null;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.classObserver.disconnect();
    this.strip.destroy();
    this.editor.destroy();
  }
}

/**
 * A node view for `code_cell`; the Run link and Mod-Enter call `onRunCell(label, code, language, params?)` and are absent without it or
 * for a fence language that is not a cell language; Restart <Language> calls `onRestartCell(language)` and shows only with it.
 */
export function createCodeCellView(onRunCell?: RunCell, onRestartCell?: RestartCell): NodeViewConstructor {
  return (node, view, getPos) => new CodeCellView(node, view, getPos, onRunCell, onRestartCell);
}
