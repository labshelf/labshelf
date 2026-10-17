/**
 * Exports the shared DOM UI kit's public API: element helpers, theme logic, and the overlay widgets.
 */
export { $, el, highlight, shortTime } from "./dom.js";
export { icon, type IconName } from "../icons/index.js";
export { resolveTheme, applyThemeToDocument, nextThemePref, type ThemePref, type ResolvedTheme } from "./theme.js";
export * from "./widgets/index.js";
export * from "./settings/index.js";
export * from "./syncGuide/index.js";
