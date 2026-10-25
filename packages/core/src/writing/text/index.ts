// Exposes the plain-text helpers of the writing domain: offset-to-line mapping, line similarity and the three-way text merge.
export { lineOf, lineStarts } from "./lineOffsets.js";
export { lineSimilarity } from "./lineSimilarity.js";
export { createTextMerge } from "./textMerge.js";
