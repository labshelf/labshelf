/** Exports the runtime-neutral figure provenance API: input patterns, staleness and reading it from file times. */
export { isGlobPattern, isInputPatternMatch, normalizeInputPath } from "./inputPattern.js";
export { deriveFigureBuildState } from "./figureState.js";
export { readFigureBuildStates } from "./readFigureBuildStates.js";
export type { FigureRunResult } from "./figureRunResult.js";
export type { FigureFacts, FigureState } from "./figureState.js";
