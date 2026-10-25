// Exports the browser platform access the extension's modules share: the WebExtension API, the logger and the runtime messages.
export { bx } from "./browserApi";
export { createBrowserLogger, StorageRingLogSink } from "./logging";
export { sendRuntime } from "./sendRuntime";
export { downloadTextFile } from "./downloadTextFile";
export { connectBrowserNative, type NativePort } from "./nativePort";
export { isHostNotFound } from "./nativeHostMissing";
export { readSettings, updateSettings, type ExtensionSettings } from "./settings";
export { withSidebarSection, type SidebarSections } from "./sidebarSections";
export type {
  CopyRequestReply, AttachPdfReply, DraftView, FolderOption, FoldersReply,
  LibraryChangedEvent, LibraryReference, LibraryFindReply, LibraryFindItem, PdfOfferView, FindPdfReply, RuntimeMessage,
  RuntimeResponse, WriteOutcome, WrittenPaperReply, SearchHit, BrowserTab,
} from "./messages";
