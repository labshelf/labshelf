/**
 * Exports math preview for LaTeX sources: finding the math under a position and rendering it to an image.
 * TRAP: imported as `@labshelf/core/math`, never from the core root; MathJax is about 2.5 MB of CommonJS with import-time side effects, so a root export lands in every browser and webview bundle.
 */
export { findMathSpan, type MathSpan } from "./findMathSpan.js";
export { createMathImageUri, renderMathSvg, type MathColors } from "./renderMathSvg.js";
