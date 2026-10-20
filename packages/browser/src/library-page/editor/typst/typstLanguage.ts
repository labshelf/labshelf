// Tokenizes Typst markup, `#` code, strings, comments, math and headings for the editor's shared highlight style.
import { StreamLanguage, type StreamParser } from "@codemirror/language";
import type { Extension } from "@codemirror/state";
import { EditorView } from "@codemirror/view";

interface TypstState { comment: number; math: boolean }

const KEYWORDS = new Set(["let", "set", "show", "import", "include", "if", "else", "for", "while", "in", "return", "break", "continue", "context", "not", "and", "or", "none", "auto", "true", "false"]);

function blockComment(stream: Parameters<StreamParser<TypstState>["token"]>[0], state: TypstState): string {
  while (!stream.eol() && state.comment > 0) {
    if (stream.match("*/")) state.comment--;
    else if (stream.match("/*")) state.comment++;
    else stream.next();
  }
  return "comment";
}

function string(stream: Parameters<StreamParser<TypstState>["token"]>[0]): string {
  stream.next();
  for (let ch = stream.next(); ch != null && ch !== '"'; ch = stream.next()) if (ch === "\\") stream.next();
  return "string";
}

const parser: StreamParser<TypstState> = {
  name: "typst",
  startState: () => ({ comment: 0, math: false }),
  languageData: { commentTokens: { line: "//", block: { open: "/*", close: "*/" } } },
  token(stream, state) {
    if (state.comment > 0) return blockComment(stream, state);
    if (state.math) {
      if (stream.peek() === "$") { stream.next(); state.math = false; return "keyword"; }
      while (!stream.eol() && stream.peek() !== "$") if (stream.next() === "\\") stream.next();
      return "variableName.special";
    }
    if (stream.eatSpace()) return null;
    if (stream.match("//")) { stream.skipToEnd(); return "comment"; }
    if (stream.match("/*")) { state.comment = 1; return blockComment(stream, state); }
    if (stream.eat("$")) { state.math = true; return "keyword"; }
    if (stream.sol() && stream.match(/^=+(?=\s)/)) { stream.skipToEnd(); return "heading"; }
    if (stream.peek() === '"') return string(stream);
    if (stream.match(/^#[A-Za-z_][\w-]*/)) return KEYWORDS.has(stream.current().slice(1)) ? "keyword" : "variable";
    if (stream.match(/^(<[\w:.-]+>|@[\w:.-]+)/)) return "meta";
    if (stream.match(/^\*[^*\n]+\*/)) return "strong";
    if (stream.match(/^_[^_\n]+_/)) return "emphasis";
    stream.next();
    return null;
  },
};

const hoverTheme = EditorView.theme({
  ".cm-typst-hover": { padding: "var(--ls-space-2) var(--ls-space-3)", whiteSpace: "pre-wrap", maxWidth: "40em", fontFamily: "var(--ls-mono)" },
});

export const typstLanguage: Extension = [StreamLanguage.define(parser), hoverTheme];
