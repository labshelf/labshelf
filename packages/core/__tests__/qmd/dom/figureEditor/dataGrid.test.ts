/** @jest-environment jsdom */
/**
 * Tests the data grid (plan charts, spec 3.2, D9): a role=grid table with lettered columns and numbered rows, keyboard cell editing,
 * paste of TSV/CSV at the selected cell, add and delete of rows and columns, and "Import data from CSV file" through a fake pickFile
 * with the real confirmation dialog (driven through the DOM, never mocked).
 *
 * ASSUMPTIONS (the spec names no markup beyond role=grid): cells are role=gridcell, column letters role=columnheader, row numbers
 * role=rowheader, a cell is selected by click or focus, the editor is an <input>/<textarea> inside the grid, and the row and column
 * buttons and the import button are found by accessible name (/add row/, /delete row/, /add column/, /delete column/, /import data from csv file/).
 * Cells are found by their text, so the tests do not depend on whether the column names occupy a grid row.
 * "Esc cancels an edit without closing the editor" is tested at the grid: an Escape keydown in the cell editor cancels the edit and
 * the event is stopped, so a bubbling keydown listener on document never sees it (overlay capture-phase listeners are out of scope).
 */
import type { ChartTable } from "../../../../src/qmd/chart/model";
import { mountDataGrid } from "../../../../src/qmd/dom/figureEditor/dataGrid";
import { controls, press } from "./chartEditorHarness";

type Pick = () => Promise<{ name: string; text: string } | null>;

const TABLE: ChartTable = {
  cols: [
    { name: "t", values: [101, 102, 103] },
    { name: "v", values: [210, 220, 230] },
    { name: "w", values: [305, 306, 307] },
  ],
};

const ADD_ROW = /(add|insert|new|\+).*row|row.*(add|insert|new|\+)/i;
const DELETE_ROW = /(delete|remove).*row|row.*(delete|remove)/i;
const ADD_COL = /(add|insert|new|\+).*col|col.*(add|insert|new|\+)/i;
const DELETE_COL = /(delete|remove).*col|col.*(delete|remove)/i;
const IMPORT = /import data from csv file/i;

interface Mounted { root: HTMLElement; grid: ReturnType<typeof mountDataGrid>; changes: ChartTable[]; latest(): ChartTable }

let mounted: Mounted[] = [];

/** Mounts a grid; like a host, every reported table is handed back through update(). */
function mount(table: ChartTable, options: { pickFile?: Pick; readOnly?: boolean } = {}): Mounted {
  const root = document.createElement("div");
  document.body.append(root);
  const changes: ChartTable[] = [];
  const holder: { grid?: ReturnType<typeof mountDataGrid> } = {};
  holder.grid = mountDataGrid(root, table, {
    ...options,
    onChange: (next) => { changes.push(next); holder.grid?.update(next); },
  });
  const m: Mounted = { root, grid: holder.grid, changes, latest: () => changes[changes.length - 1]! };
  mounted.push(m);
  return m;
}

afterEach(() => {
  for (const m of mounted) { m.grid.destroy(); m.root.remove(); }
  mounted = [];
  document.body.innerHTML = "";
});

const text = (el: Element): string => (el.textContent ?? "").trim();

async function waitFor(check: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!check()) {
    if (Date.now() > end) throw new Error("condition not met in time");
    await new Promise<void>((r) => setTimeout(r, 5));
  }
}

const tick = (): Promise<void> => new Promise<void>((r) => setTimeout(r, 20));

function gridOf(m: Mounted): HTMLElement {
  const grid = m.root.querySelector<HTMLElement>('[role="grid"]');
  if (grid === null) throw new Error("no role=grid in the mounted root");
  return grid;
}

function cells(m: Mounted): HTMLElement[] {
  return [...gridOf(m).querySelectorAll<HTMLElement>('[role="gridcell"]')];
}

/** The one grid cell showing exactly `value`; the tests use values that appear once. */
function cellOf(m: Mounted, value: string): HTMLElement {
  const hits = cells(m).filter((c) => text(c) === value);
  if (hits.length !== 1) throw new Error(`expected one cell showing "${value}", found ${hits.length}`);
  return hits[0]!;
}

function select(m: Mounted, value: string): HTMLElement {
  const cell = cellOf(m, value);
  cell.click();
  cell.focus();
  return cell;
}

/** True when the cell is the selected one: it holds focus or says so with aria-selected. */
function isCurrent(cell: HTMLElement): boolean {
  const active = document.activeElement;
  return cell === active || cell.contains(active) || cell.getAttribute("aria-selected") === "true";
}

function editorOf(m: Mounted): HTMLInputElement | HTMLTextAreaElement | null {
  return gridOf(m).querySelector<HTMLInputElement | HTMLTextAreaElement>("input, textarea");
}

/** Enter on the cell, replaces the value, Enter in the editor. */
function typeInto(m: Mounted, from: string, value: string): void {
  select(m, from);
  press(cellOf(m, from), "Enter");
  const input = editorOf(m);
  if (input === null) throw new Error("Enter on a cell opened no editor");
  input.value = value;
  input.dispatchEvent(new Event("input", { bubbles: true }));
  press(input, "Enter");
}

function paste(target: HTMLElement, data: string): void {
  const event = new Event("paste", { bubbles: true, cancelable: true });
  Object.defineProperty(event, "clipboardData", { value: { getData: (type: string) => (type === "text" || type === "text/plain" ? data : "") } });
  target.dispatchEvent(event);
}

/** The cells of the row whose row header reads `n`. */
function rowCells(m: Mounted, n: string): HTMLElement[] {
  const header = [...gridOf(m).querySelectorAll<HTMLElement>('[role="rowheader"]')].find((h) => text(h) === n);
  if (header === undefined) throw new Error(`no row header "${n}"`);
  const row = header.closest<HTMLElement>('[role="row"]');
  if (row === null) throw new Error("row header outside a role=row");
  return [...row.querySelectorAll<HTMLElement>('[role="gridcell"]')];
}

function button(m: Mounted | HTMLElement, name: RegExp): HTMLElement {
  const scope = m instanceof HTMLElement ? m : m.root;
  const hit = controls(scope, name)[0];
  if (hit === undefined) throw new Error(`no control named ${String(name)}`);
  return hit;
}

function dialogButtons(): HTMLButtonElement[] {
  return [...document.querySelectorAll<HTMLButtonElement>('[role="alertdialog"] button')];
}

async function answerDialog(accept: boolean): Promise<void> {
  await waitFor(() => dialogButtons().length > 0);
  const buttons = dialogButtons();
  const chosen = accept ? buttons.find((b) => !/^cancel$/i.test(text(b))) : buttons.find((b) => /^cancel$/i.test(text(b)));
  if (chosen === undefined) throw new Error("dialog has no such button");
  chosen.click();
  await tick();
}

describe("the data grid", () => {
  it("3.2a renders a role=grid with at least 15 lettered columns and 30 numbered rows, even for an empty table", () => {
    const m = mount({ cols: [] });
    const letters = [...gridOf(m).querySelectorAll('[role="columnheader"]')].map(text).filter((t) => t !== "");
    expect(letters.slice(0, 15)).toEqual("ABCDEFGHIJKLMNO".split(""));
    const numbers = [...gridOf(m).querySelectorAll('[role="rowheader"]')].map(text);
    expect(numbers.slice(0, 30)).toEqual(Array.from({ length: 30 }, (_, i) => String(i + 1)));
  });

  it("3.2a shows the table values in its cells", () => {
    const m = mount(TABLE);
    for (const v of ["101", "103", "210", "230", "305", "307"]) expect(cellOf(m, v)).toBeTruthy();
  });

  it("3.2a windows a table of 2000 rows: not every row is rendered", () => {
    const values = Array.from({ length: 2000 }, (_, i) => 100000 + i);
    const m = mount({ cols: [{ name: "n", values }] });
    const rows = gridOf(m).querySelectorAll('[role="row"]').length;
    expect(rows).toBeGreaterThan(0);
    expect(rows).toBeLessThan(2000);
  });

  it("3.2a Enter on a cell opens an editor, typing and Enter write the number into the table", () => {
    const m = mount(TABLE);
    typeInto(m, "220", "250");
    expect(m.latest().cols[1]!.values).toEqual([210, 250, 230]);
    expect(m.latest().cols[0]!.values).toEqual([101, 102, 103]);
    expect(m.latest().cols[2]!.values).toEqual([305, 306, 307]);
  });

  it("3.2a text typed into a cell is stored as text", () => {
    const m = mount(TABLE);
    typeInto(m, "220", "hello");
    expect(m.latest().cols[1]!.values).toEqual([210, "hello", 230]);
  });

  it("3.2a committing an empty value stores null", () => {
    const m = mount(TABLE);
    typeInto(m, "220", "");
    expect(m.latest().cols[1]!.values).toEqual([210, null, 230]);
  });

  it("3.2a typing a printable key on a selected cell starts an edit", () => {
    const m = mount(TABLE);
    select(m, "220");
    press(cellOf(m, "220"), "7");
    expect(editorOf(m)).not.toBeNull();
  });

  it("3.2a the edit is not written until it is committed", () => {
    const m = mount(TABLE);
    select(m, "220");
    press(cellOf(m, "220"), "Enter");
    const input = editorOf(m)!;
    input.value = "999";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    expect(m.changes).toHaveLength(0);
  });

  it("3.2a Esc cancels an edit: the table keeps its value and nothing is reported", () => {
    const m = mount(TABLE);
    select(m, "220");
    press(cellOf(m, "220"), "Enter");
    const input = editorOf(m)!;
    input.value = "999";
    input.dispatchEvent(new Event("input", { bubbles: true }));
    press(input, "Escape");
    expect(m.changes).toHaveLength(0);
    expect(editorOf(m)).toBeNull();
    expect(cellOf(m, "220")).toBeTruthy();
    expect(cells(m).some((c) => text(c) === "999")).toBe(false);
  });

  it("3.2a an Escape keydown in the cell editor does not bubble up to document, so it cannot close the editor", () => {
    const m = mount(TABLE);
    select(m, "220");
    press(cellOf(m, "220"), "Enter");
    const input = editorOf(m)!;
    const seen = jest.fn();
    document.addEventListener("keydown", seen);
    try {
      press(input, "Escape");
    } finally {
      document.removeEventListener("keydown", seen);
    }
    expect(seen).not.toHaveBeenCalled();
    expect(editorOf(m)).toBeNull();
  });

  it("3.2a Delete clears the selected cell", () => {
    const m = mount(TABLE);
    select(m, "220");
    press(cellOf(m, "220"), "Delete");
    expect(m.latest().cols[1]!.values).toEqual([210, null, 230]);
  });

  it("3.2a arrow keys move the selection one cell", () => {
    const m = mount(TABLE);
    select(m, "220");
    press(cellOf(m, "220"), "ArrowRight");
    expect(isCurrent(cellOf(m, "306"))).toBe(true);
    press(cellOf(m, "306"), "ArrowLeft");
    expect(isCurrent(cellOf(m, "220"))).toBe(true);
    press(cellOf(m, "220"), "ArrowLeft");
    expect(isCurrent(cellOf(m, "102"))).toBe(true);
    press(cellOf(m, "102"), "ArrowRight");
    press(cellOf(m, "220"), "ArrowDown");
    expect(isCurrent(cellOf(m, "230"))).toBe(true);
    press(cellOf(m, "230"), "ArrowUp");
    expect(isCurrent(cellOf(m, "220"))).toBe(true);
  });

  it("3.2a moving the selection does not change the table", () => {
    const m = mount(TABLE);
    select(m, "220");
    press(cellOf(m, "220"), "ArrowRight");
    press(cellOf(m, "306"), "ArrowDown");
    expect(m.changes).toHaveLength(0);
  });

  it("3.2a Tab moves the selection one cell to the right", () => {
    const m = mount(TABLE);
    select(m, "102");
    const event = press(cellOf(m, "102"), "Tab");
    expect(isCurrent(cellOf(m, "220"))).toBe(true);
    expect(event.defaultPrevented).toBe(true);
  });

  it("3.2a a readOnly grid opens no editor and ignores Delete and paste", () => {
    const m = mount(TABLE, { readOnly: true });
    select(m, "220");
    press(cellOf(m, "220"), "Enter");
    expect(editorOf(m)).toBeNull();
    press(cellOf(m, "220"), "Delete");
    paste(cellOf(m, "220"), "1\t2");
    expect(m.changes).toHaveLength(0);
  });
});

describe("rows, columns and paste", () => {
  it("3.2b pasting TSV at B2 fills the cells from B2 and leaves column A alone", () => {
    const m = mount(TABLE);
    const [a2, b2, c2] = rowCells(m, "2");
    const a2Before = text(a2!);
    select(m, text(b2!));
    paste(cellOf(m, text(b2!)), "11\t12\n21\t22");
    const [a2After, b2After, c2After] = rowCells(m, "2");
    const [, b3, c3] = rowCells(m, "3");
    expect([text(b2After!), text(c2After!)]).toEqual(["11", "12"]);
    expect([text(b3!), text(c3!)]).toEqual(["21", "22"]);
    expect(text(a2After!)).toBe(a2Before);
    expect(c2).toBeTruthy();
  });

  it("3.2b the pasted TSV reaches the reported table in columns B and C", () => {
    const m = mount(TABLE);
    const [, b2] = rowCells(m, "2");
    select(m, text(b2!));
    paste(cellOf(m, text(b2!)), "11\t12\n21\t22");
    const table = m.latest();
    const run = (values: (number | string | null)[], want: (number | string | null)[]): boolean =>
      values.some((_, i) => want.every((w, k) => values[i + k] === w));
    expect(run(table.cols[1]!.values, [11, 21])).toBe(true);
    expect(run(table.cols[2]!.values, [12, 22])).toBe(true);
    expect(table.cols[0]!.values).toEqual([101, 102, 103]);
  });

  it("3.2b pasting comma separated text fills the cells the same way", () => {
    const m = mount(TABLE);
    const [, b2] = rowCells(m, "2");
    select(m, text(b2!));
    paste(cellOf(m, text(b2!)), "11,12\n21,22");
    const [, b2After, c2After] = rowCells(m, "2");
    const [, b3, c3] = rowCells(m, "3");
    expect([text(b2After!), text(c2After!), text(b3!), text(c3!)]).toEqual(["11", "12", "21", "22"]);
  });

  it("3.2b adding a row inserts one blank row next to the selected one and keeps the other rows in order", () => {
    const m = mount(TABLE);
    select(m, "220");
    button(m, ADD_ROW).click();
    const table = m.latest();
    expect(table.cols).toHaveLength(3);
    const originals = [[101, 102, 103], [210, 220, 230], [305, 306, 307]];
    table.cols.forEach((col, c) => {
      expect(col.values).toHaveLength(4);
      expect(col.values.filter((v) => v !== null)).toEqual(originals[c]);
    });
    const blankAt = table.cols[0]!.values.indexOf(null);
    expect(blankAt).toBeGreaterThanOrEqual(1);
    expect(blankAt).toBeLessThanOrEqual(2);
    for (const col of table.cols) expect(col.values.indexOf(null)).toBe(blankAt);
  });

  it("3.2b deleting a row removes the selected cell's row from every column", () => {
    const m = mount(TABLE);
    select(m, "220");
    button(m, DELETE_ROW).click();
    expect(m.latest().cols.map((c) => c.values)).toEqual([[101, 103], [210, 230], [305, 307]]);
  });

  it("3.2b adding a column adds one empty column and keeps the others", () => {
    const m = mount(TABLE);
    select(m, "220");
    button(m, ADD_COL).click();
    const table = m.latest();
    expect(table.cols).toHaveLength(4);
    const blank = table.cols.filter((c) => c.values.every((v) => v === null));
    expect(blank).toHaveLength(1);
    const kept = table.cols.filter((c) => !c.values.every((v) => v === null));
    expect(kept.map((c) => c.values)).toEqual([[101, 102, 103], [210, 220, 230], [305, 306, 307]]);
    expect(kept.map((c) => c.name)).toEqual(["t", "v", "w"]);
  });

  it("3.2b deleting a column removes the selected cell's column", () => {
    const m = mount(TABLE);
    select(m, "220");
    button(m, DELETE_COL).click();
    const table = m.latest();
    expect(table.cols.map((c) => c.name)).toEqual(["t", "w"]);
    expect(table.cols.map((c) => c.values)).toEqual([[101, 102, 103], [305, 306, 307]]);
  });

  it("3.2b the grid shows the result of a deleted row", () => {
    const m = mount(TABLE);
    select(m, "220");
    button(m, DELETE_ROW).click();
    expect(cells(m).some((c) => text(c) === "220")).toBe(false);
    expect(cellOf(m, "230")).toBeTruthy();
  });

  it("3.2b update() redraws the grid from a new table", () => {
    const m = mount(TABLE);
    m.grid.update({ cols: [{ name: "z", values: [901, 902] }] });
    expect(cellOf(m, "901")).toBeTruthy();
    expect(cells(m).some((c) => text(c) === "220")).toBe(false);
  });
});

describe("import from a CSV file", () => {
  const FILE = { name: "d.csv", text: "x,y\n1,2\n3,4\n" };
  const IMPORTED: ChartTable = { cols: [{ name: "x", values: [1, 3] }, { name: "y", values: [2, 4] }] };

  it("3.2c without pickFile there is no import button and the hint says to paste", () => {
    const m = mount(TABLE);
    expect(controls(m.root, IMPORT)).toHaveLength(0);
    expect(m.root.textContent).toContain("Paste CSV or TSV into the grid");
  });

  it("3.2c with pickFile the import button is shown", () => {
    const m = mount(TABLE, { pickFile: async () => FILE });
    expect(controls(m.root, IMPORT)).toHaveLength(1);
  });

  it("3.2c importing into a non-empty table asks first and replaces the table once confirmed", async () => {
    const m = mount(TABLE, { pickFile: async () => FILE });
    button(m, IMPORT).click();
    await waitFor(() => dialogButtons().length > 0);
    expect(m.changes).toHaveLength(0);
    await answerDialog(true);
    await waitFor(() => m.changes.length > 0);
    expect(m.latest()).toEqual(IMPORTED);
    expect(cellOf(m, "4")).toBeTruthy();
  });

  it("3.2c declining the confirmation keeps the table", async () => {
    const m = mount(TABLE, { pickFile: async () => FILE });
    button(m, IMPORT).click();
    await answerDialog(false);
    await tick();
    expect(m.changes).toHaveLength(0);
    expect(cellOf(m, "220")).toBeTruthy();
  });

  it("3.2c importing into an empty table needs no confirmation", async () => {
    const m = mount({ cols: [] }, { pickFile: async () => FILE });
    button(m, IMPORT).click();
    await waitFor(() => m.changes.length > 0);
    expect(dialogButtons()).toHaveLength(0);
    expect(m.latest()).toEqual(IMPORTED);
  });

  it("3.2c cancelling the file picker changes nothing and asks nothing", async () => {
    const m = mount(TABLE, { pickFile: async () => null });
    button(m, IMPORT).click();
    await tick();
    await tick();
    expect(dialogButtons()).toHaveLength(0);
    expect(m.changes).toHaveLength(0);
  });

  it("3.2c parse errors of the imported text are listed under the grid", async () => {
    const m = mount({ cols: [] }, { pickFile: async () => ({ name: "bad.csv", text: 'a,b\n1,2\n3,"4\n' }) });
    button(m, IMPORT).click();
    await waitFor(() => /Row \d+:/.test(m.root.textContent ?? ""));
    expect(m.root.textContent).toMatch(/Row \d+: .*quote/i);
  });
});
