// Exposes the shared string helpers: line offsets and numbers, multiset overlap and the line diff.
export { deriveLineOffsets, findLineOfOffset, lineAt, lineEnd, lineStart } from "./lines.js";
export { countCommon } from "./overlap.js";
export { compareLines, type DiffLine, type DiffLineKind } from "./lineDiff.js";
