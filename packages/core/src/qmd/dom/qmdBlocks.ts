// Moves the caret and blocks through a note: arrows and clicks around cells, outputs and equations, and dragging a cell together with its outputs.
import type { Node as ProseNode } from "prosemirror-model";
import { NodeSelection, Plugin, TextSelection } from "prosemirror-state";
import { dropPoint } from "prosemirror-transform";
import type { EditorView } from "prosemirror-view";
import { docToBody, qmdSchema } from "../editor/index.js";
import { cellControlsAt, editNodeAt } from "./inlineViews.js";

const codeCell = qmdSchema.nodes.code_cell!;
const outputNode = qmdSchema.nodes.output!;
const mathDisplay = qmdSchema.nodes.math_display!;
const mathInline = qmdSchema.nodes.math_inline!;
const paragraph = qmdSchema.nodes.paragraph!;

/** Blocks with an editor of their own that arrow keys open, like stepping into a line of text. */
const editableBlocks: ReadonlySet<unknown> = new Set([codeCell, mathDisplay]);

const arrowKeys: Record<string, { dir: 1 | -1; edge: "up" | "down" | "left" | "right" }> = {
  ArrowDown: { dir: 1, edge: "down" }, ArrowRight: { dir: 1, edge: "right" }, ArrowUp: { dir: -1, edge: "up" }, ArrowLeft: { dir: -1, edge: "left" },
};

/** The position after the block at `pos` and the outputs that follow it, which belong to it. */
function afterOutputs(doc: ProseNode, pos: number): number {
  let end = pos + doc.nodeAt(pos)!.nodeSize;
  for (let next = doc.resolve(end).nodeAfter; next && next.type === outputNode; next = doc.resolve(end).nodeAfter) end += next.nodeSize;
  return end;
}

/** Puts the caret in a new empty paragraph inserted at the top-level position `pos`. */
function insertParagraphAt(view: EditorView, pos: number, text = ""): boolean {
  const tr = view.state.tr.insert(pos, paragraph.create(null, text ? qmdSchema.text(text) : null));
  view.dispatch(tr.setSelection(TextSelection.create(tr.doc, pos + 1 + text.length)).scrollIntoView());
  view.focus();
  return true;
}

/** Whether the block at `pos` is a code cell folded behind its outputs, which the caret steps over. */
const isFoldedCell = (view: EditorView, pos: number): boolean => view.state.doc.nodeAt(pos)?.type === codeCell && cellControlsAt(view, pos)?.folded() === true;

/** Selects the first output after the folded cell at `pos`. */
function selectOutputAfter(view: EditorView, pos: number): boolean {
  const { doc } = view.state;
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(doc, pos + doc.nodeAt(pos)!.nodeSize)).scrollIntoView());
  return true;
}

/** Moves the caret off the selected block (an output or a closed equation) in `dir`, into text or the neighbouring block's editor. */
function leaveSelectedBlock(view: EditorView, selection: NodeSelection, dir: 1 | -1): boolean {
  return leaveAt(view, dir > 0 ? afterOutputs(view.state.doc, selection.from) : selection.from, dir);
}

/** Moves the caret across the block boundary at `edge` in `dir`, stepping over folded cells. */
function leaveAt(view: EditorView, edge: number, dir: 1 | -1): boolean {
  const { doc } = view.state;
  const $edge = doc.resolve(edge);
  const neighbour = dir > 0 ? $edge.nodeAfter : $edge.nodeBefore;
  if (neighbour?.isTextblock) {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, dir > 0 ? edge + 1 : edge - 1)).scrollIntoView());
    return true;
  }
  const at = neighbour ? (dir > 0 ? edge : edge - neighbour.nodeSize) : -1;
  if (neighbour && isFoldedCell(view, at)) return dir > 0 ? selectOutputAfter(view, at) : leaveAt(view, at, dir);
  if (neighbour && editableBlocks.has(neighbour.type)) return editNodeAt(view, at, dir > 0 ? "start" : "end");
  if (neighbour && neighbour.type === outputNode) {
    view.dispatch(view.state.tr.setSelection(NodeSelection.create(doc, at)).scrollIntoView());
    return true;
  }
  return insertParagraphAt(view, edge);
}

/**
 * Lets the caret travel through a note like through text: arrows at the edge of a line step into the code of a cell or
 * the LaTeX of an equation beside it, arrows and Enter on a selected output or equation move past it, and typing on one
 * starts a new paragraph after it instead of replacing it.
 */
export function blockNavigationPlugin(): Plugin {
  return new Plugin({
    props: {
      handleKeyDown(view, event) {
        const key = arrowKeys[event.key];
        if (event.shiftKey || event.altKey || event.metaKey || event.ctrlKey) return false;
        const selection = view.state.selection;
        if (selection instanceof NodeSelection && selection.node.isBlock && !selection.node.isTextblock && (key || event.key === "Enter")) {
          if (event.key === "Enter" && selection.node.type === mathDisplay) return editNodeAt(view, selection.from, "end");
          return leaveSelectedBlock(view, selection, key?.dir ?? 1);
        }
        if (!key || !(selection instanceof TextSelection) || !selection.empty) return false;
        const { $from } = selection;
        // An inline equation right beside the caret opens at the side the caret comes from.
        if (key.edge === "right" && $from.nodeAfter?.type === mathInline) return editNodeAt(view, $from.pos, "start");
        const before = $from.nodeBefore;
        if (key.edge === "left" && before && before.type === mathInline) return editNodeAt(view, $from.pos - before.nodeSize, "end");
        if ($from.depth < 1 || !view.endOfTextblock(key.edge)) return false;
        const edge = key.dir > 0 ? $from.after(1) : $from.before(1);
        const $edge = view.state.doc.resolve(edge);
        const neighbour = key.dir > 0 ? $edge.nodeAfter : $edge.nodeBefore;
        const at = key.dir > 0 ? edge : edge - (neighbour?.nodeSize ?? 0);
        if (neighbour?.type === outputNode && key.dir < 0) {
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, at)).scrollIntoView());
          return true;
        }
        if (neighbour && key.dir > 0 && isFoldedCell(view, at)) return selectOutputAfter(view, at);
        if (!neighbour || !editableBlocks.has(neighbour.type)) return false;
        return editNodeAt(view, at, key.dir > 0 ? "start" : "end");
      },
      handleTextInput(view, _from, _to, text) {
        const selection = view.state.selection;
        if (!(selection instanceof NodeSelection) || !selection.node.isBlock || selection.node.isTextblock) return false;
        return insertParagraphAt(view, afterOutputs(view.state.doc, selection.from), text);
      },
    },
  });
}

/**
 * Clicking empty space beside blocks that hold no text (above the first, between two, or below the last) puts the caret
 * in a new paragraph there, so text can always be written before and after a cell, its output or an equation.
 */
export function placeCaretFromClick(view: EditorView, event: MouseEvent): boolean {
  const { doc } = view.state;
  const blocks: Array<{ pos: number; node: ProseNode; rect: DOMRect }> = [];
  doc.forEach((node, pos) => {
    const dom = view.nodeDOM(pos);
    if (dom instanceof HTMLElement) blocks.push({ pos, node, rect: dom.getBoundingClientRect() });
  });
  if (blocks.length === 0) return false;
  let index = blocks.findIndex((block) => event.clientY < block.rect.top);
  if (index === -1) index = blocks.length;
  else if (index > 0 && event.clientY <= blocks[index - 1]!.rect.bottom) return false;
  const before = blocks[index - 1];
  const after = blocks[index];
  if (before?.node.isTextblock && !after) {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, before.pos + before.node.nodeSize - 1)));
    view.focus();
    return true;
  }
  if (before?.node.isTextblock || after?.node.isTextblock) return false;
  // Outputs stay attached to their cell: a click between the two writes after the outputs.
  return insertParagraphAt(view, before ? afterOutputs(doc, before.pos) : 0);
}

/**
 * Finds where a double click on empty space of the note inserts: an empty paragraph under the pointer, a new paragraph
 * after the figure or blocks beside the pointer, or one after the last block. False on text, which keeps word selection.
 */
export function placeCaretForInsert(view: EditorView, event: MouseEvent): boolean {
  const target = event.target instanceof Element ? event.target : null;
  if (!target) return false;
  const textblock = target.closest("p, h1, h2, h3");
  if (textblock && view.dom.contains(textblock)) {
    if (textblock.textContent !== "") return false;
    const pos = view.posAtDOM(textblock, 0);
    view.dispatch(view.state.tr.setSelection(TextSelection.create(view.state.doc, pos)));
    view.focus();
    return true;
  }
  if (target.matches(".qmd-output, .qmd-output-body")) {
    const block = blockAt(view, target);
    return block !== null && insertParagraphAt(view, afterOutputs(view.state.doc, block.pos));
  }
  if (!target.contains(view.dom) && target !== view.dom) return false;
  const { doc } = view.state;
  const last = doc.lastChild;
  const lastDom = last ? view.nodeDOM(doc.content.size - last.nodeSize) : null;
  const below = !(lastDom instanceof HTMLElement) || event.clientY > lastDom.getBoundingClientRect().bottom;
  if (!below) return placeCaretFromClick(view, event);
  if (last?.type === paragraph && last.content.size === 0) {
    view.dispatch(view.state.tr.setSelection(TextSelection.create(doc, doc.content.size - 1)));
    view.focus();
    return true;
  }
  return insertParagraphAt(view, doc.content.size);
}

/** The range of the cell group holding the block at `pos`: a code cell and the outputs after it, or an output on its own. */
function cellGroup(doc: ProseNode, pos: number): { from: number; to: number } {
  let from = pos;
  while (doc.nodeAt(from)?.type === outputNode) {
    const before = doc.resolve(from).nodeBefore;
    if (!before || (before.type !== outputNode && before.type !== codeCell)) break;
    from -= before.nodeSize;
  }
  return { from, to: afterOutputs(doc, from) };
}

/** The top-level block whose element holds `target`, with its position. */
function blockAt(view: EditorView, target: EventTarget | null): { pos: number; node: ProseNode } | null {
  let found: { pos: number; node: ProseNode } | null = null;
  view.state.doc.forEach((node, pos) => {
    const dom = view.nodeDOM(pos);
    if (!found && dom && target instanceof Node && dom.contains(target)) found = { pos, node };
  });
  return found;
}

/**
 * Dragging a code cell (by its action line) or one of its outputs moves the cell and all its outputs as one block, dropped
 * between blocks and never between another cell and its outputs. Alt (Ctrl off macOS) copies instead, as for text.
 */
export function blockDragPlugin(): Plugin {
  let dragged: { from: number; to: number } | null = null;
  return new Plugin({
    props: {
      handleDOMEvents: {
        dragstart(view, event) {
          const block = blockAt(view, event.target);
          if (!block || (block.node.type !== codeCell && block.node.type !== outputNode) || !event.dataTransfer) return false;
          const { doc } = view.state;
          dragged = cellGroup(doc, block.pos);
          const slice = doc.slice(dragged.from, dragged.to);
          event.dataTransfer.clearData();
          event.dataTransfer.setData("text/plain", docToBody(qmdSchema.nodes.doc!.create({ ...doc.attrs, trailing: "", unterminated: false }, slice.content)));
          event.dataTransfer.effectAllowed = "copyMove";
          view.dispatch(view.state.tr.setSelection(NodeSelection.create(doc, block.pos)));
          view.dragging = { slice, move: true };
          return true;
        },
        dragend() {
          dragged = null;
          return false;
        },
      },
      handleDrop(view, event, _slice, moved) {
        const group = dragged;
        dragged = null;
        if (!group) return false;
        const coords = view.posAtCoords({ left: event.clientX, top: event.clientY });
        if (!coords) return true;
        const { doc } = view.state;
        const slice = doc.slice(group.from, group.to);
        let at = dropPoint(doc, coords.pos, slice) ?? coords.pos;
        // A drop just before an output lands after the outputs, so no cell loses its result.
        if (doc.resolve(at).nodeAfter?.type === outputNode) at = afterOutputs(doc, at);
        if (moved && at >= group.from && at <= group.to) return true;
        const tr = view.state.tr;
        if (moved) tr.delete(group.from, group.to);
        const pos = tr.mapping.map(at);
        tr.insert(pos, slice.content);
        view.dispatch(tr.setSelection(NodeSelection.create(tr.doc, pos)).scrollIntoView());
        view.focus();
        return true;
      },
    },
  });
}
