/** Exports the BibTeX entry builder, the paper artifact writer, and the citation map built from OpenAlex. */
export { createBibtexEntry, BibtexService } from "./bibtexEntry.js";
export { buildCitationMap } from "./citationMap.js";
export type { CitationMap, CitationMapEnv, CitationMapOptions, MissingWork, CitationEdge } from "./citationMap.js";
