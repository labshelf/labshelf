/** Finds the TODO markers a LaTeX or Typst source leaves for its author. */
import type { ProjectFormat } from "../project/index.js";

export interface TodoItem {
  file: string;
  /** Zero-based line of the marker. */
  line: number;
  text: string;
}

const MARKER = /^\s*(?:TODO|FIXME)\b:?(.*)$/;
const TYPST_MARKER = /\/\/\s*(?:TODO|FIXME)\b:?(.*)$/;
const LATEX_TODO = /\\todo(?:\[[^\]]*\])?\{/g;

/** Splits a LaTeX line at its first unescaped `%`. */
function splitLatexComment(line: string): { code: string; comment: string | undefined } {
  for (let i = 0; i < line.length; i++) {
    if (line[i] === "\\") { i++; continue; }
    if (line[i] === "%") { return { code: line.slice(0, i), comment: line.slice(i + 1) }; }
  }
  return { code: line, comment: undefined };
}

/** The text up to the brace that closes the one before `start`; the rest of the line when unclosed. */
function braceBody(line: string, start: number): string {
  let depth = 1;
  for (let i = start; i < line.length; i++) {
    if (line[i] === "\\") { i++; continue; }
    if (line[i] === "{") { depth++; }
    if (line[i] === "}" && --depth === 0) { return line.slice(start, i); }
  }
  return line.slice(start);
}

function latexLineTodos(line: string): string[] {
  const { code, comment } = splitLatexComment(line);
  const texts = [...code.matchAll(LATEX_TODO)].map((match) => braceBody(code, match.index + match[0].length).trim());
  const marker = comment === undefined ? null : MARKER.exec(comment);
  if (marker) { texts.push(marker[1]!.trim()); }
  return texts;
}

function typstLineTodos(line: string): string[] {
  const marker = TYPST_MARKER.exec(line);
  return marker ? [marker[1]!.trim()] : [];
}

/** Every marker in text order: `\todo{…}`, `% TODO`, `% FIXME` in LaTeX; `// TODO`, `// FIXME` in Typst. Markers are upper-case only. */
export function scanTodos(format: ProjectFormat, file: string, text: string): TodoItem[] {
  const scanLine = format === "typst" ? typstLineTodos : latexLineTodos;
  return text.split("\n").flatMap((line, index) => scanLine(line.replace(/\r$/, "")).map((todo) => ({ file, line: index, text: todo })));
}
