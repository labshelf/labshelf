/** Exports the runtime-neutral figure provenance API: input patterns and staleness. */
export { isGlobPattern, matchesInputPattern, normalizeInputPath } from "./inputPattern.js";
export { decideFigureState } from "./figureState.js";
export type { FigureRunResult } from "./figureRunResult.js";
export type { FigureFacts, FigureState } from "./figureState.js";
