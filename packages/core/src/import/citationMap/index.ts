/** Exports the citation map: OpenAlex data for the library's papers and the works they often cite that the library lacks. */
export { buildCitationMap } from "./buildCitationMap.js";
export type { CitationMap, CitationMapEnv, CitationMapOptions, MissingWork } from "./buildCitationMap.js";
export type { CitationLink } from "./missingCitations.js";
