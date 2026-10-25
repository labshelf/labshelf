// Collects the matches of a search across files, grouped by file and capped, with short line previews.
import { findInText } from "./findInText.js";

const CONTEXT_BEFORE = 40;
const CONTEXT_AFTER = 120;
const MATCH_PREVIEW = 200;

export interface SearchedFile {
  /** Absolute path. */
  path: string;
  /** What the results show for the file, such as its path inside the project. */
  label: string;
  text: string;
}

/** One match with the slice of its line around it; line and column are 0-based. */
export interface MatchPreview {
  line: number;
  column: number;
  length: number;
  before: string;
  text: string;
  after: string;
}

export interface FileResults {
  path: string;
  label: string;
  matches: MatchPreview[];
}

export interface SearchResults {
  files: FileResults[];
  total: number;
  /** More matches exist than the limit let through. */
  truncated: boolean;
}

function preview(lineText: string, column: number, length: number): Omit<MatchPreview, "line" | "column" | "length"> {
  const start = Math.max(0, column - CONTEXT_BEFORE);
  const end = column + length;
  return {
    before: (start > 0 ? "…" : "") + lineText.slice(start, column).trimStart(),
    text: lineText.slice(column, Math.min(end, column + MATCH_PREVIEW)),
    after: lineText.slice(end, end + CONTEXT_AFTER).trimEnd(),
  };
}

export function deriveSearchMatches(files: readonly SearchedFile[], pattern: RegExp, limit: number): SearchResults {
  const results: SearchResults = { files: [], total: 0, truncated: false };
  for (const file of files) {
    const found = findInText(file.text, pattern);
    if (found.length === 0) { continue; }
    if (results.total >= limit) { results.truncated = true; break; }
    const kept = found.slice(0, limit - results.total);
    results.truncated = kept.length < found.length;
    results.total += kept.length;
    results.files.push({
      path: file.path,
      label: file.label,
      matches: kept.map(({ line, column, length, lineText }) => ({ line, column, length, ...preview(lineText, column, length) })),
    });
  }
  return results;
}
