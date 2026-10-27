// Exports the pages and icons the host draws natively: the webview tab icon, the baked mark files for trees and the HTML shells of webview pages.
export { createTabIcon } from "./tabIcon.js";
export { createArcIcons, type ArcIcon } from "./arcMarkIcons.js";
export { renderBundleMissingHtml } from "./renderBundleMissingHtml.js";
export { hasBundleFile } from "./hasBundleFile.js";
export { renderHtmlShell, type HtmlShellOptions } from "./htmlShell.js";
