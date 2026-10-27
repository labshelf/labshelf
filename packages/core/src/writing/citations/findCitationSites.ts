/** Places each citation of a source by line and by the heading it falls under. */
import { findLineOfOffset, deriveLineOffsets } from "../../text/index.js";
import { findCiteKeyOccurrences } from "./index.js";
import type { ProjectFormat } from "../project/index.js";
import { findSourceHeadings } from "./findSourceHeadings.js";

export interface CitationSite {
  key: string;
  /** Zero-based line of the key. */
  line: number;
  /** Title of the nearest heading above; undefined before the first heading. */
  section: string | undefined;
}

/** Every citation in the text, in text order. */
export function findCitationSites(format: ProjectFormat, text: string): CitationSite[] {
  const starts = deriveLineOffsets(text);
  const headings = findSourceHeadings(format, text);
  let next = 0;
  let section: string | undefined;
  return findCiteKeyOccurrences(format, text).map((cited) => {
    const line = findLineOfOffset(starts, cited.start);
    // A heading's own line counts as under it, so `\section{X \cite{k}}` is in X.
    while (next < headings.length && headings[next]!.line <= line) { section = headings[next++]!.title; }
    return { key: cited.key, line, section };
  });
}
