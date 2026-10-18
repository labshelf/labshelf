// Exports the browser platform access the extension's modules share: the WebExtension API, the logger and the runtime messages.
export { bx } from "./browserApi";
export { createBrowserLogger, StorageRingLogSink } from "./logging";
export { sendRuntime } from "./sendRuntime";
export { downloadTextFile } from "./downloadTextFile";
export { connectBrowserNative, type NativePort } from "./nativePort";
export { isHostNotFound } from "./hostNotFound";
export { getSettings, updateSettings, type LabShelfSettings } from "./settings";
export { withSidebarSection, type SidebarSections } from "./sidebarSections";
export type {
  AskAuthorData, AttachPdfData, BibHealthData, CiteOutcome, DraftView, FolderOption, FoldersData, InsertOutcome,
  LibraryChangedBroadcast, LibraryRef, LookupData, LookupItem, PdfOfferView, PdfStatusData, ReviewStartData, RuntimeMessage,
  RuntimeResponse, SaveOutcome, SavedPaperData, SearchHit, SiteMark, SitesLookupData, TabSummary, WritingMessage,
} from "./messages";
