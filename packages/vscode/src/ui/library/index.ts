/** Exports the Library sidebar view, the folder node it shares with the list panel, the folder-name validator and the project command allow-list. */
export { LibrarySidebarView } from './librarySidebarView.js';
export type { SidebarProjectTreesDep, SidebarProjectsDep } from './librarySidebarView.js';
export { rootNode } from './libraryNode.js';
export type { LibraryNode } from './libraryNode.js';
export { validateFolderNameInput } from './folderNameInput.js';
export type { ProjectTreeMessage } from './sidebarMessages.js';
export { PROJECT_COMMANDS, isSidebarProjectCommand } from './projectCommands.js';
export type { SidebarSpacesDep } from "./spaces/index.js";
