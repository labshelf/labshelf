/** Exports the runtime-neutral figure provenance API: input patterns, staleness and reading it from file times. */
export {
  isGlobPattern, isInputPatternMatch, normalizeInputPath, deriveFigureBuildState, readFigureBuildStates,
} from "./figureState.js";
export type { FigureRunResult, FigureFacts, FigureState } from "./figureState.js";
