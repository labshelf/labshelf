/**
 * Exports math preview for LaTeX sources: rendering math to an image. Finding the math under a position is MathJax-free, in the latex barrel.
 * TRAP: imported as `@labshelf/core/math`, never from the core root; MathJax is about 2.5 MB of CommonJS with import-time side effects, so a root export lands in every browser and webview bundle.
 */
import { renderMathSvg } from "./renderMathSvg.js";

export { createMathImageUri, renderMathSvg, type MathColors } from "./renderMathSvg.js";

/** The math API as a promise, for callers that take a math loader (the drawing editor); hosts that lazy-load this entry keep their own loader. */
export const loadCoreMath = (): Promise<{ renderMathSvg: typeof renderMathSvg }> => Promise.resolve({ renderMathSvg });
