// The chart data grid (plan charts, D9): a role=grid spreadsheet of the chart table with lettered columns and numbered rows,
// keyboard cell editing, add and delete of rows and columns, paste of TSV/CSV at the selected cell and import of a CSV file.
// Grid row 1 holds the column names; grid row r + 2 holds data row r. Rows beyond WINDOW_FROM are windowed.
import { askDialog, renderElement } from "../../../ui/dom/index.js";
import { columnLetter, parseCsv, type ChartTable } from "../../chart/index.js";
import { BUTTON_TEXT, cloneTable, EDITS, heightOf, isEmptyTable, pastedRows, posKey, readCell, showCell, valueAt, writeCell, type Pos } from "./gridTable.js";

const MIN_COLS = 15;
const MIN_ROWS = 30;
const WINDOW_FROM = 500;
const ROW_HEIGHT = 24;
const OVERSCAN = 20;
const FALLBACK_VIEW = 600;
const MOVES: Readonly<Record<string, Pos>> = {
  ArrowUp: { row: -1, col: 0 },
  ArrowDown: { row: 1, col: 0 },
  ArrowLeft: { row: 0, col: -1 },
  ArrowRight: { row: 0, col: 1 },
};
const HINT = "Paste CSV or TSV into the grid";
const IMPORT_LABEL = "Import data from CSV file";

/** A mark on a column's header naming its part in the chart (X, Y1, ±Y1), in the colour of its series. */
export interface ColumnBadge { text: string; color?: string }

interface GridOptions { onChange(table: ChartTable): void; pickFile?: () => Promise<{ name: string; text: string } | null>; readOnly?: boolean; badges?: (col: number) => readonly ColumnBadge[]; tools?: boolean }

/** The grid's state and DOM parts, shared by its handlers. */
interface Grid {
  options: GridOptions;
  readOnly: boolean;
  current: ChartTable;
  sel: Pos;
  editing: (Pos & { input: HTMLInputElement }) | null;
  destroyed: boolean;
  nRows: number;
  nCols: number;
  windowStart: number;
  rendered: { from: number; to: number };
  cellEls: Map<string, HTMLElement>;
  grid: HTMLElement;
  head: HTMLElement;
  body: HTMLElement;
  scroller: HTMLElement;
  errors: HTMLElement;
  container: HTMLElement;
}

/** The grid's state with its table, scroller, note and error list; the toolbar is added by `buildTools`. */
function createGrid(options: GridOptions, table: ChartTable): Grid {
  const readOnly = options.readOnly === true;
  const grid = renderElement("table", { class: "qmd-chart-grid-table", role: "grid", "aria-label": "Chart data" });
  if (readOnly) grid.setAttribute("aria-readonly", "true");
  const head = renderElement("thead");
  const body = renderElement("tbody");
  grid.append(head, body);
  const scroller = renderElement("div", { class: "qmd-chart-grid-scroll" }, grid);
  const note = renderElement("p", { class: "qmd-chart-grid-note", text: "Data file not found; the grid is read-only." });
  note.hidden = !readOnly;
  const errors = renderElement("ul", { class: "qmd-chart-grid-errors", "aria-live": "polite" });
  errors.hidden = true;
  const container = renderElement("div", { class: "qmd-chart-grid" }, scroller, note, errors);
  return { options, readOnly, current: table, sel: { row: 1, col: 0 }, editing: null, destroyed: false, nRows: 0, nCols: 0, windowStart: 0, rendered: { from: 0, to: 0 }, cellEls: new Map(), grid, head, body, scroller, errors, container };
}

function toolButton(g: Grid, attrs: Record<string, string>, onClick: () => void): HTMLButtonElement {
  const button = renderElement("button", { class: "ls-btn qmd-chart-grid-tool", type: "button", ...attrs });
  button.disabled = g.readOnly;
  button.addEventListener("click", onClick);
  return button;
}

/** The toolbar: one button per structural edit, the CSV import when the host can pick a file, and the paste hint. */
function buildTools(g: Grid): HTMLElement {
  const tools = renderElement("div", { class: "qmd-chart-grid-tools" });
  for (const name of Object.keys(EDITS)) tools.append(toolButton(g, { "aria-label": name, title: name, text: BUTTON_TEXT[name]! }, () => editTable(g, name)));
  const { pickFile } = g.options;
  if (pickFile !== undefined) tools.append(toolButton(g, { "aria-label": IMPORT_LABEL, text: IMPORT_LABEL }, () => void importFile(g, pickFile)));
  tools.append(renderElement("span", { class: "qmd-chart-grid-hint", text: pickFile === undefined ? HINT : `${HINT}, or import a CSV file.` }));
  return tools;
}

function renderHead(g: Grid): void {
  const row = renderElement("tr", { role: "row" }, renderElement("th", { class: "qmd-chart-grid-corner" }));
  for (let c = 0; c < g.nCols; c += 1) {
    const badges = (g.options.badges?.(c) ?? []).map((badge) => renderElement("span", { class: "qmd-chart-grid-badge", style: badge.color ? `background:${badge.color}` : undefined, text: badge.text }));
    row.append(renderElement("th", { class: "qmd-chart-grid-colhead", role: "columnheader", scope: "col" }, renderElement("span", { text: columnLetter(c) }), ...badges));
  }
  g.head.replaceChildren(row);
}

function renderCell(g: Grid, pos: Pos): HTMLElement {
  const cell = document.createElement("td");
  cell.className = pos.row === 0 ? "qmd-chart-grid-cell qmd-chart-grid-name" : "qmd-chart-grid-cell";
  cell.setAttribute("role", "gridcell");
  cell.dataset.row = String(pos.row);
  cell.dataset.col = String(pos.col);
  const on = pos.row === g.sel.row && pos.col === g.sel.col;
  cell.setAttribute("aria-selected", String(on));
  cell.tabIndex = on ? 0 : -1;
  cell.textContent = showCell(valueAt(g.current, pos));
  g.cellEls.set(posKey(pos), cell);
  return cell;
}

function renderRow(g: Grid, r: number): HTMLElement {
  const tr = renderElement("tr", { role: "row", "aria-rowindex": String(r + 2) }, renderElement("th", { class: "qmd-chart-grid-rowhead", role: "rowheader", scope: "row", text: String(r + 1) }));
  for (let c = 0; c < g.nCols; c += 1) tr.append(renderCell(g, { row: r, col: c }));
  return tr;
}

function spacer(rows: number): HTMLElement {
  const tr = renderElement("tr", { class: "qmd-chart-grid-spacer", role: "presentation" });
  tr.style.height = `${rows * ROW_HEIGHT}px`;
  return tr;
}

/** The rows to draw: all of them, or the window around `windowStart` once the grid passes WINDOW_FROM rows. */
function visibleRange(g: Grid): { from: number; to: number } {
  if (g.nRows <= WINDOW_FROM) return { from: 0, to: g.nRows };
  const view = Math.ceil((g.scroller.clientHeight || FALLBACK_VIEW) / ROW_HEIGHT);
  const from = Math.max(0, Math.min(g.windowStart, g.nRows - view) - OVERSCAN);
  return { from, to: Math.min(g.nRows, from + view + 2 * OVERSCAN) };
}

/** Redraws the header and the visible rows; focus returns to the selected cell when it was inside the grid. */
function renderGrid(g: Grid): void {
  const refocus = g.grid.contains(document.activeElement);
  g.nCols = Math.max(MIN_COLS, g.current.cols.length + 1);
  g.nRows = Math.max(MIN_ROWS, heightOf(g.current) + 2);
  g.grid.setAttribute("aria-colcount", String(g.nCols + 1));
  g.grid.setAttribute("aria-rowcount", String(g.nRows + 1));
  renderHead(g);
  const { from, to } = visibleRange(g);
  g.rendered = { from, to };
  g.cellEls.clear();
  const rows: HTMLElement[] = [];
  if (from > 0) rows.push(spacer(from));
  for (let r = from; r < to; r += 1) rows.push(renderRow(g, r));
  if (to < g.nRows) rows.push(spacer(g.nRows - to));
  g.body.replaceChildren(...rows);
  if (refocus) g.cellEls.get(posKey(g.sel))?.focus();
}

function applyTable(g: Grid, next: ChartTable): void {
  if (g.destroyed) return;
  g.current = next;
  renderGrid(g);
  g.options.onChange(next);
}

/** Moves the selection to `pos` (clamped to the grid), rendering its row when it is outside the window. */
function selectCell(g: Grid, pos: Pos, focus: boolean): void {
  const to: Pos = { row: Math.max(0, Math.min(g.nRows - 1, pos.row)), col: Math.max(0, Math.min(g.nCols - 1, pos.col)) };
  const before = g.cellEls.get(posKey(g.sel));
  if (before !== undefined) {
    before.setAttribute("aria-selected", "false");
    before.tabIndex = -1;
  }
  g.sel = to;
  if (to.row < g.rendered.from || to.row >= g.rendered.to) {
    g.windowStart = to.row;
    g.scroller.scrollTop = to.row * ROW_HEIGHT;
    renderGrid(g);
  }
  const cell = g.cellEls.get(posKey(g.sel));
  if (cell === undefined) return;
  cell.setAttribute("aria-selected", "true");
  cell.tabIndex = 0;
  if (focus) cell.focus();
}

function beginEdit(g: Grid, text: string | null): void {
  if (g.readOnly || g.editing !== null) return;
  const cell = g.cellEls.get(posKey(g.sel));
  if (cell === undefined) return;
  const input = document.createElement("input");
  input.type = "text";
  input.className = "qmd-chart-grid-input";
  input.setAttribute("aria-label", `Cell ${columnLetter(g.sel.col)}${g.sel.row + 1}`);
  input.value = text ?? showCell(valueAt(g.current, g.sel));
  g.editing = { ...g.sel, input };
  input.addEventListener("blur", () => {
    if (g.editing?.input === input) commitEdit(g, { row: 0, col: 0 });
  });
  cell.replaceChildren(input);
  input.focus();
  if (text === null) input.select();
}

/** Writes the edit when it changed the cell, then moves the selection by `move`. */
function commitEdit(g: Grid, move: Pos): void {
  const at = g.editing;
  if (at === null) return;
  g.editing = null;
  const value = at.row === 0 ? (at.input.value === "" ? null : at.input.value) : readCell(at.input.value);
  if (value === valueAt(g.current, at)) {
    const cell = g.cellEls.get(posKey(at));
    if (cell !== undefined) {
      cell.textContent = showCell(value);
      cell.focus();
    }
  } else {
    const next = cloneTable(g.current);
    writeCell(next, at, value);
    applyTable(g, next);
  }
  if (move.row !== 0 || move.col !== 0) selectCell(g, { row: at.row + move.row, col: at.col + move.col }, true);
}

function cancelEdit(g: Grid): void {
  const at = g.editing;
  if (at === null) return;
  g.editing = null;
  const cell = g.cellEls.get(posKey(at));
  if (cell === undefined) return;
  cell.textContent = showCell(valueAt(g.current, at));
  cell.focus();
}

function clearCell(g: Grid): void {
  if (g.readOnly || valueAt(g.current, g.sel) === null) return;
  const next = cloneTable(g.current);
  writeCell(next, g.sel, null);
  applyTable(g, next);
}

function editTable(g: Grid, name: string): void {
  if (g.readOnly) return;
  if (g.editing !== null) commitEdit(g, { row: 0, col: 0 });
  const next = cloneTable(g.current);
  if (EDITS[name]!(next, g.sel)) applyTable(g, next);
}

async function importFile(g: Grid, pickFile: () => Promise<{ name: string; text: string } | null>): Promise<void> {
  const file = await pickFile();
  if (file === null || g.destroyed) return;
  const parsed = parseCsv(file.text);
  if (!isEmptyTable(g.current)) {
    const yes = await askDialog("Replace the data?", `The table is replaced by the data of ${file.name}.`, "Replace", true);
    if (!yes || g.destroyed) return;
  }
  g.errors.replaceChildren(...parsed.errors.map((e) => renderElement("li", { text: `Row ${e.row}: ${e.message}` })));
  g.errors.hidden = parsed.errors.length === 0;
  g.editing = null;
  g.sel = { row: 1, col: 0 };
  g.windowStart = 0;
  g.scroller.scrollTop = 0;
  applyTable(g, parsed.table);
}

function onEditorKey(g: Grid, event: KeyboardEvent): void {
  if (event.key === "Escape") cancelEdit(g);
  else if (event.key === "Enter") commitEdit(g, { row: event.shiftKey ? -1 : 1, col: 0 });
  else if (event.key === "Tab") commitEdit(g, { row: 0, col: event.shiftKey ? -1 : 1 });
  else return;
  event.preventDefault();
  event.stopPropagation();
}

function onCellKey(g: Grid, event: KeyboardEvent): void {
  const move = MOVES[event.key];
  if (move !== undefined) selectCell(g, { row: g.sel.row + move.row, col: g.sel.col + move.col }, true);
  else if (event.key === "Tab") {
    const col = g.sel.col + (event.shiftKey ? -1 : 1);
    if (col < 0 || col >= g.nCols) return;
    selectCell(g, { row: g.sel.row, col }, true);
  } else if (event.key === "Enter" || event.key === "F2") beginEdit(g, null);
  else if (event.key === "Delete" || event.key === "Backspace") clearCell(g);
  else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) beginEdit(g, event.key);
  else return;
  event.preventDefault();
  event.stopPropagation();
}

function cellPos(g: Grid, target: EventTarget | null): Pos | null {
  const cell = target instanceof Element ? target.closest<HTMLElement>('[role="gridcell"]') : null;
  if (cell === null || !g.grid.contains(cell)) return null;
  return { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
}

function onPaste(g: Grid, event: Event): void {
  if (g.readOnly || (g.editing !== null && event.target === g.editing.input)) return;
  const text = (event as ClipboardEvent).clipboardData?.getData("text/plain") ?? "";
  if (text === "") return;
  event.preventDefault();
  const next = cloneTable(g.current);
  pastedRows(text).forEach((cells, r) => cells.forEach((value, c) => writeCell(next, { row: g.sel.row + r, col: g.sel.col + c }, value)));
  applyTable(g, next);
}

function onScroll(g: Grid): void {
  if (g.nRows <= WINDOW_FROM) return;
  const top = Math.floor(g.scroller.scrollTop / ROW_HEIGHT);
  if (top - OVERSCAN / 2 >= g.rendered.from && top + OVERSCAN / 2 < g.rendered.to - Math.ceil(g.scroller.clientHeight / ROW_HEIGHT)) return;
  g.windowStart = top;
  if (g.editing === null) renderGrid(g);
}

function bindEvents(g: Grid): void {
  g.grid.addEventListener("keydown", (event) => {
    if (g.editing !== null && event.target === g.editing.input) onEditorKey(g, event);
    else if (cellPos(g, event.target) !== null) onCellKey(g, event);
  });
  g.grid.addEventListener("click", (event) => {
    const pos = cellPos(g, event.target);
    if (pos !== null && g.editing === null) selectCell(g, pos, false);
  });
  g.grid.addEventListener("dblclick", (event) => {
    const pos = cellPos(g, event.target);
    if (pos === null || g.editing !== null) return;
    selectCell(g, pos, false);
    beginEdit(g, null);
  });
  g.grid.addEventListener("focusin", (event) => {
    const pos = cellPos(g, event.target);
    if (pos !== null && g.editing === null && (pos.row !== g.sel.row || pos.col !== g.sel.col)) selectCell(g, pos, false);
  });
  g.grid.addEventListener("paste", (event) => onPaste(g, event));
  g.scroller.addEventListener("scroll", () => onScroll(g));
}

/** Mounts the data grid in `root`; every edit reports a new table to `onChange`, and `update` hands the host's table back. */
export function mountDataGrid(root: HTMLElement, table: ChartTable, options: GridOptions): { update(table: ChartTable): void; refresh(): void; selectRow(row: number): void; addRow(): void; destroy(): void } {
  const g = createGrid(options, table);
  if (options.tools !== false) g.container.prepend(buildTools(g));
  root.append(g.container);
  bindEvents(g);
  renderGrid(g);
  return {
    update(next) {
      if (g.destroyed || next === g.current) return;
      g.editing = null;
      g.current = next;
      renderGrid(g);
    },
    refresh() { if (!g.destroyed) renderGrid(g); },
    selectRow(row) { if (!g.destroyed) selectCell(g, { row: row + 1, col: Math.max(0, g.sel.col) }, false); },
    addRow() { selectCell(g, { row: heightOf(g.current), col: 0 }, false); editTable(g, "Add row"); },
    destroy() {
      if (g.destroyed) return;
      g.destroyed = true;
      g.editing = null;
      g.container.remove();
    },
  };
}
