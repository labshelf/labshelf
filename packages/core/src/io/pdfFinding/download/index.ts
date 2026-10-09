/** Public API of PDF downloading: proving bytes are a PDF, following interstitials, recognising bot checks. */
export { isPdfBytes } from "./pdfBytes.js";
export { isBotCheck } from "./botCheck.js";
export { isSupplementaryUrl } from "./supplementary.js";
export { nextHopsFromHtml } from "./nextHops.js";
export { downloadPdf, fetchPdf } from "./fetchPdf.js";
