/** Exports the library UI's DOM half public API: one mount call, the missing-PDF dialog host glue shares, the list pieces other item pages reuse, and the Writing tab. */
export { mountLibraryUi } from "./mountLibraryUi.js";
export type { LibraryUi, LibraryUiOptions } from "./mountLibraryUi.js";
export { askNoPdf, type NoPdfChoice } from "./flows/index.js";
export { mountLibrarySidebar, type LibrarySidebar, type LibrarySidebarOptions, type SidebarActions, type SidebarPaper, type SidebarProject, type SidebarProjectActions, formatLabel } from "./sidebar/index.js";
export {
  GroupedRows, RowReconciler, paintSortableHeads, sortableHeadHtml, wireSortableHeads, type GroupAccess, type RowGroup, type SortableHead,
  buildFailedRow, buildLoadingRow, buildTrayRow, replaceTrayRows, type TrayEntry,
  collapseOrLeave, expandOrEnter, focusRow, focusedChildRow, focusedRow, paperIdOf, paperRowOf, visibleRows,
} from "./list/index.js";
export { buildFrame, togglePane, type FrameOptions, type FrameSlots } from "./shell/index.js";
export { iconBtn, kv, loading, muted, section, tabBarHtml, type TabSpec } from "./detail/index.js";
export { mountWritingTab, type WritingTab, type WritingTabHost, type WritingTabProject } from "./writing/index.js";
