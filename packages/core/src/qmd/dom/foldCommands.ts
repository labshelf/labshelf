// The fold commands of the editor (plan D8, D14): Collapse all, Expand all and Reading mode, built on setFold. View state only; the document is untouched.
import type { EditorView } from "prosemirror-view";
import { setFold } from "./foldPlugin.js";

/** Collapses every top-level section and every cell outside any section; Reading mode stays as it is. */
export function collapseAll(view: EditorView): void {
  setFold(view, { all: true });
}

/** Clears every collapsed cell and section; Reading mode stays as it is. */
export function expandAll(view: EditorView): void {
  setFold(view, { all: false });
}

/** Turns Reading mode on or off: the root gets `is-reading`, which hides the code of cells while their outputs, text, equations and drawings stay. */
export function setReading(view: EditorView, reading: boolean): void {
  setFold(view, { reading });
}
