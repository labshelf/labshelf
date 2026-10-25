// Runs one project search over the scope's files, reading unsaved editor text first.
import { createEmptySearchRun, searchProjectTexts, type ILogger, type SearchOptions, type SearchRun } from "@labshelf/core";
import { readScopeTexts, type SearchScope } from "./projectSearchFiles.js";

export async function runSearch(query: string, options: SearchOptions, scope: SearchScope, logger: ILogger): Promise<SearchRun> {
  if (query === "") { return createEmptySearchRun(); }
  return searchProjectTexts(query, options, scope, await readScopeTexts(scope, logger));
}
