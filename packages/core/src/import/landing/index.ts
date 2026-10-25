/** Exports landing-page reading's public API: HTML to raw evidence, evidence to a paper's facts. */
export type { PageFacts, PdfCandidate, RawAuthorEmail, RawMailtoLink, RawPage } from "./rawPage.js";
export { parseHtmlPage, redirectTargets } from "./htmlPage.js";
export { interpretPage } from "./pageFacts.js";
export { fetchLandingPage } from "./fetchLanding.js";
export type { AuthorContact } from "./author/index.js";
export { authorContacts, emailFromAffiliation, findAuthorContacts, type ContactLookup } from "./author/index.js";
