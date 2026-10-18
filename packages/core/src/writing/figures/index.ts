/** Exports the runtime-neutral figure provenance API: input patterns, staleness and reading it from file times. */
export { isGlobPattern, matchesInputPattern, normalizeInputPath } from "./inputPattern.js";
export { decideFigureState } from "./figureState.js";
export { readFigureStates } from "./readFigureStates.js";
export type { FigureRunResult } from "./figureRunResult.js";
export type { FigureFacts, FigureState } from "./figureState.js";
