/** Public API of library search: the query language, matching and ranking, and the text helpers behind them. */
export { isEmptyQuery } from "./query.js";
export type { FieldFilter, HasKey, Query, SearchField } from "./query.js";
export { tokenize } from "./tokenize.js";
export { parseQuery } from "./parseQuery.js";
export { searchDoc } from "./searchDoc.js";
export type { SearchDoc, SearchExtra } from "./searchDoc.js";
export { matchPaper, matchesTerms, paperMatches } from "./matchPaper.js";
export { SYNTAX_HELP } from "./syntaxHelp.js";
export type { SyntaxHelpRow } from "./syntaxHelp.js";
export { fold, fuzzyScore, highlightRanges, rankFuzzy } from "./text/index.js";
