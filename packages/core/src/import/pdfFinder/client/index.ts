/** Exports PDF downloading's public API: following interstitials, recognising bot checks and rewriting URLs through a library proxy. */
export { isBotCheck, isWallPage } from "./botCheck.js";
export { isSupplementaryUrl } from "./supplementary.js";
export { extractNextHopsFromHtml } from "./hops.js";
export { createProxiedUrl, deriveProxyKind, type ProxyKind } from "./proxiedUrl.js";
export { DOWNLOAD_LIMITS, downloadPdf, fetchPdf, type DownloadOutcome } from "./fetchPdf.js";
