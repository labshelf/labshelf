/** Exports the runtime-neutral facts of a build preview: its problems placed on the PDF, its stale-source tracking, its per-build SyncTeX data, the build records of its roots and their sources, the build-roots message, and the check limits and counts. */
export { readPdfProblems, type PdfProblemsDeps } from "./pdfProblems.js";
export { StaleSources, type SourceEvents, type StaleSourcesState } from "./staleSources.js";
export { ProjectSynctex, type SynctexFinder, type SynctexLogHost } from "./projectSynctex.js";
export { BuildRootBuilds, type BuildRootBuildState, type FinishedBuild } from "./buildRootBuilds.js";
export { createBuildRootsMessage, type BuildRootsMessageInput } from "./buildRootsMessage.js";
export { CheckCounts } from "./checkCounts.js";
export { deriveCheckLimitsPatch, countBuildRootWords, type PreviewLimits } from "./checkLimits.js";
export { createProjectSources, type SourcesProject } from "./projectSources.js";
