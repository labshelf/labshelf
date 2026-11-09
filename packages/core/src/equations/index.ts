/** Exports the equation extraction domain: reading a paper's arXiv source and finding its equations. */
export { EPRINT_CACHE_DIR, loadEprint, unpackEprint, type EprintCache, type EprintFiles } from "./arxivSource.js";
export { findMainFile, flattenSource } from "./flatten.js";
export { listEquations, type SourceEquation } from "./enumerate.js";
export { collectMacros, expandMacros, type MacroTable } from "./macros.js";
export { matchEquation, type EquationMatch } from "./match.js";
