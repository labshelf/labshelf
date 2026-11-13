// One CodeMirror code view: line numbers, highlighting by the file's extension, read-only or editable. The Insert code popup's
// viewer and the consult windows share it, each adding its own extensions last.
import { defaultKeymap, history, historyKeymap } from "@codemirror/commands";
import { python } from "@codemirror/lang-python";
import { StreamLanguage, defaultHighlightStyle, syntaxHighlighting, type StreamParser } from "@codemirror/language";
import { c, cpp, java, scala } from "@codemirror/legacy-modes/mode/clike";
import { fortran } from "@codemirror/legacy-modes/mode/fortran";
import { go } from "@codemirror/legacy-modes/mode/go";
import { haskell } from "@codemirror/legacy-modes/mode/haskell";
import { javascript, typescript, json } from "@codemirror/legacy-modes/mode/javascript";
import { julia } from "@codemirror/legacy-modes/mode/julia";
import { lua } from "@codemirror/legacy-modes/mode/lua";
import { octave } from "@codemirror/legacy-modes/mode/octave";
import { perl } from "@codemirror/legacy-modes/mode/perl";
import { r } from "@codemirror/legacy-modes/mode/r";
import { ruby } from "@codemirror/legacy-modes/mode/ruby";
import { rust } from "@codemirror/legacy-modes/mode/rust";
import { shell } from "@codemirror/legacy-modes/mode/shell";
import { standardSQL } from "@codemirror/legacy-modes/mode/sql";
import { stex } from "@codemirror/legacy-modes/mode/stex";
import { toml } from "@codemirror/legacy-modes/mode/toml";
import { yaml } from "@codemirror/legacy-modes/mode/yaml";
import { EditorState, type Extension } from "@codemirror/state";
import { EditorView, drawSelection, highlightActiveLine, keymap, lineNumbers } from "@codemirror/view";
import { readPageNonce } from "../../../ui/dom/index.js";
import { deriveCodeLanguage } from "../../codeLinks/index.js";
import { editorTheme } from "./editorTheme.js";
import { typstLanguage } from "./typst.js";

// TRAP: the legacy modes are typed with the @codemirror/streamparser parser type, which exactOptionalPropertyTypes rejects as a @codemirror/language StreamParser.
const stream = (mode: unknown): Extension => StreamLanguage.define(mode as StreamParser<unknown>);

/** The legacy mode of each minted lexer name a code file can have; a lexer without one is shown as plain text. */
const LEXER_MODES: Readonly<Record<string, unknown>> = {
  r, julia, bash: shell, javascript, typescript, json, lua, yaml, toml, matlab: octave, ruby, perl, c, cpp, java, scala, go, rust, fortran, haskell, sql: standardSQL,
};

/** The text extensions of a LaTeX source. */
const TEX = /\.(tex|sty|cls|ltx)$/i;

/** The highlighting of a file by its extension: LaTeX, Typst, Python and the code languages LabShelf lists; plain text (`[]`) for anything else. */
export function codeViewLanguage(path: string): Extension {
  if (TEX.test(path)) { return stream(stex); }
  if (/\.typ$/i.test(path)) { return typstLanguage; }
  if (/\.py$/i.test(path)) { return python(); }
  const lexer = deriveCodeLanguage(path)?.lexer;
  const mode = lexer === undefined ? undefined : LEXER_MODES[lexer];
  return mode === undefined ? [] : stream(mode);
}

export interface CodeViewOptions { path: string; text: string; readOnly: boolean; label?: string; extensions?: readonly Extension[];
  /** false when the caller brings its own undo (a shared Y.Text's); default true. */
  history?: boolean }

/** The extensions of a code view, for a caller that keeps its own EditorView and swaps its state (`setState`). */
export function codeViewExtensions(options: Omit<CodeViewOptions, "text">): Extension[] {
  const { readOnly } = options;
  return [
    EditorView.cspNonce.of(readPageNonce()),
    lineNumbers(), drawSelection(), ...(readOnly ? [] : [highlightActiveLine()]), EditorView.lineWrapping,
    editorTheme, syntaxHighlighting(defaultHighlightStyle, { fallback: true }), codeViewLanguage(options.path),
    EditorView.contentAttributes.of({ "aria-label": options.label ?? "Code" }),
    EditorState.readOnly.of(readOnly), EditorView.editable.of(!readOnly),
    ...(readOnly ? [] : options.history === false
      ? [keymap.of(defaultKeymap)]
      : [history(), keymap.of([...defaultKeymap, ...historyKeymap])]),
    ...(options.extensions ?? []),
  ];
}

/** Mounts a code view of `options.text` in `parent`. */
export function createCodeView(parent: HTMLElement, options: CodeViewOptions): EditorView {
  return new EditorView({ parent, state: EditorState.create({ doc: options.text, extensions: codeViewExtensions(options) }) });
}
