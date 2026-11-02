// The chart data grid (plan charts, D9): a role=grid spreadsheet of the chart table with lettered columns and numbered rows,
// keyboard cell editing, add and delete of rows and columns, paste of TSV/CSV at the selected cell and import of a CSV file.
// Grid row 1 holds the column names; grid row r + 2 holds data row r. Rows beyond WINDOW_FROM are windowed.
import { askDialog, renderElement } from "../../../ui/dom/index.js";
import { parseCsv } from "../../chart/csv.js";
import { columnLetter, type ChartTable } from "../../chart/index.js";

type Cell = number | string | null;
interface Pos { row: number; col: number }

const MIN_COLS = 15;
const MIN_ROWS = 30;
const WINDOW_FROM = 500;
const ROW_HEIGHT = 24;
const OVERSCAN = 20;
const FALLBACK_VIEW = 600;
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)([eE][+-]?\d+)?$/;
const MOVES: Readonly<Record<string, Pos>> = {
  ArrowUp: { row: -1, col: 0 },
  ArrowDown: { row: 1, col: 0 },
  ArrowLeft: { row: 0, col: -1 },
  ArrowRight: { row: 0, col: 1 },
};
const HINT = "Paste CSV or TSV into the grid";

/** A typed cell value: empty text is null, a number reads as a number, anything else stays text. */
function readCell(text: string): Cell {
  const t = text.trim();
  if (t === "") return null;
  return NUMBER.test(t) ? Number(t) : text;
}

function showCell(value: Cell): string {
  return value === null ? "" : String(value);
}

function heightOf(table: ChartTable): number {
  return table.cols.reduce((m, c) => Math.max(m, c.values.length), 0);
}

function isEmptyTable(table: ChartTable): boolean {
  return table.cols.every((c) => c.name.trim() === "" && c.values.every((v) => v === null));
}

/** A mutable copy with every column padded to the same height. */
function cloneTable(table: ChartTable): ChartTable {
  const height = heightOf(table);
  return { cols: table.cols.map((c) => ({ name: c.name, values: Array.from({ length: height }, (_, r) => c.values[r] ?? null) })) };
}

/** The value a grid cell shows: row 0 is the column name, row r is data row r - 1. */
function valueAt(table: ChartTable, pos: Pos): Cell {
  const col = table.cols[pos.col];
  if (col === undefined) return null;
  if (pos.row === 0) return col.name === "" ? null : col.name;
  return col.values[pos.row - 1] ?? null;
}

/** Writes one grid cell into a mutable table, growing it with blank columns and rows to reach the cell. */
function writeCell(table: ChartTable, pos: Pos, value: Cell): void {
  while (table.cols.length <= pos.col) table.cols.push({ name: columnLetter(table.cols.length), values: [] });
  const height = Math.max(heightOf(table), pos.row);
  for (const c of table.cols) while (c.values.length < height) c.values.push(null);
  const col = table.cols[pos.col]!;
  if (pos.row === 0) col.name = value === null ? "" : String(value);
  else col.values[pos.row - 1] = value;
}

/** The rows of pasted text as cells; a header row parseCsv recognised comes back as the first row. */
function pastedRows(text: string): Cell[][] {
  const { table, header } = parseCsv(text);
  const rows: Cell[][] = header ? [table.cols.map((c) => c.name)] : [];
  const height = heightOf(table);
  for (let r = 0; r < height; r += 1) rows.push(table.cols.map((c) => c.values[r] ?? null));
  return rows;
}

const posKey = (pos: Pos): string => `${pos.row}:${pos.col}`;

/** The structural edits of the toolbar on a mutable table at the selected cell; false when nothing changes. */
const EDITS: Readonly<Record<string, (table: ChartTable, sel: Pos) => boolean>> = {
  "Add row": (table, sel) => {
    if (table.cols.length === 0) return false;
    const at = Math.min(sel.row, heightOf(table));
    for (const c of table.cols) c.values.splice(at, 0, null);
    return true;
  },
  "Delete row": (table, sel) => {
    const at = sel.row - 1;
    if (at < 0 || at >= heightOf(table)) return false;
    for (const c of table.cols) c.values.splice(at, 1);
    return true;
  },
  "Add column": (table, sel) => {
    const at = Math.min(sel.col + 1, table.cols.length);
    table.cols.splice(at, 0, { name: columnLetter(at), values: Array.from({ length: heightOf(table) }, () => null) });
    return true;
  },
  "Delete column": (table, sel) => {
    if (sel.col >= table.cols.length) return false;
    table.cols.splice(sel.col, 1);
    return true;
  },
};

const BUTTON_TEXT: Readonly<Record<string, string>> = { "Add row": "+ Row", "Delete row": "− Row", "Add column": "+ Column", "Delete column": "− Column" };

/** Mounts the data grid in `root`; every edit reports a new table to `onChange`, and `update` hands the host's table back. */
export function mountDataGrid(root: HTMLElement, table: ChartTable, options: { onChange(table: ChartTable): void; pickFile?: () => Promise<{ name: string; text: string } | null>; readOnly?: boolean }): { update(table: ChartTable): void; destroy(): void } {
  const readOnly = options.readOnly === true;
  let current = table;
  let sel: Pos = { row: 1, col: 0 };
  let editing: (Pos & { input: HTMLInputElement }) | null = null;
  let destroyed = false;
  let nRows = 0;
  let nCols = 0;
  let windowStart = 0;
  let rendered = { from: 0, to: 0 };
  const cellEls = new Map<string, HTMLElement>();

  const tools = renderElement("div", { class: "qmd-chart-grid-tools" });
  const buttons: HTMLButtonElement[] = [];
  for (const name of Object.keys(EDITS)) {
    const button = renderElement("button", { class: "ls-btn qmd-chart-grid-tool", type: "button", "aria-label": name, title: name, text: BUTTON_TEXT[name]! });
    button.disabled = readOnly;
    button.addEventListener("click", () => edit(name));
    buttons.push(button);
  }
  tools.append(...buttons);
  if (options.pickFile !== undefined) {
    const pickFile = options.pickFile;
    const importButton = renderElement("button", { class: "ls-btn qmd-chart-grid-tool", type: "button", "aria-label": "Import data from CSV file", text: "Import data from CSV file" });
    importButton.disabled = readOnly;
    importButton.addEventListener("click", () => void importFile(pickFile));
    tools.append(importButton);
  }
  tools.append(renderElement("span", { class: "qmd-chart-grid-hint", text: options.pickFile === undefined ? HINT : `${HINT}, or import a CSV file.` }));

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
  const container = renderElement("div", { class: "qmd-chart-grid" }, tools, scroller, note, errors);
  root.append(container);

  function renderHead(): void {
    const row = renderElement("tr", { role: "row" }, renderElement("th", { class: "qmd-chart-grid-corner" }));
    for (let c = 0; c < nCols; c += 1) row.append(renderElement("th", { class: "qmd-chart-grid-colhead", role: "columnheader", scope: "col", text: columnLetter(c) }));
    head.replaceChildren(row);
  }

  function renderCell(pos: Pos): HTMLElement {
    const cell = document.createElement("td");
    cell.className = pos.row === 0 ? "qmd-chart-grid-cell qmd-chart-grid-name" : "qmd-chart-grid-cell";
    cell.setAttribute("role", "gridcell");
    cell.dataset.row = String(pos.row);
    cell.dataset.col = String(pos.col);
    const on = pos.row === sel.row && pos.col === sel.col;
    cell.setAttribute("aria-selected", String(on));
    cell.tabIndex = on ? 0 : -1;
    cell.textContent = showCell(valueAt(current, pos));
    cellEls.set(posKey(pos), cell);
    return cell;
  }

  function spacer(rows: number): HTMLElement {
    const tr = renderElement("tr", { class: "qmd-chart-grid-spacer", role: "presentation" });
    tr.style.height = `${rows * ROW_HEIGHT}px`;
    return tr;
  }

  /** Redraws the header and the visible rows; focus returns to the selected cell when it was inside the grid. */
  function render(): void {
    const refocus = grid.contains(document.activeElement);
    nCols = Math.max(MIN_COLS, current.cols.length + 1);
    nRows = Math.max(MIN_ROWS, heightOf(current) + 2);
    grid.setAttribute("aria-colcount", String(nCols + 1));
    grid.setAttribute("aria-rowcount", String(nRows + 1));
    renderHead();
    let from = 0;
    let to = nRows;
    if (nRows > WINDOW_FROM) {
      const view = Math.ceil((scroller.clientHeight || FALLBACK_VIEW) / ROW_HEIGHT);
      from = Math.max(0, Math.min(windowStart, nRows - view) - OVERSCAN);
      to = Math.min(nRows, from + view + 2 * OVERSCAN);
    }
    rendered = { from, to };
    cellEls.clear();
    const rows: HTMLElement[] = [];
    if (from > 0) rows.push(spacer(from));
    for (let r = from; r < to; r += 1) {
      const tr = renderElement("tr", { role: "row", "aria-rowindex": String(r + 2) }, renderElement("th", { class: "qmd-chart-grid-rowhead", role: "rowheader", scope: "row", text: String(r + 1) }));
      for (let c = 0; c < nCols; c += 1) tr.append(renderCell({ row: r, col: c }));
      rows.push(tr);
    }
    if (to < nRows) rows.push(spacer(nRows - to));
    body.replaceChildren(...rows);
    if (refocus) cellEls.get(posKey(sel))?.focus();
  }

  function apply(next: ChartTable): void {
    if (destroyed) return;
    current = next;
    render();
    options.onChange(next);
  }

  /** Moves the selection to `pos` (clamped to the grid), rendering its row when it is outside the window. */
  function select(pos: Pos, focus: boolean): void {
    const to: Pos = { row: Math.max(0, Math.min(nRows - 1, pos.row)), col: Math.max(0, Math.min(nCols - 1, pos.col)) };
    const before = cellEls.get(posKey(sel));
    if (before !== undefined) {
      before.setAttribute("aria-selected", "false");
      before.tabIndex = -1;
    }
    sel = to;
    if (to.row < rendered.from || to.row >= rendered.to) {
      windowStart = to.row;
      scroller.scrollTop = to.row * ROW_HEIGHT;
      render();
    }
    const cell = cellEls.get(posKey(sel));
    if (cell === undefined) return;
    cell.setAttribute("aria-selected", "true");
    cell.tabIndex = 0;
    if (focus) cell.focus();
  }

  function beginEdit(text: string | null): void {
    if (readOnly || editing !== null) return;
    const cell = cellEls.get(posKey(sel));
    if (cell === undefined) return;
    const input = document.createElement("input");
    input.type = "text";
    input.className = "qmd-chart-grid-input";
    input.setAttribute("aria-label", `Cell ${columnLetter(sel.col)}${sel.row + 1}`);
    input.value = text ?? showCell(valueAt(current, sel));
    editing = { ...sel, input };
    input.addEventListener("blur", () => {
      if (editing?.input === input) commit({ row: 0, col: 0 });
    });
    cell.replaceChildren(input);
    input.focus();
    if (text === null) input.select();
  }

  /** Writes the edit when it changed the cell, then moves the selection by `move`. */
  function commit(move: Pos): void {
    const at = editing;
    if (at === null) return;
    editing = null;
    const value = at.row === 0 ? (at.input.value === "" ? null : at.input.value) : readCell(at.input.value);
    if (value === valueAt(current, at)) {
      const cell = cellEls.get(posKey(at));
      if (cell !== undefined) {
        cell.textContent = showCell(value);
        cell.focus();
      }
    } else {
      const next = cloneTable(current);
      writeCell(next, at, value);
      apply(next);
    }
    if (move.row !== 0 || move.col !== 0) select({ row: at.row + move.row, col: at.col + move.col }, true);
  }

  function cancel(): void {
    const at = editing;
    if (at === null) return;
    editing = null;
    const cell = cellEls.get(posKey(at));
    if (cell === undefined) return;
    cell.textContent = showCell(valueAt(current, at));
    cell.focus();
  }

  function clearCell(): void {
    if (readOnly || valueAt(current, sel) === null) return;
    const next = cloneTable(current);
    writeCell(next, sel, null);
    apply(next);
  }

  function edit(name: string): void {
    if (readOnly) return;
    if (editing !== null) commit({ row: 0, col: 0 });
    const next = cloneTable(current);
    if (EDITS[name]!(next, sel)) apply(next);
  }

  async function importFile(pickFile: () => Promise<{ name: string; text: string } | null>): Promise<void> {
    const file = await pickFile();
    if (file === null || destroyed) return;
    const parsed = parseCsv(file.text);
    if (!isEmptyTable(current)) {
      const yes = await askDialog("Replace the data?", `The table is replaced by the data of ${file.name}.`, "Replace", true);
      if (!yes || destroyed) return;
    }
    errors.replaceChildren(...parsed.errors.map((e) => renderElement("li", { text: `Row ${e.row}: ${e.message}` })));
    errors.hidden = parsed.errors.length === 0;
    editing = null;
    sel = { row: 1, col: 0 };
    windowStart = 0;
    scroller.scrollTop = 0;
    apply(parsed.table);
  }

  function onEditorKey(event: KeyboardEvent): void {
    if (event.key === "Escape") cancel();
    else if (event.key === "Enter") commit({ row: event.shiftKey ? -1 : 1, col: 0 });
    else if (event.key === "Tab") commit({ row: 0, col: event.shiftKey ? -1 : 1 });
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  function onCellKey(event: KeyboardEvent): void {
    const move = MOVES[event.key];
    if (move !== undefined) select({ row: sel.row + move.row, col: sel.col + move.col }, true);
    else if (event.key === "Tab") {
      const col = sel.col + (event.shiftKey ? -1 : 1);
      if (col < 0 || col >= nCols) return;
      select({ row: sel.row, col }, true);
    } else if (event.key === "Enter" || event.key === "F2") beginEdit(null);
    else if (event.key === "Delete" || event.key === "Backspace") clearCell();
    else if (event.key.length === 1 && !event.ctrlKey && !event.metaKey && !event.altKey) beginEdit(event.key);
    else return;
    event.preventDefault();
    event.stopPropagation();
  }

  const cellPos = (target: EventTarget | null): Pos | null => {
    const cell = target instanceof Element ? target.closest<HTMLElement>('[role="gridcell"]') : null;
    if (cell === null || !grid.contains(cell)) return null;
    return { row: Number(cell.dataset.row), col: Number(cell.dataset.col) };
  };

  grid.addEventListener("keydown", (event) => {
    if (editing !== null && event.target === editing.input) onEditorKey(event);
    else if (cellPos(event.target) !== null) onCellKey(event);
  });
  grid.addEventListener("click", (event) => {
    const pos = cellPos(event.target);
    if (pos !== null && editing === null) select(pos, false);
  });
  grid.addEventListener("dblclick", (event) => {
    const pos = cellPos(event.target);
    if (pos === null || editing !== null) return;
    select(pos, false);
    beginEdit(null);
  });
  grid.addEventListener("focusin", (event) => {
    const pos = cellPos(event.target);
    if (pos !== null && editing === null && (pos.row !== sel.row || pos.col !== sel.col)) select(pos, false);
  });
  grid.addEventListener("paste", (event) => {
    if (readOnly || (editing !== null && event.target === editing.input)) return;
    const text = (event as ClipboardEvent).clipboardData?.getData("text/plain") ?? "";
    if (text === "") return;
    event.preventDefault();
    const next = cloneTable(current);
    pastedRows(text).forEach((cells, r) => cells.forEach((value, c) => writeCell(next, { row: sel.row + r, col: sel.col + c }, value)));
    apply(next);
  });
  scroller.addEventListener("scroll", () => {
    if (nRows <= WINDOW_FROM) return;
    const top = Math.floor(scroller.scrollTop / ROW_HEIGHT);
    if (top - OVERSCAN / 2 >= rendered.from && top + OVERSCAN / 2 < rendered.to - Math.ceil(scroller.clientHeight / ROW_HEIGHT)) return;
    windowStart = top;
    if (editing === null) render();
  });

  render();

  return {
    update(next) {
      if (destroyed || next === current) return;
      editing = null;
      current = next;
      render();
    },
    destroy() {
      if (destroyed) return;
      destroyed = true;
      editing = null;
      container.remove();
    },
  };
}
