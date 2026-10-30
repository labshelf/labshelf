// The CodeMirror setup of a code cell's code: line numbers and indentation for every cell language; for Python also highlighting in the code
// theme's colours and completion from the names of every cell in the note and the members of common modules it imports. Mathematica and R
// cells are plain text.
import { autocompletion, closeBrackets, closeBracketsKeymap, completionKeymap, type Completion, type CompletionContext, type CompletionResult, type CompletionSource } from "@codemirror/autocomplete";
import { defaultKeymap, indentLess, indentMore } from "@codemirror/commands";
import { python, pythonLanguage } from "@codemirror/lang-python";
import { bracketMatching, HighlightStyle, indentOnInput, indentUnit, syntaxHighlighting } from "@codemirror/language";
import { Annotation, Compartment, EditorState, Prec, type Extension } from "@codemirror/state";
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, tooltips, type KeyBinding } from "@codemirror/view";
import { tags } from "@lezer/highlight";
import { cellLanguageLabel, type CellLanguage } from "../compute/index.js";

const words = (list: string): string[] => list.trim().split(/\s+/);

/** A few members of modules notes often import, keyed by their full module name. */
const MODULE_MEMBERS: Record<string, string[]> = {
  sympy: words(`symbols Symbol Function Eq solve solveset nsolve dsolve diff integrate limit series summation product simplify expand factor
    collect cancel apart together trigsimp subs lambdify sympify latex pprint Matrix eye zeros ones Rational Integer Float sqrt exp log ln
    sin cos tan asin acos atan sinh cosh tanh pi E I oo nan Abs sign floor ceiling factorial binomial gamma Sum Integral Derivative Limit
    Piecewise plot N`),
  numpy: words(`array asarray arange linspace logspace zeros ones empty full eye identity reshape concatenate stack vstack hstack
    sqrt exp log log10 sin cos tan arcsin arccos arctan pi e inf nan abs sum mean median std var min max argmin argmax cumsum prod dot
    matmul cross transpose linalg random fft where clip round floor ceil meshgrid polyfit polyval interp sort unique isclose allclose`),
  "matplotlib.pyplot": words(`plot scatter bar barh hist imshow contour contourf figure subplots subplot show savefig title xlabel ylabel
    xlim ylim legend grid axis axhline axvline text annotate tight_layout close colorbar errorbar fill_between loglog semilogx semilogy`),
  math: words(`sqrt exp log log10 log2 sin cos tan asin acos atan atan2 sinh cosh tanh pi e tau inf nan floor ceil fabs factorial
    comb perm gcd isclose degrees radians hypot`),
  pandas: words(`DataFrame Series read_csv read_excel read_json concat merge to_datetime date_range isna notna pivot_table cut qcut`),
};

const KEYWORDS = new Set(words(`False None True and as assert async await break class continue def del elif else except finally for from
  global if import in is lambda nonlocal not or pass raise return try while with yield self print`));

const IMPORT = /^\s*import\s+([\w.]+)(?:\s+as\s+(\w+))?/gm;
const IDENTIFIER = /[A-Za-z_][A-Za-z0-9_]*/g;
const ACCESS = /([A-Za-z_][\w.]*)\.(\w*)$/;

/** The modules `code` imports by the name it uses for them: `import numpy as np` maps `np` to `numpy`. */
function readImportAliases(code: string): Map<string, string> {
  const aliases = new Map<string, string>();
  for (const match of code.matchAll(IMPORT)) aliases.set(match[2] ?? match[1]!, match[1]!);
  return aliases;
}

/** The names written in `code` that are not keywords, comments or strings, without repeats. */
function readIdentifiers(code: string): string[] {
  const stripped = code.replace(/#.*$/gm, "").replace(/("""|''')[\s\S]*?\1|"(?:\\.|[^"\\\n])*"|'(?:\\.|[^'\\\n])*'/g, " ");
  const names = new Set<string>();
  for (const match of stripped.matchAll(IDENTIFIER)) {
    const before = stripped[match.index - 1];
    if (before !== "." && match[0].length > 1 && !KEYWORDS.has(match[0])) names.add(match[0]);
  }
  return [...names];
}

const memberOptions = (members: string[]): Completion[] => members.map((label) => ({ label, type: /^[A-Z]/.test(label) ? "class" : "function", boost: -1 }));

/**
 * A completion source over the code of every cell in the note, read through `noteCode` on each request: after
 * `alias.` it offers the members of an imported common module, otherwise the names the other cells define or use.
 */
function noteCompletionSource(noteCode: () => string): CompletionSource {
  return (context: CompletionContext): CompletionResult | null => {
    const line = context.state.doc.lineAt(context.pos);
    const before = line.text.slice(0, context.pos - line.from);
    if (before.replace(/"[^"]*"|'[^']*'/g, "").includes("#")) return null;
    const code = noteCode();
    const access = ACCESS.exec(before);
    if (access) {
      const module = readImportAliases(code).get(access[1]!) ?? access[1]!;
      const members = MODULE_MEMBERS[module];
      return members ? { from: context.pos - access[2]!.length, options: memberOptions(members), validFor: /^\w*$/ } : null;
    }
    const word = context.matchBefore(/[A-Za-z_]\w*/);
    if (!word && !context.explicit) return null;
    const own = new Set(readIdentifiers(context.state.doc.toString()));
    const options = readIdentifiers(code).filter((name) => !own.has(name) && name !== word?.text).map((label): Completion => ({ label, type: "variable" }));
    return options.length ? { from: word?.from ?? context.pos, options, validFor: /^\w*$/ } : null;
  };
}

/** A syntax colour of the code theme; the reader's note styles may mix it toward the page's text colour. */
const syntax = (role: string): string => `var(--qmd-syntax-${role}, var(--ls-code-${role}))`;

const cellHighlight = HighlightStyle.define([
  { tag: [tags.keyword, tags.operatorKeyword, tags.controlKeyword, tags.definitionKeyword, tags.moduleKeyword], color: syntax("keyword") },
  { tag: [tags.bool, tags.null, tags.atom, tags.self], color: syntax("argument") },
  { tag: [tags.string, tags.special(tags.string), tags.escape], color: syntax("string") },
  { tag: tags.number, color: syntax("number") },
  { tag: tags.comment, color: syntax("comment"), fontStyle: "italic" },
  { tag: [tags.function(tags.variableName), tags.function(tags.propertyName)], color: syntax("math") },
  { tag: [tags.definition(tags.variableName), tags.className, tags.typeName], color: syntax("command") },
  { tag: tags.propertyName, color: syntax("reference") },
  { tag: tags.invalid, color: "var(--ls-error)" },
]);

const cellTheme = EditorView.theme({
  "&": { color: "var(--ls-fg)", backgroundColor: "transparent", fontSize: "var(--ls-text-sm)" },
  "&.cm-focused": { outline: "none" },
  ".cm-scroller": { fontFamily: "var(--ls-code-font, var(--ls-mono))", lineHeight: "1.6" },
  ".cm-content": { padding: "var(--ls-space-1) 0 var(--ls-space-3)", caretColor: "var(--ls-fg)" },
  ".cm-line": { padding: "0 var(--ls-space-5) 0 var(--ls-space-2)" },
  ".cm-cursor": { borderLeftColor: "var(--ls-fg)" },
  ".cm-gutters": { backgroundColor: "transparent", border: "none", color: "var(--ls-desc)" },
  ".cm-lineNumbers .cm-gutterElement": { opacity: "0.6" },
  ".cm-activeLine, .cm-activeLineGutter": { backgroundColor: "transparent" },
  "&.cm-focused .cm-activeLine": { backgroundColor: "color-mix(in srgb, var(--ls-fg) 4%, transparent)" },
  "&.cm-focused .cm-activeLineGutter .cm-gutterElement": { opacity: "1", color: "var(--ls-fg)" },
  ".cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--ls-focus) 18%, transparent)" },
  "&.cm-focused > .cm-scroller > .cm-selectionLayer .cm-selectionBackground": { backgroundColor: "color-mix(in srgb, var(--ls-focus) 32%, transparent)" },
  "&.cm-focused .cm-matchingBracket": { backgroundColor: "color-mix(in srgb, var(--ls-focus) 25%, transparent)", outline: "none" },
  "&.cm-focused .cm-nonmatchingBracket": { backgroundColor: "transparent", color: "var(--ls-error)" },
  ".cm-tooltip": { backgroundColor: "var(--ls-widget-bg)", color: "var(--ls-menu-fg)", border: "1px solid var(--ls-menu-border)", borderRadius: "var(--ls-radius)", boxShadow: "var(--ls-widget-shadow)" },
  ".cm-tooltip.cm-tooltip-autocomplete > ul": { fontFamily: "var(--ls-code-font, var(--ls-mono))", fontSize: "var(--ls-text-sm)" },
  ".cm-tooltip-autocomplete ul li[aria-selected]": { backgroundColor: "var(--ls-menu-selection-bg)", color: "var(--ls-menu-selection-fg)" },
  ".cm-completionDetail": { color: "var(--ls-desc)" },
});

/** How the code cell's node view takes part in the code editor. */
export interface CodeCellEditorOptions {
  /** The code text the editor starts with. */
  text: string;
  /** The cell's language; Python gets highlighting and completion, any other is edited as plain text. */
  language: CellLanguage | undefined;
  editable: boolean;
  /** Keys the node view handles before the editor's own: run, history, leaving the cell. */
  keys: readonly KeyBinding[];
  /** Called with the new text after each edit made in the editor. */
  onChange: (text: string) => void;
  /** The code of every cell in the note, read when completion is asked for. */
  noteCode: () => string;
}

/** Tab inserts one indent unit of spaces at the caret, and indents the lines of a selection. */
const insertIndent = (view: EditorView): boolean => {
  if (view.state.selection.ranges.some((range) => !range.empty)) return indentMore(view);
  view.dispatch(view.state.update(view.state.replaceSelection(view.state.facet(indentUnit)), { scrollIntoView: true, userEvent: "input" }));
  return true;
};

const editableCompartment = new Compartment();
const languageCompartment = new Compartment();
/** The language of each editor, so a switch reconfigures only when it changes. */
const editorLanguages = new WeakMap<EditorView, CellLanguage | undefined>();
/** The note-code reader of each editor, for the Python completion a language switch brings back. */
const noteCodeSources = new WeakMap<EditorView, () => string>();

/** Python's highlighting and note completion; plain text for the other languages. The editor is labelled "<Language> code". */
function languageSupport(language: CellLanguage | undefined, noteCode: () => string): Extension {
  const label = EditorView.contentAttributes.of({ "aria-label": language ? `${cellLanguageLabel(language)} code` : "Code" });
  if (language !== "python") return label;
  return [python(), pythonLanguage.data.of({ autocomplete: noteCompletionSource(noteCode) }), label];
}

/** The page's script nonce; the webview hosts allow it for styles too, so the stylesheet CodeMirror injects is not blocked. */
const pageNonce = (): string => document.querySelector<HTMLScriptElement>("script[nonce]")?.nonce ?? "";

const editability = (editable: boolean): Extension => [EditorView.editable.of(editable), EditorState.readOnly.of(!editable)];

/** Creates the CodeMirror view of a code cell, mounted by the caller. */
export function createCodeCellEditor(options: CodeCellEditorOptions): EditorView {
  const extensions: Extension[] = [
    Prec.highest(keymap.of(options.keys)),
    lineNumbers(),
    highlightActiveLine(),
    highlightActiveLineGutter(),
    bracketMatching(),
    closeBrackets(),
    indentOnInput(),
    indentUnit.of("    "),
    EditorState.tabSize.of(4),
    languageCompartment.of(languageSupport(options.language, options.noteCode)),
    autocompletion({ icons: false }),
    tooltips({ parent: document.body }),
    keymap.of([...closeBracketsKeymap, ...completionKeymap, { key: "Tab", run: insertIndent, shift: indentLess }, ...defaultKeymap]),
    syntaxHighlighting(cellHighlight),
    cellTheme,
    editableCompartment.of(editability(options.editable)),
    EditorView.updateListener.of((update) => { if (update.docChanged && update.transactions.some((tr) => !tr.annotation(externalSync))) options.onChange(update.state.doc.toString()); }),
    EditorView.cspNonce.of(pageNonce()),
  ];
  const editor = new EditorView({ state: EditorState.create({ doc: options.text, extensions }) });
  editorLanguages.set(editor, options.language);
  noteCodeSources.set(editor, options.noteCode);
  return editor;
}

/** Marks a change that brings the editor in line with the note, so it is not written back. */
const externalSync = Annotation.define<boolean>();

/** Replaces the editor's text by `text`, changing only the differing middle so the caret and selection keep their place. */
export function syncCodeCellEditor(editor: EditorView, text: string): void {
  const current = editor.state.doc.toString();
  if (current === text) return;
  let start = 0;
  while (start < current.length && start < text.length && current[start] === text[start]) start++;
  let end = 0;
  while (end < current.length - start && end < text.length - start && current[current.length - 1 - end] === text[text.length - 1 - end]) end++;
  editor.dispatch({ changes: { from: start, to: current.length - end, insert: text.slice(start, text.length - end) }, annotations: externalSync.of(true) });
}

/** Switches the editor to `language`'s support after the cell's language changed. */
export function setCodeCellLanguage(editor: EditorView, language: CellLanguage | undefined): void {
  if (editorLanguages.get(editor) === language) return;
  editorLanguages.set(editor, language);
  editor.dispatch({ effects: languageCompartment.reconfigure(languageSupport(language, noteCodeSources.get(editor) ?? (() => ""))) });
}

/** Turns editing of the code on or off, as the note's own editability changes. */
export function setCodeCellEditable(editor: EditorView, editable: boolean): void {
  if (editor.state.facet(EditorView.editable) !== editable) editor.dispatch({ effects: editableCompartment.reconfigure(editability(editable)) });
}
