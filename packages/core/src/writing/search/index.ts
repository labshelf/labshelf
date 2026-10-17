// Exports project text search: pattern building, finding, result collection, single-match replacement, the file filter and the page protocol.
export { escapeRegExp } from "./escapeRegExp.js";
export { findInText, type TextMatch } from "./findInText.js";
export { matchReplacement, type MatchSpan } from "./matchReplacement.js";
export { isSearchableFile } from "./searchableFile.js";
export { searchPattern, type SearchOptions } from "./searchPattern.js";
export { collectSearchResults, type FileResults, type MatchPreview, type SearchedFile, type SearchResults } from "./searchResults.js";
export * from "./protocol/index.js";
