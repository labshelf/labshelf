/** Exports root and main-file detection: a project's format, its main file and every file that builds to a PDF of its own, and the build folder name of each. */
export { detectFormat, detectMainFile, mainCandidates } from "./mainDetection.js";
export { rootBuildFolder } from "./rootBuildFolder.js";
export { findRoots } from "./rootDetection.js";
