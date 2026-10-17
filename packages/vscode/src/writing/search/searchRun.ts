// Runs one project search and names its outcome for the page: results, an unsearchable query, or an empty answer.
import { collectSearchResults, searchPattern, type HostToSearch, type ILogger, type SearchOptions } from "@labshelf/core";
import { readScopeTexts, type SearchScope } from "./projectSearchFiles.js";

const RESULT_LIMIT = 2000;

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

/** Searches the scope; result labels are the files' paths relative to the project folder. */
export async function runSearch(query: string, options: SearchOptions, scope: SearchScope, logger: ILogger): Promise<SearchRun> {
  if (query === "") { return emptySearchRun(); }
  const pattern = searchPattern(query, options);
  if (!(pattern instanceof RegExp)) { return { message: { type: "invalid", message: pattern.error }, paths: new Set() }; }
  const texts = await readScopeTexts(scope, logger);
  const { paths } = scope;
  const files = texts.map(({ path, text }) => ({ path, text, label: paths.relative(scope.folder, path).split(paths.sep).join("/") }));
  return { message: { type: "results", results: collectSearchResults(files, pattern, RESULT_LIMIT) }, pattern, paths: new Set(texts.map((t) => t.path)) };
}
