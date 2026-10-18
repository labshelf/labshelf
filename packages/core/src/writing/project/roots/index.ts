/** Exports root and main-file detection: a project's format, its main file, every file that builds to a PDF of its own, the root a save builds and the build folder name of each. */
export { detectFormat, detectMainFile, mainCandidates } from "./mainDetection.js";
export { rootBuildFolder } from "./rootBuildFolder.js";
export { findRoots } from "./rootDetection.js";
export { buildRootOf } from "./buildRootOf.js";
