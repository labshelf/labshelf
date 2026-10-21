// Adds the Add comment command, its Mod-Alt-m shortcut and a bottom-panel button that is enabled while text is selected.
import { Prec, type Extension } from "@codemirror/state";
import { EditorView, keymap, showPanel } from "@codemirror/view";
import { createSourceFooter } from "../appearance";
import { icon, type TextRange } from "@labshelf/core";

/** @param add receives the selection in document offsets. */
export function addCommentSupport(add: (range: TextRange) => void): Extension {
  const run = (view: EditorView): boolean => {
    const { from, to, empty } = view.state.selection.main;
    if (empty) return false;
    add({ start: from, end: to });
    return true;
  };
  const panel = showPanel.of((view) => {
    const button = document.createElement("button");
    button.type = "button";
    button.className = "ls-btn ls-add-comment";
    button.innerHTML = `${icon("message")}Add comment`;
    button.title = "Add comment on the selection (Ctrl/Cmd+Alt+M)";
    button.disabled = view.state.selection.main.empty;
    button.addEventListener("click", () => run(view));
    return { ...createSourceFooter(button), update: (update) => { button.disabled = update.state.selection.main.empty; } };
  });
  return [Prec.high(keymap.of([{ key: "Mod-Alt-m", run }])), panel];
}
