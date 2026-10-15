// Exports the browser platform access the extension's modules share: the WebExtension API, the logger and the runtime message types.
export { bx } from "./browserApi";
export { BrowserLogger } from "./logger";
export { downloadTextFile } from "./downloadTextFile";
export { DEFAULT_SCI_HUB_MIRROR, SETTINGS_STORAGE_KEY, getSettings, updateSettings, type LabShelfSettings } from "./settings";
export type {
  AttachPdfData, DraftView, FolderOption, FoldersData, LibraryChangedBroadcast, LibraryRef, LookupData, LookupItem,
  PdfStatusData, RuntimeMessage, RuntimeResponse, SaveOutcome, SavedPaperData, ScholarHit, SyncStatusData, TabSummary,
} from "./runtimeMessages";
