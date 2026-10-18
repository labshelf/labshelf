// Writes the matching \end{name} when Enter is pressed at the end of an unclosed \begin{name} line.
import { indentUnit } from "@codemirror/language";
import { EditorSelection, type StateCommand } from "@codemirror/state";
import { environmentToClose } from "@labshelf/core";

/** Falls through (returns false) so the default Enter runs anywhere else. */
export const closeEnvironmentOnEnter: StateCommand = ({ state, dispatch }) => {
  const range = state.selection.main;
  if (!range.empty || state.selection.ranges.length > 1) return false;
  const line = state.doc.lineAt(range.head);
  // Enter only counts at the end of the \begin line.
  if (line.text.slice(range.head - line.from).trim() !== "") return false;
  const name = environmentToClose(line.text.slice(0, range.head - line.from), () => state.sliceDoc(line.to));
  if (name === undefined) return false;
  const indent = /^\s*/.exec(line.text)![0];
  const body = `\n${indent}${state.facet(indentUnit)}`;
  dispatch(state.update({
    changes: { from: range.head, to: line.to, insert: `${body}\n${indent}\\end{${name}}` },
    selection: EditorSelection.cursor(range.head + body.length),
    scrollIntoView: true,
    userEvent: "input",
  }));
  return true;
};
