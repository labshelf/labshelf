/** Exports the PDF resolvers' public API: those that build an address from what the context knows and those that learn identifiers. */
export { pageHintResolver } from "./pageHint.js";
export { arxivResolver } from "./arxiv.js";
export { pmcResolver } from "./pmc.js";
export { publisherResolver } from "./publisher.js";
export { crossrefResolver } from "./crossref.js";
export { unpaywallResolver } from "./unpaywall.js";
export { customResolver, isCustomResolverTemplate } from "./customResolver.js";
export { openalexResolver } from "./openalex.js";
export { semanticScholarResolver } from "./semanticScholar.js";
export { europePmcResolver } from "./europePmc.js";
export { titleTwinResolver } from "./titleTwin.js";
export { deriveCandidateVersion, isPreprintServerUrl } from "./candidateVersion.js";
