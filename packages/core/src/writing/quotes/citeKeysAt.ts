/** Finds the cite keys behind a link or citation of a project's compiled PDF, the way that project's format allows. */
import type { CitationQuery, PagePoint } from "../../reader/index.js";
import { findCiteKeyOccurrences } from "../citations/index.js";
import type { ProjectFormat } from "../project/index.js";
import { citationDestKey, typstCiteAt, type TypstCite } from "./pdfCiteLocations.js";

/** A source file's whole text and a 1-based line of it. */
export interface SourceLine {
  text: string;
  line: number;
}

/** What the host knows about the build behind the PDF. */
export interface CitationSources {
  format: ProjectFormat;
  /** Where the last Typst build placed each citation; absent when it is not known. */
  typstCites?: readonly TypstCite[];
  /** The source line behind a point, through SyncTeX; `undefined` when there is no SyncTeX data or no source there. */
  sourceLineAt?(point: PagePoint): Promise<SourceLine | undefined>;
}

/** Every key cited on one line of a source file; the whole text is scanned so comments and offsets stay right. */
export function keysOnLine(format: ProjectFormat, source: SourceLine): string[] {
  const lineStarts = [0];
  for (let i = source.text.indexOf("\n"); i !== -1; i = source.text.indexOf("\n", i + 1)) { lineStarts.push(i + 1); }
  const start = lineStarts[source.line - 1];
  if (start === undefined) { return []; }
  const end = lineStarts[source.line] ?? source.text.length + 1;
  const keys = findCiteKeyOccurrences(format, source.text).filter((cited) => cited.start >= start && cited.start < end).map((cited) => cited.key);
  return [...new Set(keys)];
}

/**
 * A named destination is read as hyperref's (`cite.<key>`); a Typst link is matched against the build's citation positions;
 * LaTeX text without a link, i.e. a build without hyperref, goes through SyncTeX to the `\cite` commands on its source line.
 */
export async function citedKeysAt(query: CitationQuery, sources: CitationSources): Promise<string[]> {
  if (query.dest !== undefined) {
    const key = citationDestKey(query.dest);
    return key === undefined ? [] : [key];
  }
  const { area } = query;
  if (sources.format === "typst") {
    const key = typstCiteAt(sources.typstCites ?? [], area);
    return key === undefined ? [] : [key];
  }
  // A LaTeX link without a destination name is not hyperref's citation link.
  if (query.link || !sources.sourceLineAt) { return []; }
  const center = { page: area.page, x: (area.left + area.right) / 2, y: (area.top + area.bottom) / 2 };
  const source = await sources.sourceLineAt(center);
  return source ? keysOnLine("latex", source) : [];
}
