/** Exports the detail tabs' public API: the tab bar and each tab's body, plus the annotation and paper-line pieces other views reuse. */
export { renderTabBarHtml, type TabSpec } from "./tabBar.js";
export { renderPaperTabBarHtml } from "./paperTabBar.js";
export { renderDetailsTabHtml } from "./metadataTab.js";
export { renderAnnotationListHtml, renderAnnotationsTabHtml, deriveFilteredAnnotations } from "./annotationsTab.js";
export { renderNotesTabHtml } from "./notesTab.js";
export { renderPaperLine, renderRelatedTabHtml } from "./relatedTab.js";
