// Jumping to the next or previous problem of a note (plan notebook-flow D12): an output that is an error, out of date or maybe out of date.
import type { Node as ProseNode } from "prosemirror-model";
import { NodeSelection } from "prosemirror-state";
import type { EditorView } from "prosemirror-view";
import { qmdSchema } from "../editor/index.js";
import { isErrorOutput } from "./cellSummary.js";
import { foldStateOf, setFold } from "./foldPlugin.js";
import { scanDoc } from "./notebookCells.js";
import { cellGroup } from "./qmdBlocks.js";

const outputNode = qmdSchema.nodes.output!;

/** What is wrong with an output: its run failed, its cell's code changed since, or a cell above it may have changed it. */
export type OutputProblem = "error" | "out-of-date" | "maybe-stale";

/**
 * The position of the first top-level block after `from` (dir 1) or the last before it (dir -1) that `isProblem` accepts; null when none.
 * It does not wrap round; that is the caller's job.
 */
export function findProblem(doc: ProseNode, from: number, dir: -1 | 1, isProblem: (pos: number) => boolean): number | null {
  let found: number | null = null;
  doc.forEach((_node, pos) => {
    if (dir > 0 ? found === null && pos > from && isProblem(pos) : pos < from && isProblem(pos)) found = pos;
  });
  return found;
}

/** The problem of the top-level output at `pos`, read from its raw opener and the classes of its view; null for no problem and for any other node. */
export function outputProblem(view: EditorView, pos: number): OutputProblem | null {
  const node = view.state.doc.nodeAt(pos);
  if (!node || node.type !== outputNode) return null;
  if (isErrorOutput(node.attrs.raw as string)) return "error";
  const dom = view.nodeDOM(pos);
  if (!(dom instanceof HTMLElement)) return null;
  if (dom.classList.contains("is-out-of-date")) return "out-of-date";
  return dom.classList.contains("is-maybe-stale") ? "maybe-stale" : null;
}

/**
 * Selects the next (dir 1) or previous problem output of the editor, searching from the selection ('caret') or from before the start / past the end ('edge'). The collapsed cell
 * holding the output is expanded (a collapsed section opens when the selection enters it), and the output is scrolled into view and the editor focused.
 * Returns false and changes nothing when there is none.
 */
export function revealProblemIn(view: EditorView, dir: -1 | 1, from: "caret" | "edge"): boolean {
  if (view.isDestroyed) return false;
  const { doc } = view.state;
  const start = from === "caret" ? view.state.selection.from : dir > 0 ? -1 : doc.content.size;
  const pos = findProblem(doc, start, dir, (at) => outputProblem(view, at) !== null);
  if (pos === null) return false;
  const cell = scanDoc(doc).cells.find((candidate) => candidate.pos === cellGroup(doc, pos).from);
  if (cell && foldStateOf(view.state).cells.has(cell.key)) setFold(view, { cell: [cell.key, false] });
  view.dispatch(view.state.tr.setSelection(NodeSelection.create(view.state.doc, pos)).scrollIntoView());
  view.focus();
  return true;
}

/** Selects the next or previous problem of the editor from its selection, wrapping round to the other end of the item; false when it has none. */
export function jumpProblemWithin(view: EditorView, dir: -1 | 1): boolean {
  return revealProblemIn(view, dir, "caret") || revealProblemIn(view, dir, "edge");
}

const roots = new WeakMap<object, HTMLElement>();

/** Remembers the root element of the editor behind `handle`, so the note bar can tell which editor holds the focus. */
export function trackEditorRoot(handle: object, root: HTMLElement): void {
  roots.set(handle, root);
}

/** Whether the focus sits inside the editor behind `handle`. */
export function holdsFocus(handle: object): boolean {
  const root = roots.get(handle);
  return root !== undefined && document.activeElement !== null && root.contains(document.activeElement);
}
