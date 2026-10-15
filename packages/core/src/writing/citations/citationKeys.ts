/** Finds the citation keys a LaTeX or Typst source cites, with their positions. */

import type { ProjectFormat } from "../project/index.js";

// \cite, \citep, \citet*, \autocite, \parencite, \textcite, \footcite, \nocite, \Citeauthor, ... with up to two
// optional arguments before the key list.
export const LATEX_CITE_COMMAND = String.raw`\\[A-Za-z]*[Cc]ite[A-Za-z]*\*?\s*(?:\[[^\]]*\]\s*){0,2}\{`;
const LATEX_CITE = new RegExp(`${LATEX_CITE_COMMAND}([^}]*)\\}`, "g");
// TRAP: a `%` escaped as `\%` is text, not a comment.
const LATEX_COMMENT = /(?<!\\)%.*$/gm;

// Typst label characters; a reference preceded by a word character is an e-mail address, not a citation.
const TYPST_REFERENCE = /(?<![\p{L}\p{N}_])@([\p{L}\p{N}_][\p{L}\p{N}_:.-]*)/gu;
const TYPST_CITE_LABEL = /#cite\(\s*(?:<([^>\s]+)>|label\(\s*"([^"]+)"\s*\))/g;
const TYPST_COMMENT = /\/\*[\s\S]*?\*\/|(?<!:)\/\/.*$/gm;
// A URL in markup is a link, and an `@` in its path is not a reference.
const TYPST_URL = /https?:\/\/\S+/g;

export interface CitedKey {
  key: string;
  /** Character offsets of the key in the text. */
  start: number;
  end: number;
}

// Blanks out what is not source while keeping every offset, so matches still point into the real text.
const blank = (text: string, pattern: RegExp): string => text.replace(pattern, (match) => match.replace(/[^\n]/g, " "));

function latexKeys(text: string): CitedKey[] {
  return [...blank(text, LATEX_COMMENT).matchAll(LATEX_CITE)].flatMap((match) => {
    const listStart = match.index + match[0].length - 1 - match[1]!.length;
    return [...match[1]!.matchAll(/[^,\s][^,]*/g)].map((part) => {
      const key = part[0].trimEnd();
      return { key, start: listStart + part.index, end: listStart + part.index + key.length };
    });
  });
}

function typstKeys(text: string): CitedKey[] {
  const source = blank(blank(text, TYPST_COMMENT), TYPST_URL);
  const references = [...source.matchAll(TYPST_REFERENCE)].map((match) => {
    // PLATFORM: Typst drops a trailing `.` or `:` from `@key.` so that a reference can end a sentence.
    const key = match[1]!.replace(/[.:]+$/, "");
    return { key, start: match.index + 1, end: match.index + 1 + key.length };
  });
  const labels = [...source.matchAll(TYPST_CITE_LABEL)].map((match) => {
    const key = (match[1] ?? match[2])!;
    const start = match.index + match[0].lastIndexOf(key);
    return { key, start, end: start + key.length };
  });
  return [...references, ...labels].sort((a, b) => a.start - b.start);
}

/** Every citation in the text with its position, in text order; `*` (cite everything) is not a key. */
export function citedKeys(format: ProjectFormat, text: string): CitedKey[] {
  return (format === "latex" ? latexKeys(text) : typstKeys(text)).filter((cited) => cited.key !== "*");
}

/** Every key cited in the text, without duplicates. */
export function scanCitationKeys(format: ProjectFormat, text: string): string[] {
  return [...new Set(citedKeys(format, text).map((cited) => cited.key))];
}
