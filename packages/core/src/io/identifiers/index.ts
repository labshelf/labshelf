/** Public API of identifier detection: DOI, arXiv and PubMed ids from PDFs, pages, links and typed input. */
export type { DetectedIds, DetectedIdentifier, IdentifierType } from "./types.js";
export { cleanDoiCandidate, doiVariants, extractDoi } from "./doi.js";
export { arxivIdFromDoi, arxivIdFromUrl, normalizeArxivId } from "./arxiv.js";
export { pmidFromUrl } from "./pubmed.js";
export { detectIdentifiers } from "./detectIdentifiers.js";
export { identifiersFromInput } from "./identifiersFromInput.js";
