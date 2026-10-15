// Exposes the cross-browser WebExtension API instead of raw `chrome.*` or `browser.*` globals.
// Call sites target Chromium and Firefox without conditionals.
import polyfill from "webextension-polyfill";

export const bx = polyfill;
