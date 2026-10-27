// Exports the Spaces view models: catalog, overview, papers tree, sidebar rows and the .ics export.
export type {
  CatalogRow, PapersTree, PapersTreeFolder, Progress, ResolvedPaper, SidebarRow, SpaceOverview, SpaceProjectEntry, TimelineEntry,
} from "./spaceViewModel.js";
export { resolvePaper } from "./resolvePaper.js";
export type { LibraryPapers } from "./resolvePaper.js";
export { deriveSpaceChecklistProgress } from "./taskProgress.js";
export { deriveCatalogRows, deriveFilteredCatalogRows } from "./deriveCatalogRows.js";
export type { CatalogFilter } from "./deriveCatalogRows.js";
export { buildOverview } from "./spaceOverview/index.js";
export { buildPapersTree } from "./papersTree.js";
export { deriveSidebarRows } from "./deriveSidebarRows.js";
export { buildIcs } from "./icsExport.js";
