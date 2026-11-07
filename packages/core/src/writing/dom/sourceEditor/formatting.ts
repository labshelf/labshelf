// The source editor's text updates: insertions, snippets and wrapping the selection, and the Cmd/Ctrl+B and Cmd/Ctrl+I keymap.
import { snippet } from "@codemirror/autocomplete";
import { indentUnit } from "@codemirror/language";
import { EditorSelection, type ChangeSpec, type Extension } from "@codemirror/state";
import { keymap, type EditorView } from "@codemirror/view";
import { deriveLatexIndents, deriveSelectionWrap, type WrapKind } from "../../../index.js";
import { reviewEdit } from "./review.js";

/** `$1` and `${1:Caption}` become CodeMirror fields, `$0` the final cursor, and `\\`, `\$`, `\}` their literal characters. */
export function deriveCodeMirrorTemplate(textMate: string): string {
  return textMate
    .replace(/\\([\\$}])|\$(\d+)|\$\{(\d+)(?::([^}]*))?\}/g, (_match, literal?: string, bare?: string, field?: string, placeholder?: string) => {
      if (literal !== undefined) return literal;
      if (bare !== undefined) return `\${${bare}}`;
      return placeholder === undefined ? `\${${field}}` : `\${${field}:${placeholder}}`;
    })
    // CodeMirror reads a backslash before a brace as an escape, so a literal one is doubled.
    .replace(/\\(?=[{}])/g, "\\\\");
}

export type SourceLanguage = "latex" | "typst";

/** Typst for a `.typ` file, LaTeX for any other. */
export function deriveSourceLanguage(path: string): SourceLanguage {
  return path.endsWith(".typ") ? "typst" : "latex";
}

export interface SourceUpdates {
  /** Replaces every selection with the text and puts a cursor after each. */
  insertText(text: string): void;
  /** Inserts a core snippet at the main selection and starts its tab stops. */
  insertSnippet(textMateSnippet: string): void;
  /** Wraps each selection in the style's markup, or removes the markup when it is already there; an empty selection gets an empty pair. */
  wrap(style: WrapKind): void;
  /** Re-indents the whole LaTeX text by its environments and groups, as one undoable edit; Typst is left as it is. */
  indentDocument(): void;
}

function insertText(view: EditorView, text: string): void {
  view.dispatch(view.state.update(
    view.state.changeByRange((range) => ({ changes: { from: range.from, to: range.to, insert: text }, range: EditorSelection.cursor(range.from + text.length) })),
    { scrollIntoView: true, userEvent: "input", annotations: reviewEdit.of(true) },
  ));
}

function wrapSelections(view: EditorView, language: SourceLanguage, style: WrapKind): void {
  const { state } = view;
  view.dispatch(state.update(
    state.changeByRange((range) => {
      const { text, cursor } = deriveSelectionWrap(language, style, state.sliceDoc(range.from, range.to));
      return {
        changes: { from: range.from, to: range.to, insert: text },
        range: cursor === undefined ? EditorSelection.range(range.from, range.from + text.length) : EditorSelection.cursor(range.from + cursor),
      };
    }),
    { scrollIntoView: true, userEvent: "input", annotations: reviewEdit.of(true) },
  ));
}

/** Changes only the leading whitespace that differs, so cursors, comments and suggestions stay on their text. */
function indentDocument(view: EditorView): void {
  const { doc } = view.state;
  const lines = Array.from({ length: doc.lines }, (_, index) => doc.line(index + 1));
  const indents = deriveLatexIndents(lines.map((line) => line.text), view.state.facet(indentUnit));
  const changes: ChangeSpec[] = [];
  lines.forEach((line, index) => {
    const indent = indents[index];
    const current = /^\s*/.exec(line.text)![0];
    if (indent !== undefined && indent !== current) changes.push({ from: line.from, to: line.from + current.length, insert: indent });
  });
  if (changes.length > 0) view.dispatch({ changes, userEvent: "input.indent", annotations: reviewEdit.of(true) });
}

export function createSourceUpdates(view: EditorView, language: SourceLanguage): SourceUpdates {
  return {
    insertText: (text) => { insertText(view, text); view.focus(); },
    insertSnippet: (textMateSnippet) => {
      const { from, to } = view.state.selection.main;
      snippet(deriveCodeMirrorTemplate(textMateSnippet))(view, null, from, to);
      view.focus();
    },
    wrap: (style) => { wrapSelections(view, language, style); view.focus(); },
    indentDocument: () => { if (language === "latex") indentDocument(view); view.focus(); },
  };
}

/** Cmd/Ctrl+B and Cmd/Ctrl+I wrap the selection, as in the VS Code editor. */
export function createFormattingKeymap(language: SourceLanguage): Extension {
  const wrapWith = (style: WrapKind) => (view: EditorView): boolean => { wrapSelections(view, language, style); return true; };
  return keymap.of([
    { key: "Mod-b", preventDefault: true, run: wrapWith("bold") },
    { key: "Mod-i", preventDefault: true, run: wrapWith("italic") },
  ]);
}
