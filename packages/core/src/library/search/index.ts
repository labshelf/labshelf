/** Exports library search's public API: the query language, matching and ranking, and the text helpers behind them. */
export { isEmptyQuery } from "./query.js";
export type { FieldFilter, HasField, Query, SearchField } from "./query.js";
export { splitQuery } from "./splitQuery.js";
export { parseQuery } from "./parseQuery.js";
export { searchDoc } from "./searchDoc.js";
export type { SearchDoc, SearchExtra } from "./searchDoc.js";
export { isPaperMatch, matchPaper, matchTerms } from "./matchPaper.js";
export { SYNTAX_HELP } from "./syntaxHelp.js";
export type { SyntaxHelpRow } from "./syntaxHelp.js";
export { normalizeText, deriveFuzzyScore, findHighlightRanges, orderFuzzy } from "./text/index.js";
