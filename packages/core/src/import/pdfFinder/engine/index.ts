/** Exports the PDF finder's two-stage engine: concurrent lookups, then ranked, paced downloads. */
export { DEFAULT_LIMITS, type EngineLimits } from "./limits.js";
export { rankedCandidates, startLookups, type Candidate } from "./findStage.js";
export { downloadBest, downloadCandidate } from "./downloadStage.js";
export { helperTabRetry } from "./helperTabs.js";
export { accessBest } from "./signInStage.js";
export { pacedFetch } from "./hostPacer.js";
export { deadline } from "./deadline.js";
