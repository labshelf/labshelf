/**
 * Exports the shared DOM UI kit's public API: element helpers, theme logic, and the overlay widgets.
 */
export { findElement, renderElement, renderHighlightedHtml, formatShortTime, readPageNonce } from "./dom.js";
export { headButton } from "./headButton.js";
export { renderIcon, type IconName } from "../icons/index.js";
export { resolveTheme, applyThemeToDocument, deriveNextThemePref, type ThemePref, type ResolvedTheme } from "./theme.js";
export * from "./widgets/index.js";
export { mountPlaceHeader, type PlaceHeader, type PlaceHeaderOptions, type PlaceHeaderHandlers } from "./placeHeader.js";
export { toggleLinePopover, type LinePopoverOptions } from "./linePopover.js";
export * from "./settings.js";
export * from "./syncGuide.js";
export * from "./workspaceShell.js";
export * from "./workspaceControls.js";
