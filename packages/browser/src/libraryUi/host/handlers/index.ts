// Exports the library page's message handlers' public API.
export { offerOpenTabs, addTabPaper } from "./addFromTabHandler";
export { createFolder, removeFolder, renameFolder } from "./folderHandlers";
export { exportAnnotations, sendDetails } from "./paperSidecarHandlers";
export { movePapers, removePapers, setNote, setReadingStatus, setTags, writeClipboard } from "./paperHandlers";
export { createPaperFileHandlers, type PaperFileHandlers } from "./paperFileHandlers";
export { createPdfHandlers } from "./pdfHandlers";
export type { PdfHandlers } from "./pdfHandlers";
export { createBrowserShareHost, type ShareLinkRelay } from "./browserShareHost";
