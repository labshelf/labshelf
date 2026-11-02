// The source editor's text updates: insertions, snippets and wrapping the selection, the Cmd/Ctrl+B and Cmd/Ctrl+I keymap, and the Insert Table dialog whose cells become a table snippet.
import { snippet } from "@codemirror/autocomplete";
import { EditorSelection, type Extension } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import { deriveSelectionWrap, type WrapKind } from "../../../index.js";
import { mountOverlay, renderElement } from "../../../ui/dom/index.js";
import { renderIcon } from "../../../ui/icons/index.js";
import { parseDelimitedTable, type FilledTableSpec } from "../../snippets.js";
import { reviewEdit } from "./review.js";

/** `$1` and `${1:Caption}` become CodeMirror fields, `$0` the final cursor, and `\\`, `\$`, `\}` their literal characters. */
export function deriveCodeMirrorTemplate(textMate: string): string {
  return textMate
    .replace(/\\([\\$}])|\$(\d+)|\$\{(\d+)(?::([^}]*))?\}/g, (_match, literal?: string, bare?: string, field?: string, placeholder?: string) => {
      if (literal !== undefined) return literal;
      if (bare !== undefined) return `\${${bare}}`;
      return placeholder === undefined ? `\${${field}}` : `\${${field}:${placeholder}}`;
    })
    // CodeMirror reads a backslash before a brace as an escape, so a literal one is doubled.
    .replace(/\\(?=[{}])/g, "\\\\");
}

export type SourceLanguage = "latex" | "typst";

/** Typst for a `.typ` file, LaTeX for any other. */
export function deriveSourceLanguage(path: string): SourceLanguage {
  return path.endsWith(".typ") ? "typst" : "latex";
}

export interface SourceUpdates {
  /** Replaces every selection with the text and puts a cursor after each. */
  insertText(text: string): void;
  /** Inserts a core snippet at the main selection and starts its tab stops. */
  insertSnippet(textMateSnippet: string): void;
  /** Wraps each selection in the style's markup, or removes the markup when it is already there; an empty selection gets an empty pair. */
  wrap(style: WrapKind): void;
}

function insertText(view: EditorView, text: string): void {
  view.dispatch(view.state.update(
    view.state.changeByRange((range) => ({ changes: { from: range.from, to: range.to, insert: text }, range: EditorSelection.cursor(range.from + text.length) })),
    { scrollIntoView: true, userEvent: "input", annotations: reviewEdit.of(true) },
  ));
}

function wrapSelections(view: EditorView, language: SourceLanguage, style: WrapKind): void {
  const { state } = view;
  view.dispatch(state.update(
    state.changeByRange((range) => {
      const { text, cursor } = deriveSelectionWrap(language, style, state.sliceDoc(range.from, range.to));
      return {
        changes: { from: range.from, to: range.to, insert: text },
        range: cursor === undefined ? EditorSelection.range(range.from, range.from + text.length) : EditorSelection.cursor(range.from + cursor),
      };
    }),
    { scrollIntoView: true, userEvent: "input", annotations: reviewEdit.of(true) },
  ));
}

export function createSourceUpdates(view: EditorView, language: SourceLanguage): SourceUpdates {
  return {
    insertText: (text) => { insertText(view, text); view.focus(); },
    insertSnippet: (textMateSnippet) => {
      const { from, to } = view.state.selection.main;
      snippet(deriveCodeMirrorTemplate(textMateSnippet))(view, null, from, to);
      view.focus();
    },
    wrap: (style) => { wrapSelections(view, language, style); view.focus(); },
  };
}

/** Cmd/Ctrl+B and Cmd/Ctrl+I wrap the selection, as in the VS Code editor. */
export function createFormattingKeymap(language: SourceLanguage): Extension {
  const wrapWith = (style: WrapKind) => (view: EditorView): boolean => { wrapSelections(view, language, style); return true; };
  return keymap.of([
    { key: "Mod-b", preventDefault: true, run: wrapWith("bold") },
    { key: "Mod-i", preventDefault: true, run: wrapWith("italic") },
  ]);
}

const MAX_COLUMNS = 30;
const MAX_ROWS = 300;

interface Grid { cells: string[][]; header: boolean }

const clamp = (value: number, max: number): number => Math.max(1, Math.min(max, value));

/** Grows or shrinks the grid to the size, keeping what fits. */
function resize(grid: Grid, columns: number, rows: number): void {
  grid.cells = Array.from({ length: rows }, (_, r) => Array.from({ length: columns }, (_, c) => grid.cells[r]?.[c] ?? ""));
}

/** Puts rows of cells into the grid from a cell on, growing it to fit within the limits. */
function fill(grid: Grid, data: string[][], fromRow: number, fromColumn: number): void {
  const columns = clamp(Math.max(grid.cells[0]?.length ?? 1, fromColumn + Math.max(...data.map((row) => row.length))), MAX_COLUMNS);
  const rows = clamp(Math.max(grid.cells.length, fromRow + data.length), MAX_ROWS);
  resize(grid, columns, rows);
  data.forEach((row, r) => row.forEach((text, c) => {
    if (fromRow + r < rows && fromColumn + c < columns) grid.cells[fromRow + r]![fromColumn + c] = text;
  }));
}

function stepper(label: string, value: () => number, set: (next: number) => void): { root: HTMLElement; refresh(): void } {
  const out = renderElement("output", { class: "ls-table-dialog-count" });
  const button = (glyph: "minus" | "plus", by: number): HTMLElement => {
    const b = renderElement("button", { type: "button", class: "ls-icon-btn", title: `${by < 0 ? "Remove" : "Add"} ${label.toLowerCase().replace(/s$/, "")}`, html: renderIcon(glyph) });
    b.addEventListener("click", () => set(value() + by));
    return b;
  };
  const root = renderElement("div", { class: "ls-table-dialog-stepper" }, renderElement("span", { text: label }), button("minus", -1), out, button("plus", 1));
  return { root, refresh: () => { out.textContent = String(value()); } };
}

/** Draws the grid's cells as table rows; an edit writes the cell back, a paste of spreadsheet cells fills the grid from that cell on and calls `redraw`. */
function drawCells(grid: Grid, table: HTMLElement, redraw: () => void): void {
  table.replaceChildren(...grid.cells.map((row, r) => renderElement("tr", {}, ...row.map((text, c) => {
    const input = renderElement("input", { type: "text", class: "ls-table-dialog-cell", value: text, "aria-label": `Row ${r + 1}, column ${c + 1}`, spellcheck: "false" });
    input.addEventListener("input", () => { grid.cells[r]![c] = input.value; });
    // Cells copied from a spreadsheet, tab and line separated, fill the grid from this cell on.
    input.addEventListener("paste", (event) => {
      const pasted = event.clipboardData?.getData("text/plain") ?? "";
      if (!/[\t\n]/.test(pasted)) return;
      event.preventDefault();
      fill(grid, parseDelimitedTable(pasted), r, c);
      redraw();
    });
    return renderElement("td", {}, input);
  }))));
}

/** The Import CSV button and the hidden file input behind it; a picked file replaces the grid and calls `redraw`. */
function csvImport(grid: Grid, redraw: () => void): { button: HTMLElement; file: HTMLInputElement } {
  const file = renderElement("input", { type: "file", accept: ".csv,.tsv,text/csv,text/tab-separated-values,text/plain", hidden: true });
  const button = renderElement("button", { type: "button", class: "ls-btn", html: renderIcon("upload") }, "Import CSV…");
  button.addEventListener("click", () => file.click());
  file.addEventListener("change", () => {
    const picked = file.files?.[0];
    if (!picked) return;
    void picked.text().then((text) => {
      const data = parseDelimitedTable(text);
      if (data.length === 0) return;
      grid.cells = [];
      fill(grid, data, 0, 0);
      redraw();
      file.value = "";
    });
  });
  return { button, file };
}

interface DialogParts {
  columns: HTMLElement;
  rows: HTMLElement;
  headerBox: HTMLElement;
  importButton: HTMLElement;
  file: HTMLElement;
  scroller: HTMLElement;
  cancel: HTMLElement;
  insert: HTMLElement;
}

/** The dialog box around its parts. */
function dialogBox(p: DialogParts): HTMLElement {
  return renderElement("div", { class: "ls-dialog ls-table-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Insert table" },
    renderElement("div", { class: "ls-dialog-title", text: "Insert Table" }),
    renderElement("div", { class: "ls-table-dialog-bar" }, p.columns, p.rows,
      renderElement("label", { class: "ls-table-dialog-header" }, p.headerBox, renderElement("span", { text: "First row is a header" })),
      renderElement("span", { class: "ls-table-dialog-spacer" }), p.importButton, p.file),
    p.scroller,
    renderElement("div", { class: "ls-table-dialog-hint", text: "Empty cells become placeholders you fill in the editor. Paste cells from a spreadsheet to fill the grid." }),
    renderElement("div", { class: "ls-dialog-actions" }, p.cancel, p.insert));
}

/** Opens the dialog on an empty 3 × 3 grid; resolves with the filled table, or null on Cancel or Escape. */
export function runTableDialog(): Promise<FilledTableSpec | null> {
  return new Promise((resolve) => {
    const grid: Grid = { cells: [], header: false };
    resize(grid, 3, 3);
    const table = renderElement("table", { class: "ls-table-dialog-grid" });
    const scroller = renderElement("div", { class: "ls-table-dialog-scroll" }, table);

    const columns = stepper("Columns", () => grid.cells[0]!.length, (next) => { resize(grid, clamp(next, MAX_COLUMNS), grid.cells.length); draw(); });
    const rows = stepper("Rows", () => grid.cells.length, (next) => { resize(grid, grid.cells[0]!.length, clamp(next, MAX_ROWS)); draw(); });
    const headerBox = renderElement("input", { type: "checkbox" });
    headerBox.addEventListener("change", () => { grid.header = headerBox.checked; table.classList.toggle("has-header", grid.header); });
    const { button: importButton, file } = csvImport(grid, () => draw());

    function draw(): void {
      drawCells(grid, table, draw);
      columns.refresh();
      rows.refresh();
    }

    const cancel = renderElement("button", { type: "button", class: "ls-btn", text: "Cancel" });
    const insert = renderElement("button", { type: "button", class: "ls-btn ls-btn-primary", text: "Insert" });
    const box = dialogBox({ columns: columns.root, rows: rows.root, headerBox, importButton, file, scroller, cancel, insert });
    const done = (result: FilledTableSpec | null): void => { overlay.close(); resolve(result); };
    const overlay = mountOverlay(box, () => resolve(null));
    cancel.addEventListener("click", () => done(null));
    insert.addEventListener("click", () => done({ cells: grid.cells, header: grid.header }));
    box.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); insert.click(); }
    });
    draw();
    table.querySelector<HTMLInputElement>("input")?.focus();
  });
}
