/** Public API of landing-page reading: HTML to raw evidence, evidence to a paper's facts. */
export type { PageFacts, PdfCandidate, RawPage } from "./types.js";
export { parseHtmlPage, redirectTargets } from "./htmlPage.js";
export { interpretPage } from "./pageFacts.js";
export { fetchLandingPage } from "./landingPage.js";
