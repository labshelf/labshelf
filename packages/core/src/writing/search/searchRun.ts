// Runs one project search over already-read file texts and names its outcome for the page: results, an unsearchable query, or an empty answer.
import type { PathOps } from "../../library/mutations/mutationDeps.js";
import type { HostToSearch } from "./protocol/index.js";
import { searchPattern, type SearchOptions } from "./searchPattern.js";
import { collectSearchResults } from "./searchResults.js";

const RESULT_LIMIT = 2000;

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
export function emptySearchRun(): SearchRun {
  return { message: { type: "results", results: { files: [], total: 0, truncated: false } }, paths: new Set() };
}

/** Searches the texts; result labels are the files' paths relative to the project folder. */
export function searchProjectTexts(query: string, options: SearchOptions, project: { folder: string; paths: PathOps }, texts: readonly ProjectText[]): SearchRun {
  const pattern = searchPattern(query, options);
  if (!(pattern instanceof RegExp)) { return { message: { type: "invalid", message: pattern.error }, paths: new Set() }; }
  const { folder, paths } = project;
  const files = texts.map(({ path, text }) => ({ path, text, label: paths.relative(folder, path).split(paths.sep).join("/") }));
  return { message: { type: "results", results: collectSearchResults(files, pattern, RESULT_LIMIT) }, pattern, paths: new Set(texts.map((t) => t.path)) };
}
