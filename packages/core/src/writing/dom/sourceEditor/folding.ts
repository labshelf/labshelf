// Folds LaTeX and Typst source as VS Code does: sections and headings up to the next of their level, environments, and bracket groups over several lines, with a chevron gutter.
import { codeFolding, foldedRanges, foldGutter, foldKeymap, foldService } from "@codemirror/language";
import { Prec, type EditorState, type Extension, type Line } from "@codemirror/state";
import { Decoration, EditorView, keymap } from "@codemirror/view";
import { renderIcon } from "../../../ui/icons/index.js";
import type { SourceLanguage } from "./formatting.js";

type FoldRange = { from: number; to: number };

// A fold never looks further than this, so a long file costs no more per visible line.
const SCAN_LINES = 2000;

const LATEX_SECTIONS = ["part", "chapter", "section", "subsection", "subsubsection", "paragraph", "subparagraph"];
const LATEX_SECTION = /^\s*\\(part|chapter|section|subsection|subsubsection|paragraph|subparagraph)\*?\s*[[{]/;
const LATEX_SECTION_END = /^\s*\\(?:end\{document\}|bibliography\b|printbibliography\b|appendix\b)/;
const TYPST_HEADING = /^\s*(=+)\s/;

/** The line without its comment: `%` not escaped in LaTeX, `//` in Typst. */
function stripComment(text: string, language: SourceLanguage): string {
  if (language === "typst") {
    const at = text.indexOf("//");
    return at < 0 ? text : text.slice(0, at);
  }
  const match = /(^|[^\\])%/.exec(text);
  return match ? text.slice(0, match.index + match[1]!.length) : text;
}

function lastLine(state: EditorState, line: Line): number {
  return Math.min(state.doc.lines, line.number + SCAN_LINES);
}

/** From the end of the heading's line to the end of the last non-blank line before the next heading of its level or above. */
function foldSection(state: EditorState, line: Line, level: number, levelOf: (text: string) => number | undefined, stops?: RegExp): FoldRange | null {
  const doc = state.doc;
  let end = line.to;
  for (let number = line.number + 1; number <= lastLine(state, line); number += 1) {
    const next = doc.line(number);
    const nextLevel = levelOf(next.text);
    if ((nextLevel !== undefined && nextLevel <= level) || stops?.test(next.text)) break;
    if (next.text.trim() !== "") end = next.to;
  }
  return end > line.to ? { from: line.to, to: end } : null;
}

/** `\begin{env}` to the line before its `\end{env}`, so the end stays visible. */
function foldEnvironment(state: EditorState, line: Line, text: string): FoldRange | null {
  const begins = [...text.matchAll(/\\begin\{([^}]+)\}/g)];
  const ends = (text.match(/\\end\{[^}]+\}/g) ?? []).length;
  if (begins.length <= ends) return null;
  const name = begins[begins.length - 1]![1]!;
  const begin = `\\begin{${name}}`;
  const close = `\\end{${name}}`;
  let depth = 1;
  for (let number = line.number + 1; number <= lastLine(state, line); number += 1) {
    const next = state.doc.line(number);
    const body = stripComment(next.text, "latex");
    depth += body.split(begin).length - 1;
    depth -= body.split(close).length - 1;
    if (depth > 0) continue;
    const to = state.doc.line(number - 1).to;
    return number > line.number + 1 && to > line.to ? { from: line.to, to } : null;
  }
  return null;
}

const OPENERS: Record<string, string> = { "{": "}", "[": "]", "(": ")" };

/** The last bracket the line leaves open, up to its closer on a later line. */
function foldBrackets(state: EditorState, line: Line, text: string, language: SourceLanguage): FoldRange | null {
  const open: string[] = [];
  for (let index = 0; index < text.length; index += 1) {
    const char = text[index]!;
    if (char === "\\" && language === "latex") { index += 1; continue; }
    if (OPENERS[char]) open.push(char);
    else if (open.length > 0 && OPENERS[open[open.length - 1]!] === char) open.pop();
  }
  const opener = open[open.length - 1];
  if (opener === undefined) return null;
  const closer = OPENERS[opener]!;
  let depth = 1;
  for (let number = line.number + 1; number <= lastLine(state, line); number += 1) {
    const next = state.doc.line(number);
    const body = stripComment(next.text, language);
    for (let index = 0; index < body.length; index += 1) {
      const char = body[index]!;
      if (char === "\\" && language === "latex") { index += 1; continue; }
      if (char === opener) depth += 1;
      else if (char === closer && --depth === 0) {
        // A group closing on the next line hides nothing worth a chevron.
        return number > line.number + 1 ? { from: line.to, to: next.from + index } : null;
      }
    }
  }
  return null;
}

function latexLevel(text: string): number | undefined {
  const match = LATEX_SECTION.exec(text);
  return match ? LATEX_SECTIONS.indexOf(match[1]!) : undefined;
}

function typstLevel(text: string): number | undefined {
  return TYPST_HEADING.exec(text)?.[1]!.length;
}

export function findFoldRange(state: EditorState, lineStart: number, language: SourceLanguage): FoldRange | null {
  const line = state.doc.lineAt(lineStart);
  const text = stripComment(line.text, language);
  if (language === "typst") {
    const level = typstLevel(text);
    return level !== undefined ? foldSection(state, line, level, typstLevel) : foldBrackets(state, line, text, language);
  }
  const level = latexLevel(text);
  if (level !== undefined) return foldSection(state, line, level, latexLevel, LATEX_SECTION_END);
  return foldEnvironment(state, line, text) ?? foldBrackets(state, line, text, language);
}

function chevron(open: boolean): HTMLElement {
  const marker = document.createElement("span");
  marker.className = open ? "ls-fold-marker ls-fold-open" : "ls-fold-marker ls-fold-closed";
  marker.title = open ? "Fold" : "Unfold";
  marker.innerHTML = renderIcon(open ? "chevron-down" : "chevron-right");
  return marker;
}

const foldedLine = Decoration.line({ class: "ls-folded-line" });

/** Marks the line each fold starts on, as VS Code shades a folded line. */
const foldedLines = EditorView.decorations.of((view) => {
  const lines = new Set<number>();
  foldedRanges(view.state).between(0, view.state.doc.length, (from) => { lines.add(view.state.doc.lineAt(from).from); });
  return Decoration.set([...lines].map((at) => foldedLine.range(at)), true);
});

const foldTheme = EditorView.theme({
  ".cm-foldGutter .cm-gutterElement": { display: "flex", alignItems: "center", justifyContent: "center", cursor: "pointer" },
  ".ls-fold-marker": { display: "flex", color: "var(--ls-section-fg)" },
  ".ls-fold-marker svg": { width: "1em", height: "1em", fill: "currentColor" },
  // As in VS Code, the open chevrons show while the pointer is over the gutter; a folded line always shows its own.
  ".ls-fold-open": { opacity: "0", transition: "opacity 0.15s" },
  ".cm-gutters:hover .ls-fold-open": { opacity: "1" },
  ".ls-fold-marker:hover": { color: "var(--ls-fg)" },
  // VS Code's editor.foldBackground: the selection colour at 30%.
  ".ls-folded-line": { backgroundColor: "color-mix(in srgb, var(--ls-editor-selection-bg) 30%, transparent)" },
  ".cm-foldPlaceholder": {
    margin: "0 var(--ls-space-1)", padding: "0 var(--ls-space-1)", border: "none", borderRadius: "var(--ls-radius-sm)",
    backgroundColor: "var(--ls-toolbar-hover)", color: "var(--ls-section-fg)", cursor: "pointer",
  },
});

export function createFolding(language: SourceLanguage): Extension {
  return [
    foldService.of((state, lineStart) => findFoldRange(state, lineStart, language)),
    codeFolding({ placeholderText: "⋯" }),
    // Low precedence puts the chevrons after the other gutters, next to the text as in VS Code.
    Prec.low(foldGutter({ markerDOM: chevron })),
    keymap.of(foldKeymap),
    foldedLines,
    foldTheme,
  ];
}
