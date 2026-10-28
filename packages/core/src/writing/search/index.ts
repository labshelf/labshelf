// Exports project text search: pattern building, finding, result collection, single-match replacement, the file filter and the page protocol.
export { escapeRegExp, isSearchTextFile, searchPattern, type SearchOptions } from "./searchPattern.js";
export { findInText, matchReplacement, type MatchSpan, type TextMatch } from "./matchText.js";
export {
  createEmptySearchRun, deriveSearchMatches, findMatchesIn, searchProjectTexts,
  type FileResults, type MatchPreview, type ProjectText, type SearchedFile, type SearchResults, type SearchRun,
} from "./searchRun.js";
export * from "./protocol/index.js";
