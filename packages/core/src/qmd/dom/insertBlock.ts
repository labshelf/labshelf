// Inserts a block node at the caret and asks the editor to open its source editor (requestNodeEdit); shared by the editing commands, the input rules and the chart insert.
import type { Node as ProseNode } from "prosemirror-model";
import { NodeSelection, PluginKey, type Command, type Transaction } from "prosemirror-state";
import { qmdSchema } from "../editor/index.js";
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
