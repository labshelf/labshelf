/** Exports the publisher rule table, its lookups by DOI and landing page, and the scholarly-host test. */
export { PUBLISHER_RULES } from "./platforms/index.js";
export { deriveHostAccess, listPdfUrlsForDoi, listPdfUrlsForLanding } from "./findRule.js";
export { isScholarlyHost } from "./scholarlyHost.js";
