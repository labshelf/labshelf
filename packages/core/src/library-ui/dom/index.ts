/** Exports the library UI's DOM half public API: one mount call, the missing-PDF dialog host glue shares and the list pieces other item pages reuse. */
export { mountLibraryUi } from "./mountLibraryUi.js";
export type { LibraryUi, LibraryUiOptions } from "./mountLibraryUi.js";
export { askNoPdf, type NoPdfChoice } from "./flows/index.js";
export { mountLibrarySidebar, type LibrarySidebar, type LibrarySidebarOptions, type SidebarActions, type SidebarPaper, type ProjectOffers, type SidebarProjectActions, formatLabel } from "./sidebar/index.js";
export {
  GroupedRows, RowReconciler, paintSortableHeads, sortableHeadHtml, wireSortableHeads, type GroupAccess, type RowGroup, type SortableHead,
  buildFailedRow, buildLoadingRow, buildTrayRow, replaceTrayRows, type TrayEntry,
  collapseOrLeave, expandOrEnter, focusRow, focusedChildRow, focusedRow, paperIdOf, paperRowOf, visibleRows,
  createRowWindow, measureRowHeight, type RowSlice, type RowViewport, type RowWindow,
} from "./list/index.js";
export { attachSash, buildFrame, togglePane, type FrameOptions, type FrameSlots, type SashOptions } from "./shell/index.js";
export { iconBtn, kv, loading, muted, section, tabBarHtml, type TabSpec } from "./detail/index.js";
export { mountEditorArea, type EditorArea, type EditorAreaOptions, type EditorAreaPrefsPort, type EditorGroupIndex, type EditorTab, type EditorTabBody, type EditorTabInfo } from "./editorArea/index.js";
