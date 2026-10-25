// Exports the browser platform access the extension's modules share: the WebExtension API, the logger and the runtime messages.
export { bx } from "./browserApi";
export { createBrowserLogger, StorageRingLogSink } from "./logging";
export { sendRuntime } from "./sendRuntime";
export { downloadTextFile } from "./downloadTextFile";
export { connectBrowserNative, type NativePort } from "./nativePort";
export { isHostNotFound } from "./nativeHostMissing";
export { getSettings, updateSettings, type LabShelfSettings } from "./settings";
export { withSidebarSection, type SidebarSections } from "./sidebarSections";
export type {
  AskAuthorData, AttachPdfData, DraftView, FolderOption, FoldersData,
  LibraryChangedBroadcast, LibraryRef, LookupData, LookupItem, PdfOfferView, PdfStatusData, RuntimeMessage,
  RuntimeResponse, SaveOutcome, SavedPaperData, SearchHit, TabSummary,
} from "./messages";
