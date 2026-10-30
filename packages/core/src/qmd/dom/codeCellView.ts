// Shows code cells like figures: a new cell's code with a quiet Run line under it, and a cell with a result folded behind its outputs until Show code unfolds it.
import type { Node as ProseNode } from "prosemirror-model";
import type { EditorView, NodeView, NodeViewConstructor } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { TextSelection } from "prosemirror-state";
import { completionStatus } from "@codemirror/autocomplete";
import type { EditorView as CodeEditorView, KeyBinding } from "@codemirror/view";
import { createCodeCellEditor, setCodeCellEditable, syncCodeCellEditor } from "./codeCellEditor.js";
import { exitNode, registerCellControls, registerNodeEditor, setViewNodeAttribute, type EditSide } from "./inlineViews.js";
import { shortcutLabel } from "./qmdCommands.js";
import { outputContent, readCellLabel } from "./outputView.js";

const isHistoryKey = (event: KeyboardEvent): boolean => (event.metaKey || event.ctrlKey) && !event.altKey && /^[zy]$/i.test(event.key);

/** The editor shows `code` without the final newline that ends its last line. */
const editorText = (code: string): string => (code.endsWith("\n") ? code.slice(0, -1) : code);

/** The name a cell's language is shown by. */
const languageName = (lang: string | null): string => (lang === "python" ? "Python" : lang ?? "");

/**
 * Shows a code cell like a figure. A cell without a result shows its code in a CodeMirror editor with one quiet line
 * under it (the language and Run), which also drags the cell. A cell with a result keeps its code out of the note: its
 * outputs carry the line, and Show code unfolds the code in place above them.
 * Edits become transactions on the cell's `code`; arrow keys past the first or last line, and Escape, hand the caret
 * back to the note, and undo and redo go through the note's history.
 */
class CodeCellView implements NodeView {
  readonly dom: HTMLElement;
  private readonly pre: HTMLElement;
  private readonly panel: HTMLElement;
  private readonly actions: HTMLElement;
  private readonly langText: HTMLElement;
  private readonly editor: CodeEditorView;
  private readonly listeners = new Set<() => void>();
  private readonly classObserver: MutationObserver;
  private hasOutput = false;
  private open = false;
  private running = false;

  constructor(private node: ProseNode, private readonly view: EditorView, private readonly getPos: () => number | undefined, private readonly onRunCell?: (label: string, code: string) => void) {
    this.langText = renderElement("span", { class: "qmd-cell-lang" });
    // The line is the cell's handle: dragging it moves the cell with its outputs (blockDragPlugin).
    this.actions = renderElement("div", { class: "qmd-cell-actions", contenteditable: "false", draggable: "true" }, this.langText);
    if (onRunCell) {
      const run = renderElement("button", { class: "qmd-cell-run", type: "button", title: `Run (${shortcutLabel("Mod-Enter")}) · run and continue below (${shortcutLabel("Shift-Enter")})`, "aria-label": "Run cell" },
        "Run",
        renderElement("span", { class: "qmd-cell-run-icon", html: renderIcon("play"), "aria-hidden": "true" }),
        renderElement("span", { class: "qmd-cell-run-spinner", html: renderIcon("loader"), "aria-hidden": "true" }));
      run.addEventListener("click", () => this.run());
      this.actions.append(renderElement("span", { class: "qmd-action-sep", "aria-hidden": "true" }, "·"), run);
    }
    this.editor = createCodeCellEditor({
      text: editorText(node.attrs.code as string),
      editable: view.editable,
      keys: this.keys(),
      onChange: (text) => this.commit(text),
      noteCode: () => this.noteCode(),
    });
    this.pre = renderElement("div", { class: "qmd-cell-code" }, this.editor.dom);
    this.panel = renderElement("div", { class: "qmd-cell-panel" }, this.pre, this.actions);
    this.dom = renderElement("div", { class: "qmd-cell" }, this.panel);
    registerNodeEditor(this.dom, (side) => this.focusCode(side));
    registerCellControls(this.dom, {
      language: () => languageName(this.node.attrs.lang as string | null),
      canRun: onRunCell !== undefined,
      run: () => this.run(),
      hasResult: () => this.hasOutput,
      folded: () => this.hasOutput && !this.open,
      isOpen: () => this.open,
      setOpen: (open) => (open ? this.openCode() : this.closeCode()),
      isRunning: () => this.running,
      subscribe: (listener) => { this.listeners.add(listener); return () => this.listeners.delete(listener); },
      refresh: () => queueMicrotask(() => this.syncOutputs()),
    });
    // The run status marks the cell `is-running`; outputs show it in their line.
    this.classObserver = new MutationObserver(() => {
      const running = this.dom.classList.contains("is-running");
      if (running !== this.running) { this.running = running; this.notify(); }
    });
    this.classObserver.observe(this.dom, { attributes: true, attributeFilter: ["class"] });
    this.render();
    // A cell with a result starts folded, so the note reads as text with its results in it.
    this.syncOutputs();
  }

  private notify(): void {
    for (const listener of this.listeners) listener();
  }

  /** Folds the cell while it has a result; a result arriving while its code has the caret leaves the code unfolded. */
  private syncOutputs(): void {
    if (this.view.isDestroyed) return;
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

  private render(): void {
    const label = readCellLabel(this.node.attrs.options as string);
    this.langText.textContent = languageName(this.node.attrs.lang as string | null);
    this.dom.dataset.cellLabel = label;
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
    const run = (): boolean => { if (!this.onRunCell) return false; this.run(); return true; };
    return [
      // Undo and redo go through the note's history, which also holds the code edits.
      { any: (_editor, event) => isHistoryKey(event) && (this.view.someProp("handleKeyDown", (handle) => handle(this.view, event)) ?? false) },
      { key: "Mod-Enter", run },
      // Shift-Enter runs the cell and carries on writing below its result, so a note reads as text with results in it.
      { key: "Shift-Enter", run: () => { if (this.onRunCell) this.run(); this.closeCode(); return this.leave(1); } },
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

  private run(): void {
    if (!this.onRunCell) return;
    // Marks the cell whose run is pending, so the run status can show it running in place.
    for (const cell of Array.from(this.view.dom.querySelectorAll(".qmd-cell.is-run-requested"))) cell.classList.remove("is-run-requested");
    this.dom.classList.add("is-run-requested");
    this.onRunCell(readCellLabel(this.node.attrs.options as string) || this.positionLabel(), this.node.attrs.code as string);
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
    if (target === null || this.pre.contains(target)) return target !== null;
    // A drag from the line goes to the editor, which moves the cell with its outputs.
    return event.type !== "dragstart" && (target as Element).closest?.(".qmd-cell-actions") != null;
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.classObserver.disconnect();
    this.editor.destroy();
  }
}

/** A node view for `code_cell`; the Run link and Mod-Enter call `onRunCell(label, code)` and are absent without it. */
export function createCodeCellView(onRunCell?: (label: string, code: string) => void): NodeViewConstructor {
  return (node, view, getPos) => new CodeCellView(node, view, getPos, onRunCell);
}
