/** Exports the bibliographic registry clients and the record shape they return. */
export { crossRefByDoi, crossRefSearch } from "./crossref.js";
export { arxivById, parseArxivFeed } from "./arxiv.js";
export { pubMedByPmid, pmidFromPmcid, pubMedAuthorsByDoi } from "./pubmed.js";
export { openAlexSearch, openAlexAutocomplete, openAlexWork, type OpenAlexCitationWork } from "./openalex.js";
export { dataCiteByDoi } from "./datacite.js";
export { semanticScholarByTitle, semanticScholarByDoi } from "./semanticScholar.js";
export { europePmcSearch } from "./europePmc.js";
export { dblpSearch } from "./dblp.js";
export { openLibraryByIsbn } from "./openLibrary.js";
export { googleBooksByIsbn } from "./google.js";
export type { RegistryEnv } from "./http.js";
export { DEFAULT_CONTACT_EMAIL } from "./registryEmail.js";
export type { RegistryRecord } from "./registryMetadata.js";
export { plainRecord } from "./plainMetadata.js";
export { publishedDoiOf, type PreprintIds } from "./publishedDoi.js";
