// Exposes the plain-text helpers of the writing domain: offset-to-line mapping, line similarity and the three-way text merge.
export { findLineOfOffset, deriveLineOffsets } from "./lineOffsets.js";
export { deriveLineSimilarity } from "./deriveLineSimilarity.js";
export { createTextMerge } from "./textMerge.js";
