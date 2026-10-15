/** Exports the publisher rule table and its lookups by DOI and landing page. */
export type { PublisherRule } from "./publisherRule.js";
export { PUBLISHER_RULES } from "./platforms/index.js";
export { pdfUrlsForDoi, pdfUrlsForLanding } from "./ruleLookup.js";
