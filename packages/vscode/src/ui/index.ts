// Exports the pages and icons the host draws natively: the webview tab icon, the baked mark files for trees and the HTML shells of webview pages.
export { createTabIcon, createArcIcons, type ArcIcon } from "./icons.js";
export { renderBundleMissingHtml, hasBundleFile } from "./bundleMissing.js";
export { renderHtmlShell, type HtmlShellOptions } from "./htmlShell.js";
