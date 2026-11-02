// The Insert Table dialog: a grid of cells to fill before the table is written, its size set with steppers, a CSV file
// to read in and spreadsheet cells to paste; resolves with the cells, or null when cancelled.
import { mountOverlay, renderElement } from "../../ui/dom/index.js";
import { renderIcon } from "../../ui/icons/index.js";
import { parseDelimitedTable, type FilledTableSpec } from "../snippets.js";

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

/** The CSV import button and its hidden file input; a picked file replaces the grid. */
function importControls(grid: Grid, draw: () => void): { button: HTMLElement; file: HTMLElement } {
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
      draw();
      file.value = "";
    });
  });
  return { button, file };
}

/** One cell of the grid; cells copied from a spreadsheet, tab and line separated, fill the grid from this cell on. */
function cellElement(grid: Grid, r: number, c: number, text: string, draw: () => void): HTMLElement {
  const input = renderElement("input", { type: "text", class: "ls-table-dialog-cell", value: text, "aria-label": `Row ${r + 1}, column ${c + 1}`, spellcheck: "false" });
  input.addEventListener("input", () => { grid.cells[r]![c] = input.value; });
  input.addEventListener("paste", (event) => {
    const pasted = event.clipboardData?.getData("text/plain") ?? "";
    if (!/[\t\n]/.test(pasted)) return;
    event.preventDefault();
    fill(grid, parseDelimitedTable(pasted), r, c);
    draw();
  });
  return renderElement("td", {}, input);
}

/** The size bar, the header checkbox, the import control and the scrolling grid, redrawn together by `draw`. */
function gridView(grid: Grid): { bar: HTMLElement; scroller: HTMLElement; draw: () => void } {
  const table = renderElement("table", { class: "ls-table-dialog-grid" });
  const scroller = renderElement("div", { class: "ls-table-dialog-scroll" }, table);
  const columns = stepper("Columns", () => grid.cells[0]!.length, (next) => { resize(grid, clamp(next, MAX_COLUMNS), grid.cells.length); draw(); });
  const rows = stepper("Rows", () => grid.cells.length, (next) => { resize(grid, grid.cells[0]!.length, clamp(next, MAX_ROWS)); draw(); });
  const headerBox = renderElement("input", { type: "checkbox" });
  headerBox.addEventListener("change", () => { grid.header = headerBox.checked; table.classList.toggle("has-header", grid.header); });
  const { button, file } = importControls(grid, () => draw());
  const draw = (): void => {
    table.replaceChildren(...grid.cells.map((row, r) => renderElement("tr", {}, ...row.map((text, c) => cellElement(grid, r, c, text, draw)))));
    columns.refresh();
    rows.refresh();
  };
  const bar = renderElement("div", { class: "ls-table-dialog-bar" }, columns.root, rows.root,
    renderElement("label", { class: "ls-table-dialog-header" }, headerBox, renderElement("span", { text: "First row is a header" })),
    renderElement("span", { class: "ls-table-dialog-spacer" }), button, file);
  return { bar, scroller, draw };
}

/** Opens the dialog on an empty 3 × 3 grid; resolves with the filled table, or null on Cancel or Escape. */
export function runTableDialog(): Promise<FilledTableSpec | null> {
  return new Promise((resolve) => {
    const grid: Grid = { cells: [], header: false };
    resize(grid, 3, 3);
    const view = gridView(grid);
    const cancel = renderElement("button", { type: "button", class: "ls-btn", text: "Cancel" });
    const insert = renderElement("button", { type: "button", class: "ls-btn ls-btn-primary", text: "Insert" });
    const box = renderElement("div", { class: "ls-dialog ls-table-dialog", role: "dialog", "aria-modal": "true", "aria-label": "Insert table" },
      renderElement("div", { class: "ls-dialog-title", text: "Insert Table" }),
      view.bar,
      view.scroller,
      renderElement("div", { class: "ls-table-dialog-hint", text: "Empty cells become placeholders you fill in the editor. Paste cells from a spreadsheet to fill the grid." }),
      renderElement("div", { class: "ls-dialog-actions" }, cancel, insert));
    const done = (result: FilledTableSpec | null): void => { overlay.close(); resolve(result); };
    const overlay = mountOverlay(box, () => resolve(null));
    cancel.addEventListener("click", () => done(null));
    insert.addEventListener("click", () => done({ cells: grid.cells, header: grid.header }));
    box.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && (event.metaKey || event.ctrlKey)) { event.preventDefault(); insert.click(); }
    });
    view.draw();
    box.querySelector<HTMLInputElement>("table input")?.focus();
  });
}
