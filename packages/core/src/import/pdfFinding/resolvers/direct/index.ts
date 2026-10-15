/** Exports the resolvers that build or look up a PDF address from what the context already knows. */
export { pageHintResolver } from "./pageHint.js";
export { arxivResolver } from "./arxiv.js";
export { pmcResolver } from "./pmc.js";
export { landingPdfUrls, publisherPdfUrls, publisherResolver } from "./publisher.js";
export { crossrefResolver } from "./crossref.js";
export { unpaywallResolver } from "./unpaywall.js";
export { sciHubResolver } from "./sciHub.js";
