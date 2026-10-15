/** Exports PDF downloading's public API: following interstitials, recognising bot checks. */
export { isBotCheck } from "./botCheck.js";
export { isSupplementaryUrl } from "./supplementary.js";
export { nextHopsFromHtml } from "./nextHops.js";
export { DOWNLOAD_LIMITS, downloadPdf, fetchPdf, type DownloadOutcome } from "./fetchPdf.js";
