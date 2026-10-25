/** Exports the search text helpers' public API: accent folding, fuzzy picker matching and highlight ranges. */
export { normalizeText } from "./normalizeText.js";
export { deriveFuzzyScore, orderFuzzy } from "./fuzzy.js";
export { findHighlightRanges } from "./highlight.js";
