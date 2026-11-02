// Exports the browser platform access the extension's modules share: the WebExtension API, the logger, the runtime messages,
// the settings, the theme and the deck calibration store.
export { bx, sendRuntime, downloadBytes, downloadTextFile, openBlobTab, connectBrowserNative, watchVisibility } from "./bx";
export { createStorageCalibrationStore } from "./deckCalibration";
export { createBrowserLogger, StorageRingLogSink } from "./logging";
export { readSettings, updateSettings, withSidebarSection, type ExtensionSettings, type SidebarSections } from "./settings";
export { applyTheme, readThemePref, onThemeChange, setThemePref } from "./theme";
export type {
  CopyRequestReply, AttachPdfReply, DraftView, FolderOption, FoldersReply,
  LibraryChangedEvent, ReaderThemesChangedEvent, LibraryReference, LibraryFindReply, LibraryFindItem, PdfOfferView, FindPdfReply, RuntimeMessage,
  RuntimeResponse, WriteOutcome, WrittenPaperReply, SearchHit, BrowserTab,
} from "./messages";
