// Lists the CodeMirror extensions every source editor shares: editing commands, key bindings, wrapping and theme.
import { closeBrackets, closeBracketsKeymap, completionKeymap } from "@codemirror/autocomplete";
import { defaultKeymap, history, historyKeymap, indentWithTab } from "@codemirror/commands";
import { bracketMatching, indentOnInput } from "@codemirror/language";
import { lintKeymap } from "@codemirror/lint";
import { highlightSelectionMatches, searchKeymap } from "@codemirror/search";
import type { Extension } from "@codemirror/state";
import { drawSelection, EditorView, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { editorTheme } from "./editorTheme";

export function editorExtensions(languageSupport: Extension): Extension[] {
  return [
    lineNumbers(), history(), drawSelection(), highlightActiveLine(), indentOnInput(), bracketMatching(), closeBrackets(),
    highlightSelectionMatches(), EditorView.lineWrapping, editorTheme, languageSupport,
    keymap.of([...closeBracketsKeymap, ...defaultKeymap, ...searchKeymap, ...historyKeymap, ...completionKeymap, ...lintKeymap, indentWithTab]),
  ];
}
