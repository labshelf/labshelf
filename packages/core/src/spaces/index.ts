// Exports the spaces domain's public API: the Space file model, the Space store, the view models, the page protocol and its server.
export * from "./model/index.js";
export * from "./store/index.js";
export type {
  CatalogFilter, CatalogRow, LibraryPapers, PapersTree, PapersTreeFolder, Progress, ResolvedPaper, SidebarRow, SpaceOverview,
  SpaceProjectEntry, TimelineEntry,
} from "./spaceViews.js";
export {
  buildPapersTree, deriveCatalogRows, deriveFilteredCatalogRows, deriveSidebarRows, deriveSpaceChecklistProgress, resolvePaper,
} from "./spaceViews.js";
export { buildIcs, buildOverview } from "./spaceOverview.js";
export { SPACE_TABS, parseDateDraft, parseSpacesMessage, parseTermDraft } from "./spacesProtocol.js";
export type {
  HostToSpaces, PaperPickItem, SpaceMutation, SpacesEndpoint, SpacesToHost, SpacesTransport, SpaceTab,
} from "./spacesProtocol.js";
export type { SpacesHostPort } from "./spacesHostPort.js";
export { serveSpaces } from "./serveSpaces.js";
export type { ServeSpacesOptions } from "./serveSpaces.js";
export { createSpaceProjectList } from "./spaceProjectList.js";
export type { ChecklistReader } from "./spaceProjectList.js";
