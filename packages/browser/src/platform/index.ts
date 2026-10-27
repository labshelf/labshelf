// Exports the browser platform access the extension's modules share: the WebExtension API, the logger, the runtime messages,
// the settings and the theme.
export { bx, sendRuntime, downloadTextFile, connectBrowserNative, isHostNotFound, watchVisibility, type NativePort } from "./bx";
export { createBrowserLogger, StorageRingLogSink } from "./logging";
export { readSettings, updateSettings, withSidebarSection, type ExtensionSettings, type SidebarSections } from "./settings";
export { applyTheme, readThemePref, onThemeChange, setThemePref } from "./theme";
export type {
  CopyRequestReply, AttachPdfReply, DraftView, FolderOption, FoldersReply,
  LibraryChangedEvent, LibraryReference, LibraryFindReply, LibraryFindItem, PdfOfferView, FindPdfReply, RuntimeMessage,
  RuntimeResponse, WriteOutcome, WrittenPaperReply, SearchHit, BrowserTab,
} from "./messages";
