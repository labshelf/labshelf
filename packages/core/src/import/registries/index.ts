/** Exports the bibliographic registry clients and the record shape they return. */
export { fetchCrossrefByDoi, searchCrossref } from "./crossref.js";
export { fetchArxivByIdentifier, parseArxivFeed } from "./arxiv.js";
export { fetchPubmedByPmid, resolvePmidFromPmcid, fetchPubmedAuthorsByDoi } from "./pubmed.js";
export { openAlexSearch, openAlexAutocomplete, openAlexWork, type OpenAlexCitationWork } from "./openalex.js";
export { fetchDataciteByDoi } from "./datacite.js";
export { fetchSemanticScholarByTitle, fetchSemanticScholarByDoi } from "./semanticScholar.js";
export { searchEuropePmc } from "./europePmc.js";
export { searchDblp } from "./dblp.js";
export { openLibraryByIsbn } from "./openLibrary.js";
export { fetchGoogleBooksByIsbn } from "./google.js";
export type { RegistryEnv } from "./http.js";
export { DEFAULT_CONTACT_EMAIL } from "./registryEmail.js";
export type { RegistryEntry } from "./registryMetadata.js";
export { derivePlainMetadata } from "./plainMetadata.js";
export { findPublishedDoi, type PreprintIds } from "./publishedDoi.js";
