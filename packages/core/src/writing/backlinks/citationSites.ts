/** Places each citation of a source by line and by the heading it falls under. */
import { citedKeys } from "../citations/index.js";
import type { ProjectFormat } from "../project/index.js";
import { sourceHeadings } from "./sourceHeadings.js";

export interface CitationSite {
  key: string;
  /** Zero-based line of the key. */
  line: number;
  /** Title of the nearest heading above; undefined before the first heading. */
  section: string | undefined;
}

function lineStarts(text: string): number[] {
  const starts = [0];
  for (let i = text.indexOf("\n"); i !== -1; i = text.indexOf("\n", i + 1)) { starts.push(i + 1); }
  return starts;
}

function lineOf(starts: readonly number[], offset: number): number {
  let low = 0;
  let high = starts.length - 1;
  while (low < high) {
    const middle = (low + high + 1) >> 1;
    if (starts[middle]! <= offset) { low = middle; } else { high = middle - 1; }
  }
  return low;
}

/** Every citation in the text, in text order. */
export function citationSites(format: ProjectFormat, text: string): CitationSite[] {
  const starts = lineStarts(text);
  const headings = sourceHeadings(format, text);
  let next = 0;
  let section: string | undefined;
  return citedKeys(format, text).map((cited) => {
    const line = lineOf(starts, cited.start);
    // A heading's own line counts as under it, so `\section{X \cite{k}}` is in X.
    while (next < headings.length && headings[next]!.line <= line) { section = headings[next++]!.title; }
    return { key: cited.key, line, section };
  });
}
