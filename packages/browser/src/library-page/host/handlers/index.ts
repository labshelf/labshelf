// Exports the library page's message handlers' public API.
export { offerOpenTabs, captureTab } from "./addFromTabHandler";
export { createFolder, deleteFolder, renameFolder } from "./folderHandlers";
export { exportAnnotations, sendDetails } from "./paperDataHandlers";
export { movePapers, removePapers, setNote, setStatus, setTags, writeClipboard } from "./paperHandlers";
export { createPaperFileHandlers, type PaperFileHandlers } from "./paperFileHandlers";
export { createPdfHandlers } from "./pdfHandlers";
export type { PdfHandlers } from "./pdfHandlers";
export { createShareLinkHandlers, type ShareLinkHandlers } from "./shareLinkHandlers";
