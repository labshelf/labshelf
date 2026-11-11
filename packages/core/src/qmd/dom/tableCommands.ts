// Holds the editing commands of pipe tables: moving between cells with Tab, Shift-Tab and Enter, adding rows past the last one, adding a row below or a column right of the caret's cell, guarding Backspace and inserting a new table.
import { Fragment, type Node as ProseNode, type ResolvedPos } from "prosemirror-model";
import { TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import { qmdSchema } from "../editor/index.js";
import { editRequestKey, insertBlock } from "./insertBlock.js";

const nodes = {
  paragraph: qmdSchema.nodes.paragraph!,
  table: qmdSchema.nodes.table!,
  row: qmdSchema.nodes.table_row!,
  header: qmdSchema.nodes.table_header!,
  cell: qmdSchema.nodes.table_cell!,
};

/** Where the caret's cell is: the table's depth and position, and the cell's row and column. */
interface CellAt { table: ProseNode; tablePos: number; row: number; column: number }

function cellAt($pos: ResolvedPos): CellAt | null {
  for (let depth = $pos.depth; depth > 2; depth--) {
    const type = $pos.node(depth).type;
    if (type !== nodes.cell && type !== nodes.header) { continue; }
    return { table: $pos.node(depth - 2), tablePos: $pos.before(depth - 2), row: $pos.index(depth - 2), column: $pos.index(depth - 1) };
  }
  return null;
}

/** The position inside the cell at `row`, `column` of the table at `tablePos`, at its end when `atEnd`. */
function cellPos(table: ProseNode, tablePos: number, row: number, column: number, atEnd = false): number {
  let pos = tablePos + 1;
  for (let r = 0; r < row; r++) { pos += table.child(r).nodeSize; }
  pos += 1;
  const cells = table.child(row);
  for (let c = 0; c < column; c++) { pos += cells.child(c).nodeSize; }
  return pos + 1 + (atEnd ? cells.child(column).content.size : 0);
}

/** An empty body row as wide as the table's header, each cell with its column's alignment. */
function emptyRow(table: ProseNode): ProseNode {
  const align = table.attrs.align as (string | null)[];
  const cells: ProseNode[] = [];
  table.child(0).forEach((_cell, _offset, column) => cells.push(nodes.cell.create({ align: align[column] ?? null })));
  return nodes.row.create(null, cells);
}

/** Appends an empty row to the table at `at.tablePos` and puts the caret in its cell of `column`. */
function addRowAndEnter(state: EditorState, at: CellAt, column: number): Transaction {
  const tr = state.tr.insert(at.tablePos + at.table.nodeSize - 1, emptyRow(at.table));
  const table = tr.doc.nodeAt(at.tablePos)!;
  return tr.setSelection(TextSelection.create(tr.doc, cellPos(table, at.tablePos, table.childCount - 1, column))).scrollIntoView();
}

function moveTo(state: EditorState, at: CellAt, row: number, column: number, atEnd = false): Transaction {
  return state.tr.setSelection(TextSelection.create(state.doc, cellPos(at.table, at.tablePos, row, column, atEnd))).scrollIntoView();
}

/** Tab: the next cell, adding a row after the last cell; Shift-Tab: the previous cell, staying in the first. */
export function goToCell(dir: 1 | -1): Command {
  return (state, dispatch) => {
    const at = cellAt(state.selection.$head);
    if (!at) { return false; }
    const columns = at.table.child(at.row).childCount;
    const index = at.row * columns + at.column + dir;
    if (!dispatch) { return true; }
    if (index < 0) { return true; }
    if (index >= at.table.childCount * columns) { dispatch(addRowAndEnter(state, at, 0)); return true; }
    dispatch(moveTo(state, at, Math.floor(index / columns), index % columns, dir < 0));
    return true;
  };
}

const rowIsEmpty = (row: ProseNode) => {
  let empty = true;
  row.forEach((cell) => { if (cell.content.size > 0) { empty = false; } });
  return empty;
};

/**
 * Enter: the cell below; in the last row it adds a row, unless that row is empty, which it removes to leave the table
 * for the paragraph after it.
 */
export const cellBelow: Command = (state, dispatch) => {
  const at = cellAt(state.selection.$head);
  if (!at) { return false; }
  if (!dispatch) { return true; }
  if (at.row + 1 < at.table.childCount) { dispatch(moveTo(state, at, at.row + 1, at.column)); return true; }
  const last = at.table.child(at.row);
  if (at.row === 0 || !rowIsEmpty(last)) { dispatch(addRowAndEnter(state, at, at.column)); return true; }
  const tableEnd = at.tablePos + at.table.nodeSize;
  const tr = state.tr.delete(tableEnd - 1 - last.nodeSize, tableEnd - 1);
  const after = tr.mapping.map(tableEnd);
  if (tr.doc.nodeAt(after)?.type !== nodes.paragraph) { tr.insert(after, nodes.paragraph.create()); }
  dispatch(tr.setSelection(TextSelection.create(tr.doc, after + 1)).scrollIntoView());
  return true;
};

/** Adds an empty body row under the caret's row (under the header when the caret is in it) and puts the caret in its cell of the same column. */
export const addRowBelow: Command = (state, dispatch) => {
  const at = cellAt(state.selection.$head);
  if (!at) { return false; }
  if (!dispatch) { return true; }
  let pos = at.tablePos + 1;
  for (let r = 0; r <= at.row; r++) { pos += at.table.child(r).nodeSize; }
  const tr = state.tr.insert(pos, emptyRow(at.table));
  dispatch(tr.setSelection(TextSelection.create(tr.doc, cellPos(tr.doc.nodeAt(at.tablePos)!, at.tablePos, at.row + 1, at.column))).scrollIntoView());
  return true;
};

/** Adds an empty column right of the caret's cell, a header cell in the header row and a body cell below, and puts the caret in its cell of the same row. */
export const addColumnRight: Command = (state, dispatch) => {
  const at = cellAt(state.selection.$head);
  if (!at) { return false; }
  if (!dispatch) { return true; }
  const column = at.column + 1;
  const rows: ProseNode[] = [];
  at.table.forEach((row, _offset, index) => {
    const cells: ProseNode[] = [];
    row.forEach((cell) => cells.push(cell));
    cells.splice(column, 0, (index === 0 ? nodes.header : nodes.cell).create());
    rows.push(row.copy(Fragment.from(cells)));
  });
  const stored = at.table.attrs.align as (string | null)[];
  const align = Array.from({ length: at.table.child(0).childCount }, (_, index) => stored[index] ?? null);
  align.splice(column, 0, null);
  const table = nodes.table.create({ ...at.table.attrs, align }, rows);
  const tr = state.tr.replaceWith(at.tablePos, at.tablePos + at.table.nodeSize, table);
  dispatch(tr.setSelection(TextSelection.create(tr.doc, cellPos(table, at.tablePos, at.row, column))).scrollIntoView());
  return true;
};

/**
 * Backspace at the start of a cell never joins across cells or out of the table; at the start of an empty table it
 * replaces the table with an empty paragraph.
 */
export const cellBackspace: Command = (state, dispatch) => {
  const { selection } = state;
  if (!selection.empty || selection.$head.parentOffset > 0) { return false; }
  const at = cellAt(selection.$head);
  if (!at) { return false; }
  if (!dispatch) { return true; }
  let empty = true;
  at.table.forEach((row) => { if (!rowIsEmpty(row)) { empty = false; } });
  if (empty && at.row === 0 && at.column === 0) {
    const tr = state.tr.replaceWith(at.tablePos, at.tablePos + at.table.nodeSize, nodes.paragraph.create());
    dispatch(tr.setSelection(TextSelection.create(tr.doc, at.tablePos + 1)).scrollIntoView());
  }
  return true;
};

/** The key bindings of the caret in a table cell; outside a table each returns false. */
export function tableKeymap(): Record<string, Command> {
  return { Tab: goToCell(1), "Shift-Tab": goToCell(-1), Enter: cellBelow, Backspace: cellBackspace };
}

/** An empty table of `rows` rows (the first one the header) by `columns` columns, without alignment. */
function emptyTable(rows: number, columns: number): ProseNode {
  const row = (type: typeof nodes.cell) => nodes.row.create(null, Array.from({ length: columns }, () => type.create()));
  return nodes.table.create({ align: Array<null>(columns).fill(null) }, [row(nodes.header), ...Array.from({ length: rows - 1 }, () => row(nodes.cell))]);
}

/** Inserts a 2 by 2 table where a block goes in and puts the caret in its first header cell. */
export const insertTable: Command = (state, dispatch, view) => insertBlock(() => emptyTable(2, 2))(state, dispatch && ((tr) => {
  const tablePos = tr.selection.from;
  dispatch(tr.setMeta(editRequestKey, null).setSelection(TextSelection.create(tr.doc, tablePos + 3)));
}), view);
