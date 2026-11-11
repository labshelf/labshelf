// Inserts a block node at the caret and asks the editor to open its source editor (requestNodeEdit), shared by the editing commands, the input rules and the chart insert; and inserts Markdown read into blocks after the caret (From paper…).
import { Fragment, type Node as ProseNode } from "prosemirror-model";
import { NodeSelection, PluginKey, Selection, type Command, type Transaction } from "prosemirror-state";
import { bodyToDoc, qmdSchema } from "../editor/index.js";
import type { EditSide } from "./inlineViews.js";

const paragraph = qmdSchema.nodes.paragraph!;

export interface EditRequest { pos: number; side: EditSide }
export const editRequestKey = new PluginKey<EditRequest | null>("qmdEditRequest");

/** Asks the editor to open the source editor of the node at `pos` (an equation's LaTeX, a cell's code) once `tr` is applied. */
export function requestNodeEdit(tr: Transaction, pos: number, side: EditSide = "start"): Transaction {
  return tr.setMeta(editRequestKey, { pos, side });
}

/** Inserts a block made by `create`, in place of an empty paragraph or after the current block, and opens its source editor. */
export function insertBlock(create: () => ProseNode): Command {
  return (state, dispatch) => {
    const node = create();
    const selection = state.selection;
    let from: number;
    let to: number;
    if (selection.$from.parent.isTextblock) {
      const $pos = selection.$from;
      const container = $pos.node(-1);
      const index = $pos.index(-1);
      const empty = $pos.parent.type === paragraph && $pos.parent.content.size === 0;
      if (empty && container.canReplaceWith(index, index + 1, node.type)) [from, to] = [$pos.before(), $pos.after()];
      else if (container.canReplaceWith(index + 1, index + 1, node.type)) from = to = $pos.after();
      else return false;
    } else if (selection instanceof NodeSelection && selection.node.isBlock) {
      const index = selection.$from.index();
      if (!selection.$from.parent.canReplaceWith(index + 1, index + 1, node.type)) return false;
      from = to = selection.to;
    } else {
      return false;
    }
    if (!dispatch) return true;
    const tr = state.tr.replaceWith(from, to, node);
    tr.setSelection(NodeSelection.create(tr.doc, from));
    if (from + node.nodeSize === tr.doc.content.size) tr.insert(tr.doc.content.size, paragraph.create());
    dispatch(requestNodeEdit(tr, from).scrollIntoView());
    return true;
  };
}

/** The command that inserts an empty figure block the way the equation block goes in; the figure editor opens on it at once. */
export function insertFigureCommand(): Command {
  return insertBlock(() => qmdSchema.nodes.figure!.create({ raw: "" }));
}

/** The top-level blocks of `markdown` as the editor reads them, without empty paragraphs, each with no gap of its own so it sits one blank line from its neighbours. */
export function markdownBlocks(markdown: string): ProseNode[] {
  const blocks: ProseNode[] = [];
  bodyToDoc(markdown.endsWith("\n") ? markdown : `${markdown}\n`).forEach((node) => {
    if (node.type === paragraph && node.content.size === 0) return;
    blocks.push(node.type.create({ ...node.attrs, gap: null }, node.content, node.marks));
  });
  return blocks;
}

/**
 * Inserts `blocks` at the top level: in place of the empty paragraph the caret is in, else after the top-level block holding the caret or selected,
 * then puts the caret after them (on a new empty paragraph at the end of the note).
 */
export function insertBlocksAfterCaret(blocks: readonly ProseNode[]): Command {
  return (state, dispatch) => {
    if (blocks.length === 0) return false;
    const { selection } = state;
    const { $from } = selection;
    let from: number;
    let to: number;
    if ($from.depth === 0) {
      from = to = selection.to;
    } else {
      const top = $from.node(1);
      const empty = top.type === paragraph && top.content.size === 0;
      from = empty ? $from.before(1) : $from.after(1);
      to = $from.after(1);
    }
    const content = Fragment.fromArray([...blocks]);
    if (!state.doc.canReplace($from.index(0), $from.index(0), content)) return false;
    if (!dispatch) return true;
    const tr = state.tr.replaceWith(from, to, content);
    const end = from + content.size;
    if (end === tr.doc.content.size) tr.insert(end, paragraph.create());
    tr.setSelection(Selection.near(tr.doc.resolve(end), 1));
    dispatch(tr.scrollIntoView());
    return true;
  };
}
