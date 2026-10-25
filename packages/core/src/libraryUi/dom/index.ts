/** Exports the library UI's DOM half public API: one mount call, the missing-PDF dialog host glue shares, the list pieces other item pages reuse and the detail pieces the Details surface mounts on its own. */
export { mountLibraryUi } from "./mountLibraryUi.js";
export type { LibraryUi, LibraryUiOptions } from "./mountLibraryUi.js";
export { askNoPdf, type MissingPdfChoice } from "./flows/index.js";
export { mountLibrarySidebar, type LibrarySidebar, type LibrarySidebarOptions, type SidebarActions, type SidebarPaper, type ProjectOffers, type SidebarProjectActions, type SidebarSpaceActions, formatLabel } from "./sidebar/index.js";
export {
  GroupedRows, RowReconciler, drawSortableHeads, renderSortableHeadHtml, attachSortableHeads, type GroupedRowsSource, type RowGroup, type SortableHeader,
  buildFailedRow, buildLoadingRow, buildTrayRow, updateTrayRows, type TrayEntry,
  closeOrLeave, openOrEnter, showRow, findFocusedChildRow, findFocusedRow, readPaperId, findPaperRow, listVisibleRows,
  createRowWindow, readRowHeight, type RowSlice, type RowViewport, type RowWindow,
} from "./list/index.js";
export { attachSash, buildFrame, type FrameOptions, type FrameSlots, type SashOptions } from "./shell/index.js";
export { renderIconButton, renderField, renderLoading, mountDetailPane, renderMuted, renderSection, renderTabBarHtml, type TabSpec } from "./detailPane/index.js";
export { attachHostMessages } from "./hostMessages.js";
export { createUiCompositionRoot, type UiContext } from "./uiContext.js";
export { mountEditorArea, type EditorArea, type EditorAreaOptions, type EditorAreaPrefsPort, type EditorAreaSide, type EditorTab, type EditorTabAction, type EditorTabBody, type EditorTabView } from "./editorArea/index.js";
export { runShareDialog } from "./runShareDialog.js";
