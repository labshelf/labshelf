// Exports the spaces domain's public API: the Space file model, the Space store, the view models, the page protocol and its server.
export { SPACE_DATE_KINDS, SPACE_FORMAT_VERSION } from "./space.js";
export type {
  Glossary, GlossaryReadResult, GlossarySource, GlossaryTerm, Space, SpaceDate, SpaceDateKind,
  SpaceFolder, SpaceInvalidEntries, SpaceReference, SpaceProjectDate, SpaceReadDate, SpaceReadResult, SpaceTaskDate, UnknownFields,
} from "./space.js";
export { createEntryId, deriveSpaceId, parseGlossaryFile, serializeGlossaryFile, serializeSpaceFile } from "./space.js";
export { isPage, parseEntryIds, parseSpaceFile } from "./parseSpaceFile.js";
export { SpaceReadOnlyError, SpaceStore } from "./spaceStore.js";
export type { SpaceStoreOptions } from "./spaceStore.js";
export { createSpaceNotesStore } from "./spaceNotesStore.js";
export type { SpaceNoteEntry, SpaceNotesStore, SpaceQmdItem } from "./spaceNotesStore.js";
export { createSpaceDiscussionsStore } from "./spaceDiscussionsStore.js";
export type { SpaceDiscussionsStore, SpaceThreadEntry, ThreadStatus } from "./spaceDiscussionsStore.js";
export { createSpaceSendWriters } from "./spaceSendTargets.js";
export type { SpaceAssetWriter } from "./spaceSendTargets.js";
export type { SpaceDateInput, TermInput } from "./spaceMutations.js";
export type {
  CatalogFilter, CatalogRow, LibraryPapers, PapersTree, PapersTreeFolder, Progress, ResolvedPaper, SidebarRow, SpaceOverview,
  SpaceProjectEntry, TimelineEntry,
} from "./spaceViews.js";
export {
  buildPapersTree, deriveCatalogRows, deriveFilteredCatalogRows, deriveSidebarRows, deriveSpaceChecklistProgress, resolvePaper,
} from "./spaceViews.js";
export { buildIcs, buildOverview } from "./spaceOverview.js";
export { SPACE_TABS, isSpaceQmdPath, parseDateDraft, parseSpacesMessage, parseTermDraft } from "./spacesProtocol.js";
export type {
  HostToSpaces, PaperPickItem, SpaceMutation, SpaceQmdAction, SpacesEndpoint, SpacesToHost, SpacesTransport, SpaceTab,
} from "./spacesProtocol.js";
export type { SpacesHostPort } from "./spacesHostPort.js";
export { serveSpaces } from "./serveSpaces.js";
export type { ServeSpacesOptions } from "./serveSpaces.js";
export { createSpaceProjectList } from "./spaceProjectList.js";
export type { ChecklistReader } from "./spaceProjectList.js";
