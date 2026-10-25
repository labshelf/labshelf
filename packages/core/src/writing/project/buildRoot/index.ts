/** Exports root and main-file detection: a project's format, its main file, every file that builds to a PDF of its own, the root a save builds and the build folder name of each. */
export { detectFormat, detectMainFile, mainCandidates } from "./entryDetection.js";
export { rootBuildFolder } from "./buildRootDir.js";
export { findRoots } from "./buildRootDetection.js";
export { buildRootOf } from "./buildRootOf.js";
