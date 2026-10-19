// Lists the CodeMirror extensions every source editor shares: editing commands, key bindings, wrapping and theme.
import { closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import { EditorState, type Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { editorTheme } from "./editorTheme";

/** `history: false` leaves undo to another owner of the document, such as a shared text's own undo manager. */
export function editorExtensions(languageSupport: Extension, { history: withHistory = true } = {}): Extension[] {
  return [
    // A snippet's repeated field (\begin{…} … \end{…}) is one selection per place; without this only the first is edited.
    EditorState.allowMultipleSelections.of(true),
    lineNumbers(), ...(withHistory ? [history()] : []), drawSelection(), highlightActiveLine(), indentOnInput(), bracketMatching(), closeBrackets(),
    highlightSelectionMatches(), EditorView.lineWrapping, editorTheme, languageSupport,
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...(withHistory ? historyKeymap : []), ...completionKeymap, ...lintKeymap, indentWithTab]),
  ];
}
