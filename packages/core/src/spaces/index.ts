// Exports the spaces domain's public API: the Space file model, the Space store, the view models, the page protocol and its server.
export { SPACE_DATE_KINDS, SPACE_FORMAT_VERSION } from "./space.js";
export type {
  Glossary, GlossaryReadResult, GlossarySource, GlossaryTerm, Space, SpaceAgreement, SpaceDate, SpaceDateKind, SpaceMeetingDate, SpacePlace, SpaceSavedMessage, SpaceSeen, SpaceSourceRef,
  SpaceFolder, SpaceInvalidEntries, SpacePaperInfo, SpaceReference, SpaceProjectDate, SpaceReadDate, SpaceReadResult, SpaceTaskDate, UnknownFields,
} from "./space.js";
export { createEntryId, deriveSpaceId, placeOfSpace, readPaperInfo, parseGlossaryFile, serializeGlossaryFile, serializeSpaceFile } from "./space.js";
export { isPage, parseEntryIds, parseSpaceFile } from "./parseSpaceFile.js";
export { SpaceReadOnlyError, SpaceStore } from "./spaceStore.js";
export type { SpaceStoreOptions } from "./spaceStore.js";
export { createSpaceNotesStore } from "./spaceNotesStore.js";
export type { SpaceNoteEntry, SpaceNotesStore, SpaceQmdItem } from "./spaceNotesStore.js";
export { createSpaceDiscussionsStore } from "./spaceDiscussionsStore.js";
export type { DiscussionSearchHit, SpaceDiscussionsStore, SpaceThreadEntry, ThreadReader, ThreadStatus } from "./spaceDiscussionsStore.js";
export { SPACE_CHAT_PATH } from "./spaceDiscussionsStore.js";
export { createSpaceSendWriters } from "./spaceSendTargets.js";
export type { SpaceAssetWriter } from "./spaceSendTargets.js";
export type { SpaceDateInput, TermInput } from "./spaceMutations.js";
export type {
  CatalogFilter, CatalogRow, LibraryPapers, PapersTree, PapersTreeFolder, Progress, ResolvedPaper, SidebarRow, SpaceOverview,
  RemotePaper, SpaceProjectEntry, TimelineEntry,
} from "./spaceViews.js";
export {
  buildPapersTree, countCatalogPlaces, deriveCatalogRows, deriveFilteredCatalogRows, deriveSidebarRows, deriveSpaceChecklistProgress, hasDownloadablePapers, resolvePaper,
} from "./spaceViews.js";
export { buildIcs, buildOverview } from "./spaceOverview.js";
export { SPACE_TABS, isSpaceQmdPath, parseSpacesMessage } from "./spacesProtocol.js";
export { parseDateDraft, parseTermDraft } from "./parseSpaceDrafts.js";
export type {
  HomeAction, HostToSpaces, PaperPickItem, SpaceMutation, SpacePapersDownload, SpaceQmdAction, SpaceShareView, SpacesEndpoint, SpacesToHost, SpacesTransport, SpaceTab,
} from "./spacesProtocol.js";
export type { SpacePeer, SpaceProjectChat, SpacesHostPort } from "./spacesHostPort.js";
export { serveSpaces } from "./serveSpaces.js";
export { startProjectChat } from "./serveSpaceProjectChat.js";
export type { ServeSpacesOptions } from "./serveSpaces.js";
export { createSpaceProjectList } from "./spaceProjectList.js";
export type { ChecklistReader } from "./spaceProjectList.js";
export { HomeStore } from "./homeStore.js";
export type { HomeStoreOptions } from "./homeStore.js";
export { HOME_DESK_LIMIT, homeEntryId, parseHomeFile, serializeHomeFile } from "./homeFile.js";
export type { HomeFile, HomeLink, HomeLinkKind, HomePin, HomeTaskInput } from "./homeFile.js";
export { buildHomeView, deriveHomeRecent, projectExcerpt } from "./homeView.js";
export type { HomeAgendaRow, HomeDeskCard, HomeRecentRow, HomeTarget, HomeView } from "./homeView.js";
