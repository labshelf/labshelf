/** Exports the library surface the rest of the extension uses: the list panel, sidebar, Details view and folder helpers. */
export { ListWebviewPanel } from './listPanel.js';
export type { ListPanelDeps } from './listPanel.js';
export { createLibraryPaths, createLibraryRootNode } from './paths.js';
export type { LibraryPaths, LibraryNode } from './paths.js';
export type { SidebarSpacesDep } from './handlers.js';
export { createCitationMapPorts } from './citationMap.js';
export { LibrarySidebarView } from './sidebarView.js';
export type { SidebarProjectTreesDep, SidebarProjectsDep } from './sidebarView.js';
export { checkFolderNameInput } from './organizer.js';
export { PROJECT_COMMANDS, isSidebarProjectCommand } from './projectCommands.js';
export { DetailsView, registerDetailsView, createSelectionSources } from './details.js';
export type { SelectionSources } from './details.js';
