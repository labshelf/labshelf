/** Exports identifier detection's public API: DOI, arXiv, PubMed and PubMed Central ids from PDFs, pages, links and typed input. */
export type { DetectedIds, DetectedIdentifier, IdentifierType } from "./types.js";
export { cleanDoiCandidate, doiVariants, encodeDoiPathSegment, extractDoi } from "./doi.js";
export { arxivIdFromDoi, arxivIdFromUrl, normalizeArxivId } from "./arxiv.js";
export { pmidFromUrl } from "./pubmed.js";
export { normalizePmcid, pmcidFromUrl } from "./pmc.js";
export { detectIdentifiers } from "./detectIdentifiers.js";
export { identifiersFromInput } from "./identifiersFromInput.js";
