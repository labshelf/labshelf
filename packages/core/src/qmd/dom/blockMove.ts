// Moves a cell with its outputs, or a whole section, one step up or down within an item (plan notebook-flow D12), in one transaction so one undo restores it.
import type { Node as ProseNode } from "prosemirror-model";
import { NodeSelection, TextSelection, type Command, type EditorState, type Transaction } from "prosemirror-state";
import { qmdSchema } from "../editor/index.js";
import { afterOutputs, cellGroup } from "./qmdBlocks.js";

const codeCell = qmdSchema.nodes.code_cell!;
const outputNode = qmdSchema.nodes.output!;
const headingNode = qmdSchema.nodes.heading!;

interface Range { from: number; to: number }
/** The unit being moved, the unit it passes over, and where the selection goes afterwards. */
interface Move { unit: Range; over: Range; select(tr: Transaction, start: number): Transaction }

/** The range of the top-level block ending at `end` together with the outputs of its cell, when it is a cell or an output. */
function unitBefore(doc: ProseNode, end: number): Range | null {
  const before = doc.resolve(end).nodeBefore;
  if (!before) return null;
  const start = end - before.nodeSize;
  return before.type === outputNode || before.type === codeCell ? cellGroup(doc, start) : { from: start, to: end };
}

/** The range of the top-level block starting at `start`, with the outputs after it when it is a cell. */
function unitAfter(doc: ProseNode, start: number): Range | null {
  const node = doc.nodeAt(start);
  if (!node) return null;
  return node.type === codeCell ? { from: start, to: afterOutputs(doc, start) } : { from: start, to: start + node.nodeSize };
}

/** The end of the section of the heading at `pos`: the next heading of the same or a higher level, else the end of the document. */
function sectionEnd(doc: ProseNode, pos: number, level: number): number {
  let end = doc.content.size;
  let after = pos + doc.nodeAt(pos)!.nodeSize;
  while (after < doc.content.size) {
    const node = doc.nodeAt(after)!;
    if (node.type === headingNode && (node.attrs.level as number) <= level) { end = after; break; }
    after += node.nodeSize;
  }
  return end;
}

/** The start of the previous heading of the same level that no higher heading separates from `pos`, or null. */
function previousSectionStart(doc: ProseNode, pos: number, level: number): number | null {
  let found: number | null = null;
  doc.forEach((node, offset) => {
    if (offset >= pos || node.type !== headingNode) return;
    const nodeLevel = node.attrs.level as number;
    if (nodeLevel === level) found = offset;
    else if (nodeLevel < level) found = null;
  });
  return found;
}

/** What the selection of `state` moves and what it passes over in `dir`, or null when it is not a cell, an output or a heading caret, or sits at the item's edge. */
function planMove(state: EditorState, dir: -1 | 1): Move | null {
  const { doc, selection } = state;
  if (selection instanceof NodeSelection && selection.$from.depth === 0 && (selection.node.type === codeCell || selection.node.type === outputNode)) {
    const unit = cellGroup(doc, selection.from);
    const over = dir > 0 ? unitAfter(doc, unit.to) : unitBefore(doc, unit.from);
    return over ? { unit, over, select: (tr, start) => tr.setSelection(NodeSelection.create(tr.doc, start)) } : null;
  }
  const { $from } = selection;
  if (!(selection instanceof TextSelection) || $from.depth !== 1 || $from.parent.type !== headingNode) return null;
  const pos = $from.before();
  const level = $from.parent.attrs.level as number;
  const unit = { from: pos, to: sectionEnd(doc, pos, level) };
  const offset = selection.head - pos;
  let over: Range | null = null;
  if (dir > 0) {
    const next = doc.nodeAt(unit.to);
    if (next && next.type === headingNode && next.attrs.level === level) over = { from: unit.to, to: sectionEnd(doc, unit.to, level) };
  } else {
    const start = previousSectionStart(doc, pos, level);
    if (start !== null) over = { from: start, to: pos };
  }
  return over ? { unit, over, select: (tr, start) => tr.setSelection(TextSelection.create(tr.doc, start + offset)) } : null;
}

/**
 * Moves the cell (with its outputs) selected as a node, or the section of the heading holding the caret, over the neighbouring unit in `dir`:
 * a paragraph, a heading or another cell with its outputs, or the neighbouring section of the same level. One transaction; the moved cell or heading stays selected.
 * Returns false (and does nothing) at the item's edge and for any other selection.
 */
export function moveBlock(dir: -1 | 1): Command {
  return (state, dispatch) => {
    const move = planMove(state, dir);
    if (!move) return false;
    if (dispatch) {
      const { unit, over } = move;
      const tr = state.tr;
      const passed = state.doc.slice(over.from, over.to);
      const size = over.to - over.from;
      // Move the neighbour across the unit: before it going down, after it going up.
      if (dir > 0) {
        tr.delete(over.from, over.to).insert(unit.from, passed.content);
        dispatch(move.select(tr, unit.from + size).scrollIntoView());
      } else {
        tr.delete(over.from, over.to).insert(unit.to - size, passed.content);
        dispatch(move.select(tr, over.from).scrollIntoView());
      }
    }
    return true;
  };
}
