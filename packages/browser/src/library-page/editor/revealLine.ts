// Scrolls an editor to a zero-based line, selects it and focuses the editor.
import { EditorView } from "@codemirror/view";

export function revealLine(view: EditorView, line: number): void {
  const doc = view.state.doc;
  const target = doc.line(Math.min(Math.max(line, 0) + 1, doc.lines));
  view.dispatch({ selection: { anchor: target.from, head: target.to }, effects: EditorView.scrollIntoView(target.from, { y: "center" }) });
  view.focus();
}
