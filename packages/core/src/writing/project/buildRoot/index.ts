/** Exports root and main-file detection: a project's format, its main file, every file that builds to a PDF of its own, the root a save builds and the build folder name of each. */
export { detectFormat, detectEntryFile, findEntryCandidates } from "./entryDetection.js";
export { deriveBuildRootFolder } from "./buildRootDir.js";
export { findBuildRoots } from "./buildRootDetection.js";
export { buildRootOf } from "./buildRootOf.js";
