// Exports the browser platform access the extension's modules share: the WebExtension API, the logger and the runtime messages.
export { bx } from "./browserApi";
export { createBrowserLogger, StorageRingLogSink } from "./logging";
export { sendRuntime } from "./sendRuntime";
export { downloadTextFile } from "./downloadTextFile";
export { SETTINGS_STORAGE_KEY, getSettings, updateSettings, type LabShelfSettings } from "./settings";
export type {
  AttachPdfData, DraftView, FolderOption, FoldersData, LibraryChangedBroadcast, LibraryRef, LookupData, LookupItem,
  PdfOfferView, PdfStatusData, RuntimeMessage, RuntimeResponse, SaveOutcome, SavedPaperData, ScholarHit, TabSummary,
} from "./runtimeMessages";
