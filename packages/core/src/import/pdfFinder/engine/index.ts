/** Exports the PDF finder's two-stage engine: concurrent lookups, then ranked, paced downloads. */
export { DEFAULT_LIMITS, type EngineLimits } from "./limits.js";
export { walkRankedCandidates, startFinds, type Candidate } from "./findStage.js";
export { downloadBest, downloadCandidate } from "./downloadStage.js";
export { runHelperTabRetry } from "./helperTabs.js";
export { runBestAccess } from "./signInStage.js";
export { createPacedFetch } from "./hostPacer.js";
export { createDeadline } from "./deadline.js";
