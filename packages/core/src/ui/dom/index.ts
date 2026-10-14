/**
 * Public API of the shared DOM UI kit: element helpers, theme logic, and the overlay widgets.
 */
export { $, el, highlight, shortTime } from "./dom.js";
export { resolveTheme, applyThemeToDocument, nextThemePref, type ThemePref, type ResolvedTheme } from "./theme.js";
export * from "./widgets/index.js";
