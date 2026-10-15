/** Exports the PDF finder's two-stage engine: concurrent lookups, then ranked, paced downloads. */
export { DEFAULT_LIMITS, type EngineLimits } from "./limits.js";
export { rankedCandidates, startLookups, type Candidate } from "./lookupStage.js";
export { downloadBest } from "./downloadStage.js";
export { pacedFetch } from "./domainPacer.js";
