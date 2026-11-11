/** Exports the equation extraction domain: reading a paper's arXiv source, finding its equations and the AI vision source. */
export { EPRINT_CACHE_DIR, loadEprint, unpackEprint, type EprintCache, type EprintFiles } from "./arxivSource.js";
export { findMainFile, flattenSource } from "./flatten.js";
export { listEquations, type SourceEquation } from "./enumerate.js";
export { collectMacros, expandMacros, type MacroTable } from "./macros.js";
export { matchEquation, type EquationMatch } from "./match.js";
export { createEquationExtractor, type EquationOffers, type EquationSource } from "./extractor.js";
export { createArxivEquationSource } from "./arxivEquationSource.js";
export {
  AI_VISION_MODELS, AI_VISION_PROMPT, AI_VISION_TABLE_PROMPT, cleanLatexReply, cleanTableReply, createAiVisionSource, createAiVisionTableReader,
  type AiVisionDeps, type PostFetch,
} from "./aiVisionSource.js";
