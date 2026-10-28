/** Exports the detail pane's public API, the markup pieces other detail panes reuse and the Details surface's DOM entry point. */
export { mountDetailPane } from "./detailPane.js";
export { renderIconButton, renderField, renderLoading, renderMuted, renderSection } from "./paneState.js";
export { renderTabBarHtml, type TabSpec } from "./detailTabs.js";
export { mountDetails, type DetailsOptions } from "./detailsSurface.js";
