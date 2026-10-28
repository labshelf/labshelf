// Runs one project search over already-read file texts and names its outcome for the page: results capped per file with short line previews, an unsearchable query, or an empty answer.
import type { PathOps } from "../../path/index.js";
import { findInText } from "./matchText.js";
import type { HostToSearch, MatchPosition } from "./protocol/index.js";
import { searchPattern, type SearchOptions } from "./searchPattern.js";

const RESULT_LIMIT = 2000;
const CONTEXT_BEFORE = 40;
const CONTEXT_AFTER = 120;
const MATCH_PREVIEW = 200;

export interface ProjectText {
  /** Absolute path. */
  path: string;
  text: string;
}

export interface SearchRun {
  message: HostToSearch;
  /** The compiled query; absent when the query is empty or invalid. */
  pattern?: RegExp;
  /** The files that were searched. */
  paths: ReadonlySet<string>;
}

/** The answer for a search that covers nothing, such as a file outside every project. */
export function createEmptySearchRun(): SearchRun {
  return { message: { type: "results", results: { files: [], total: 0, truncated: false } }, paths: new Set() };
}

/** Searches the texts; result labels are the files' paths relative to the project folder. */
export function searchProjectTexts(query: string, options: SearchOptions, project: { folder: string; paths: PathOps }, texts: readonly ProjectText[]): SearchRun {
  const pattern = searchPattern(query, options);
  if (!(pattern instanceof RegExp)) { return { message: { type: "invalid", message: pattern.error }, paths: new Set() }; }
  const { folder, paths } = project;
  const files = texts.map(({ path, text }) => ({ path, text, label: paths.relative(folder, path).split(paths.sep).join("/") }));
  return { message: { type: "results", results: deriveSearchMatches(files, pattern, RESULT_LIMIT) }, pattern, paths: new Set(texts.map((t) => t.path)) };
}

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

export function findMatchesIn(texts: readonly ProjectText[], pattern: RegExp, onlyPath?: string): MatchPosition[] {
  return texts
    .filter(({ path }) => onlyPath === undefined || path === onlyPath)
    .flatMap(({ path, text }) => findInText(text, pattern).map(({ line, column, length }) => ({ path, line, column, length })));
}
