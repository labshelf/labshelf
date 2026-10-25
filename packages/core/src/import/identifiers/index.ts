/** Exports identifier detection's public API: DOI, arXiv, PubMed and PubMed Central ids from PDFs, pages, links and typed input. */
export type { DetectedIds, DetectedIdentifier, IdentifierType } from "./detectedIdentifier.js";
export { normalizeDoiCandidate, deriveDoiVariants, encodeDoiPathSegment, extractDoi } from "./doi.js";
export { extractArxivIdentifierFromDoi, extractArxivIdentifierFromUrl, normalizeArxivIdentifier } from "./arxiv.js";
export { extractPmidFromUrl } from "./pubmed.js";
export { normalizePmcid, extractPmcidFromUrl } from "./pmc.js";
export { detectIdentifiers } from "./detectIdentifiers.js";
export { extractIdentifiersFromInput } from "./extractIdentifiersFromInput.js";
