// The ⋯ cell menu of a code cell (plan notebook-flow D10, D12): Run above and below through the note's actions, Collapse cell, Duplicate, Change language, Move up, Move down and Delete.
import { NodeSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { askDialog, showMenu, type MenuEntry } from "../../ui/dom/widgets/index.js";
import { moveBlock } from "./blockMove.js";
import { setFold } from "./foldPlugin.js";
import { cellControlsAt, languageMenuItems } from "./inlineViews.js";
import { NO_RUNNER_TITLE } from "./noteBar.js";
import { scanDoc } from "./notebookCells.js";

/** The item-local key of the code cell at `pos` (its label, else `cell-<n>`), as the fold state and the note's actions use it. */
function localKey(view: EditorView, pos: number | undefined): string | undefined {
  return pos === undefined ? undefined : scanDoc(view.state.doc).cells.find((cell) => cell.pos === pos)?.key;
}

/** The radio list of the cell languages under the cell's menu button, as the cell line's language picker shows it. */
function showLanguageMenu(view: EditorView, pos: number): void {
  const controls = cellControlsAt(view, pos);
  const dom = view.nodeDOM(pos);
  if (!controls || !(dom instanceof HTMLElement)) return;
  const anchor = dom.querySelector<HTMLElement>(".qmd-cell-menu") ?? dom;
  showMenu(anchor, languageMenuItems(controls));
}

/** Selects the cell at `pos` and moves it with its outputs in `dir`; with `dryRun` only says whether the move would change anything. */
export function moveCell(view: EditorView, pos: number | undefined, dir: -1 | 1, dryRun = false): boolean {
  if (pos === undefined || view.isDestroyed || view.state.doc.nodeAt(pos)?.type.name !== "code_cell") return false;
  const select = view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos));
  if (dryRun) return moveBlock(dir)(view.state.apply(select));
  if (!moveBlock(dir)(view.state.apply(select))) return false;
  view.dispatch(select);
  return moveBlock(dir)(view.state, view.dispatch.bind(view), view);
}

/** The entries of the cell menu of the code cell at `getPos()`; the run entries are disabled, saying why, without actions or a runner. */
export function cellMenuEntries(view: import("prosemirror-view").EditorView, getPos: () => number | undefined, actions: import("./noteBar.js").NoteActions | undefined): MenuEntry[] {
  const runnable = actions !== undefined && actions.canRun();
  const runEntry = (label: string, kind: "above" | "below"): MenuEntry => ({
    label,
    ...(runnable ? {} : { disabled: true, title: NO_RUNNER_TITLE }),
    onSelect: () => {
      const cell = localKey(view, getPos());
      if (cell !== undefined && actions?.canRun()) actions.runScope({ kind, cell });
    },
  });
  return [
    runEntry("Run above", "above"),
    runEntry("Run below", "below"),
    "separator",
    { label: "Collapse cell", onSelect: () => { const cell = localKey(view, getPos()); if (cell !== undefined) setFold(view, { cell: [cell, true] }); } },
    { label: "Duplicate", onSelect: () => { const pos = getPos(); if (pos !== undefined && !view.isDestroyed) duplicateCell(view, pos); } },
    { label: "Change language", onSelect: () => { const pos = getPos(); if (pos !== undefined) showLanguageMenu(view, pos); } },
    { label: "Move up", ...(moveCell(view, getPos(), -1, true) ? {} : { disabled: true }), onSelect: () => { moveCell(view, getPos(), -1); } },
    { label: "Move down", ...(moveCell(view, getPos(), 1, true) ? {} : { disabled: true }), onSelect: () => { moveCell(view, getPos(), 1); } },
    "separator",
    {
      label: "Delete",
      danger: true,
      onSelect: () => {
        void askDialog("Delete cell", "Delete this cell and its outputs?", "Delete", true).then((accepted) => {
          const pos = getPos();
          if (accepted && pos !== undefined && !view.isDestroyed) deleteCell(view, pos);
        });
      },
    },
  ];
}

/** Removes the code cell at `pos` with its consecutive output siblings, in one transaction (one undo step). */
export function deleteCell(view: import("prosemirror-view").EditorView, pos: number): void {
  const { doc } = view.state;
  const node = doc.nodeAt(pos);
  if (!node || node.type.name !== "code_cell") return;
  view.dispatch(view.state.tr.delete(pos, cellEnd(doc, pos, node)));
}

/** The end of the code cell at `pos` with its consecutive output siblings. */
function cellEnd(doc: import("prosemirror-model").Node, pos: number, node: import("prosemirror-model").Node): number {
  const $pos = doc.resolve(pos);
  const parent = $pos.parent;
  let end = pos + node.nodeSize;
  for (let i = $pos.index() + 1; i < parent.childCount && parent.child(i).type.name === "output"; i++) end += parent.child(i).nodeSize;
  return end;
}

/** Inserts a copy of the code cell at `pos` after its outputs, without outputs and without its `label` option, in one transaction (one undo step); false when `pos` is not a code cell. */
export function duplicateCell(view: import("prosemirror-view").EditorView, pos: number): boolean {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type.name !== "code_cell") return false;
  const options = String(node.attrs.options ?? "").split("\n").filter((line) => !/^#\|\s*label\s*:/.test(line)).join("\n");
  view.dispatch(view.state.tr.insert(cellEnd(view.state.doc, pos, node), node.type.create({ ...node.attrs, options }, node.content, node.marks)).scrollIntoView());
  return true;
}
