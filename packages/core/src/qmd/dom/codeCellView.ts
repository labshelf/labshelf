// Shows code cells with their Run button and the stored outputs under them, marking an output out of date when its cell's code hashes to something other than the output's `source`.
import type { Node as ProseNode } from "prosemirror-model";
import type { EditorView, NodeView, NodeViewConstructor } from "prosemirror-view";
import { renderElement } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { TextSelection } from "prosemirror-state";
import { completionStatus } from "@codemirror/autocomplete";
import type { EditorView as CodeEditorView, KeyBinding } from "@codemirror/view";
import { createCodeCellEditor, setCodeCellEditable, syncCodeCellEditor } from "./codeCellEditor.js";
import { exitNode, registerNodeEditor, setViewNodeAttribute, type EditSide } from "./inlineViews.js";
import { shortcutLabel } from "./qmdCommands.js";
import { outputContent, readCellLabel } from "./outputView.js";

const isHistoryKey = (event: KeyboardEvent): boolean => (event.metaKey || event.ctrlKey) && !event.altKey && /^[zy]$/i.test(event.key);

/** Cells with more lines than this start collapsed when they already have a result. */
const COLLAPSE_LINES = 12;

/** The first line of `code` with text, shown in place of a collapsed cell's code. */
function summaryLine(code: string): string {
  return code.split("\n").find((line) => line.trim())?.trim() ?? "Empty cell";
}

/** The editor shows `code` without the final newline that ends its last line. */
const editorText = (code: string): string => (code.endsWith("\n") ? code.slice(0, -1) : code);

/** The name a cell's language is shown by in its header. */
const languageName = (lang: string | null): string => (lang === "python" ? "Python" : lang ?? "");

/**
 * Shows a code cell as one card: a slim header (collapse chevron, language, label, Run) over its code in a CodeMirror
 * editor. Edits become transactions on the cell's `code`; arrow keys past the first or last line, and Escape, hand the
 * caret back to the note, and undo and redo go through the note's history.
 */
class CodeCellView implements NodeView {
  readonly dom: HTMLElement;
  private readonly labelText: HTMLElement;
  private readonly langText: HTMLElement;
  private readonly summary: HTMLButtonElement;
  private readonly pre: HTMLElement;
  private readonly toggle: HTMLButtonElement;
  private readonly editor: CodeEditorView;

  constructor(private node: ProseNode, private readonly view: EditorView, private readonly getPos: () => number | undefined, private readonly onRunCell?: (label: string, code: string) => void) {
    this.toggle = renderElement("button", { class: "qmd-cell-toggle", type: "button", html: renderIcon("chevron-down") });
    this.toggle.addEventListener("click", () => this.showCode(this.pre.hidden === true));
    this.langText = renderElement("span", { class: "qmd-cell-lang" });
    this.labelText = renderElement("span", { class: "qmd-cell-label" });
    this.summary = renderElement("button", { class: "qmd-cell-summary", type: "button", title: "Show code" });
    this.summary.addEventListener("click", () => this.focusCode("start"));
    const header = renderElement("div", { class: "qmd-cell-bar", contenteditable: "false" }, this.toggle, this.langText, this.labelText, this.summary);
    if (onRunCell) {
      const run = renderElement("button", { class: "qmd-cell-run", type: "button", title: `Run (${shortcutLabel("Mod-Enter")})`, "aria-label": "Run cell" },
        renderElement("span", { class: "qmd-cell-run-icon", html: renderIcon("play"), "aria-hidden": "true" }),
        renderElement("span", { class: "qmd-cell-run-spinner", html: renderIcon("loader"), "aria-hidden": "true" }),
        renderElement("span", { class: "qmd-cell-run-text", text: "Run", "aria-hidden": "true" }));
      run.addEventListener("click", () => this.run());
      header.append(run);
    }
    this.editor = createCodeCellEditor({
      text: editorText(node.attrs.code as string),
      editable: view.editable,
      keys: this.keys(),
      onChange: (text) => this.commit(text),
      noteCode: () => this.noteCode(),
    });
    this.pre = renderElement("div", { class: "qmd-cell-code" }, this.editor.dom);
    this.dom = renderElement("div", { class: "qmd-cell" }, header, this.pre);
    registerNodeEditor(this.dom, (side) => this.focusCode(side));
    const label = readCellLabel(node.attrs.options as string);
    let hasResult = false;
    view.state.doc.descendants((child) => { if (label && child.type.name === "output" && child.attrs.cell === label && outputContent(child.attrs.raw as string).trim()) { hasResult = true; } });
    this.render();
    this.showCode(!hasResult || (node.attrs.code as string).split("\n").length <= COLLAPSE_LINES);
  }

  private showCode(show: boolean): void {
    this.pre.hidden = !show;
    this.toggle.setAttribute("aria-expanded", String(show));
    this.toggle.setAttribute("aria-label", show ? "Collapse code" : "Expand code");
    this.toggle.title = show ? "Collapse code" : "Expand code";
    this.summary.hidden = show;
    this.dom.classList.toggle("qmd-cell-collapsed", !show);
    if (show) this.editor.requestMeasure();
  }

  private render(): void {
    const label = readCellLabel(this.node.attrs.options as string);
    this.langText.textContent = languageName(this.node.attrs.lang as string | null);
    this.labelText.textContent = label;
    this.dom.dataset.cellLabel = label;
    const code = this.node.attrs.code as string;
    this.summary.textContent = summaryLine(code);
    syncCodeCellEditor(this.editor, editorText(code));
  }

  /** The keys the cell handles before the code editor: run, history, Escape, Backspace in an empty cell, and arrows past the edges. */
  private keys(): KeyBinding[] {
    const idle = (editor: CodeEditorView): boolean => completionStatus(editor.state) !== "active";
    const caret = (editor: CodeEditorView): number | null => (editor.state.selection.main.empty ? editor.state.selection.main.head : null);
    const leave = (dir: 1 | -1, atEdge: (editor: CodeEditorView, head: number) => boolean) => (editor: CodeEditorView): boolean => {
      const head = caret(editor);
      return head !== null && idle(editor) && atEdge(editor, head) && exitNode(this.view, this.getPos, dir);
    };
    const run = (): boolean => { if (!this.onRunCell) return false; this.run(); return true; };
    return [
      // Undo and redo go through the note's history, which also holds the code edits.
      { any: (_editor, event) => isHistoryKey(event) && (this.view.someProp("handleKeyDown", (handle) => handle(this.view, event)) ?? false) },
      { key: "Mod-Enter", run },
      { key: "Shift-Enter", run },
      { key: "Escape", run: (editor) => idle(editor) && exitNode(this.view, this.getPos, 1) },
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

  /** Puts the caret into the code at its `side`, expanding a collapsed cell. */
  private focusCode(side: EditSide): void {
    if (!this.view.editable) return;
    if (this.pre.hidden) this.showCode(true);
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
    this.summary.textContent = summaryLine(code);
    if (code !== this.node.attrs.code) setViewNodeAttribute(this.view, this.getPos, "code", code);
  }

  update(node: ProseNode): boolean {
    if (node.type !== this.node.type) return false;
    this.node = node;
    this.render();
    setCodeCellEditable(this.editor, this.view.editable);
    return true;
  }

  stopEvent(event: Event): boolean {
    const target = event.target as Node | null;
    return target !== null && (this.pre.contains(target) || (target as Element).closest?.(".qmd-cell-bar") != null);
  }

  ignoreMutation(): boolean {
    return true;
  }

  destroy(): void {
    this.editor.destroy();
  }
}

/** A node view for `code_cell`; the Run button and Mod-Enter call `onRunCell(label, code)` and are absent without it. */
export function createCodeCellView(onRunCell?: (label: string, code: string) => void): NodeViewConstructor {
  return (node, view, getPos) => new CodeCellView(node, view, getPos, onRunCell);
}
