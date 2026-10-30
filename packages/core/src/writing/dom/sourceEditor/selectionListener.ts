// Reports the main selection of a CodeMirror editor, for a host that shows it to others (presence) or follows the cursor line.
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

/** Calls onSelection when a transaction set the selection or an edit moved the main selection; offsets are in the editor's text and the line is 1-based, the line of the head. */
export function createSelectionListener(onSelection: (selection: { anchor: number; head: number; line: number }) => void): Extension {
  return EditorView.updateListener.of((update) => {
    const before = update.startState.selection.main;
    const { anchor, head } = update.state.selection.main;
    if (!update.selectionSet && before.anchor === anchor && before.head === head) return;
    onSelection({ anchor, head, line: update.state.doc.lineAt(head).number });
  });
}
