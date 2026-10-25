// Exports project text search: pattern building, finding, result collection, single-match replacement, the file filter and the page protocol.
export { escapeRegExp } from "./escapePattern.js";
export { findInText, type TextMatch } from "./findInText.js";
export { findMatchesIn } from "./findMatchesIn.js";
export { matchReplacement, type MatchSpan } from "./matchReplacement.js";
export { isSearchTextFile } from "./searchTextFile.js";
export { searchPattern, type SearchOptions } from "./searchPattern.js";
export { createEmptySearchRun, searchProjectTexts, type ProjectText, type SearchRun } from "./searchRun.js";
export { deriveSearchMatches, type FileResults, type MatchPreview, type SearchedFile, type SearchResults } from "./searchResults.js";
export * from "./protocol/index.js";
