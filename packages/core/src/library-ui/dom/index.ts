/** Exports the library UI's DOM half public API: one mount call, and the missing-PDF dialog host glue shares. */
export { mountLibraryUi } from "./mountLibraryUi.js";
export type { LibraryUi, LibraryUiOptions } from "./mountLibraryUi.js";
export { askNoPdf, type NoPdfChoice } from "./flows/index.js";
export { mountLibrarySidebar, type LibrarySidebar, type LibrarySidebarOptions, type SidebarActions, type SidebarPaper, type SidebarProject, type SidebarProjectActions } from "./sidebar/index.js";
